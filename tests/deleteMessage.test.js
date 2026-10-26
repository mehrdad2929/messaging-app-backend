const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../db/prisma');
const { resetDb } = require('./helpers/db');
const {
    createVerifiedUser,
    createConversation,
    addParticipant,
    createMessage,
    loginAs,
} = require('./helpers/factories');

// 7.11 - who may soft-delete whose message.
//
// The rule in deleteMessage is one line per role:
//   OWNER  -> any message in the conversation
//   ADMIN  -> their own message, or one written by a MEMBER
//   MEMBER -> their own message only
//
// So an ADMIN cannot touch another ADMIN's message, and cannot touch the
// OWNER's; the diagonal (requester IS the author) is allowed for every role
// because "own message" is a separate branch, not a consequence of the matrix.
//
// The endpoint is batch-shaped and returns 200 even when nothing was deleted.
// Per-message denial is reported through forbiddenIds, never as a 403:
//   403 = the requester is not a participant of this conversation (one check)
//   404 = the conversation is missing or soft-deleted
// That is why every test below asserts the response arrays AND the DB row.
beforeEach(resetDb);
after(() => prisma.$disconnect());

const ROLE_ORDER = ['OWNER', 'ADMIN', 'MEMBER'];

// The permission matrix as data. This is the expected behavior, so a change
// here is a change to the product, not to the test.
const MAY_DELETE = {
    OWNER: ['OWNER', 'ADMIN', 'MEMBER'],
    ADMIN: ['MEMBER'],
    MEMBER: [],
};

const asc = (a, b) => a - b;

function deleteMessages(conversationId, cookie, messageIds) {
    return request(app)
        .post(`/api/conversations/${conversationId}/messages/delete`)
        .set('Cookie', cookie)
        .send({ messageIds });
}

// Builds a GROUPCHAT with four people: a requester with requesterRole, and one
// author per role. One author per role is what makes a single request cover a
// whole row of the matrix.
async function arrangeMatrix(requesterRole) {
    const requester = await createVerifiedUser();
    const conversation = await createConversation();
    await addParticipant(conversation, requester, requesterRole);

    const msgs = {};
    for (const role of ROLE_ORDER) {
        const author = await createVerifiedUser();
        await addParticipant(conversation, author, role);
        msgs[role] = await createMessage({
            conversation,
            author,
            content: `message from ${role}`,
        });
    }

    // Exists, verified, but deliberately never added to this conversation.
    const outsider = await createVerifiedUser();

    return { requester, conversation, msgs, outsider };
}

// 3 x 3 matrix, one request per requester role. The sorted arrays are the
// matrix: for ADMIN, deleted = MEMBER's id, forbidden = OWNER's + ADMIN's.
for (const requesterRole of ROLE_ORDER) {
    test(`${requesterRole} requester deletes exactly: [${MAY_DELETE[requesterRole].join(', ')}]`, async () => {
        const { requester, conversation, msgs } = await arrangeMatrix(requesterRole);
        const idsByRole = Object.fromEntries(
            ROLE_ORDER.map((role) => [role, msgs[role].id])
        );
        const allIds = ROLE_ORDER.map((role) => idsByRole[role]).sort(asc);

        const res = await deleteMessages(
            conversation.id,
            await loginAs(requester),
            allIds
        );

        const expectedDeleted = MAY_DELETE[requesterRole]
            .map((role) => idsByRole[role])
            .sort(asc);
        const expectedForbidden = ROLE_ORDER
            .filter((role) => !MAY_DELETE[requesterRole].includes(role))
            .map((role) => idsByRole[role])
            .sort(asc);

        assert.equal(res.status, 200);
        assert.deepEqual(res.body.requestedIds, allIds);
        assert.deepEqual(res.body.existingIds, allIds);
        assert.deepEqual(res.body.deletedIds, expectedDeleted);
        assert.deepEqual(res.body.forbiddenIds, expectedForbidden);
        assert.deepEqual(res.body.missingIds, []);

        // Response claims are not enough: check every row.
        for (const role of ROLE_ORDER) {
            const row = await prisma.message.findUnique({
                where: { id: idsByRole[role] },
            });
            if (expectedDeleted.includes(idsByRole[role])) {
                assert.notEqual(row.deletedAt, null, `${role} message should be deleted`);
                assert.equal(row.deletedById, requester.id);
            } else {
                assert.equal(row.deletedAt, null, `${role} message must survive`);
                assert.equal(row.deletedById, null);
            }
        }
    });
}

// The diagonal of the matrix: own message, every role. Without this, the
// ADMIN and MEMBER rows above could pass while "delete your own message" is
// broken, because those rows use a different author.
for (const role of ROLE_ORDER) {
    test(`${role} can delete their own message`, async () => {
        const user = await createVerifiedUser();
        const conversation = await createConversation();
        await addParticipant(conversation, user, role);

        const message = await createMessage({
            conversation,
            author: user,
            content: 'mine',
        });

        const res = await deleteMessages(
            conversation.id,
            await loginAs(user),
            [message.id]
        );

        assert.equal(res.status, 200);
        assert.deepEqual(res.body.deletedIds, [message.id]);
        assert.deepEqual(res.body.forbiddenIds, []);
        assert.deepEqual(res.body.missingIds, []);

        const row = await prisma.message.findUnique({ where: { id: message.id } });
        assert.notEqual(row.deletedAt, null);
        assert.equal(row.deletedById, user.id);
    });
}

test('requester who is not a participant -> 403 and nothing deleted', async () => {
    const { conversation, msgs, outsider } = await arrangeMatrix('MEMBER');

    const res = await deleteMessages(
        conversation.id,
        await loginAs(outsider),
        [msgs.MEMBER.id]
    );

    // This is the only 403 in the route: it is about conversation membership,
    // not about the individual message.
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'you are not a participant in this conversation');

    const row = await prisma.message.findUnique({ where: { id: msgs.MEMBER.id } });
    assert.equal(row.deletedAt, null);
});

test('deleting the same message twice is a no-op the second time', async () => {
    const user = await createVerifiedUser();
    const conversation = await createConversation();
    await addParticipant(conversation, user, 'MEMBER');
    const message = await createMessage({ conversation, author: user });
    const cookie = await loginAs(user);

    const first = await deleteMessages(conversation.id, cookie, [message.id]);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.deletedIds, [message.id]);

    // The `deletedAt: null` filter makes the row "missing" rather than
    // re-deletable, which is why the second call is a 200 no-op.
    const second = await deleteMessages(conversation.id, cookie, [message.id]);

    assert.equal(second.status, 200);
    assert.deepEqual(second.body.requestedIds, [message.id]);
    assert.deepEqual(second.body.existingIds, []);
    assert.deepEqual(second.body.deletedIds, []);
    assert.deepEqual(second.body.missingIds, [message.id]);
    assert.deepEqual(second.body.forbiddenIds, []);
});
