const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../db/prisma');
const { resetDb } = require('./helpers/db');
const {
    createVerifiedUser,
    createConversation,
    createMessage,
    loginAs,
} = require('./helpers/factories');

// 7.13 - POST /api/conversations/:id/messages/read?from=&to=.
//
// This is a RANGE endpoint, not pagination: one request marks every visible
// message in [from, to] that the requester did not author and had not already
// read. There is no page, no hasMore, no cursor. The tests focus on the
// boundaries that make it safe: the conversation filter, the author filter,
// soft-deleted rows, and re-reading.
beforeEach(resetDb);
after(() => prisma.$disconnect());

async function arrange() {
    const me = await createVerifiedUser();
    const other = await createVerifiedUser();

    const conversation = await createConversation({
        createdBy: me,
        participants: [other],
    });
    const otherConversation = await createConversation({
        createdBy: other,
        participants: [me],
    });

    // Creation order matters: `foreign` gets an id BETWEEN m1 and m3, so a
    // range that ignored conversationId would wrongly mark it.
    const m1 = await createMessage({ conversation, author: other, content: 'm1' });
    const foreign = await createMessage({
        conversation: otherConversation,
        author: other,
        content: 'foreign',
    });
    const mine = await createMessage({ conversation, author: me, content: 'mine' });
    const m3 = await createMessage({ conversation, author: other, content: 'm3' });
    const outside = await createMessage({ conversation, author: other, content: 'outside' });

    return {
        me,
        other,
        conversation,
        otherConversation,
        m1,
        foreign,
        mine,
        m3,
        outside,
        cookie: await loginAs(me),
    };
}

const markRead = (conversationId, cookie, from, to) =>
    request(app)
        .post(`/api/conversations/${conversationId}/messages/read?from=${from}&to=${to}`)
        .set('Cookie', cookie);

const sorted = (values) => [...values].sort((a, b) => a - b);

async function readMessageIds(userId) {
    const rows = await prisma.messageRead.findMany({
        where: { userId },
        select: { messageId: true },
    });
    return sorted(rows.map((row) => row.messageId));
}

test('marks unread messages from other users inside the range', async () => {
    const { me, conversation, m1, m3, cookie } = await arrange();

    const res = await markRead(conversation.id, cookie, m1.id, m3.id);

    assert.equal(res.status, 201);
    assert.equal(res.body.userId, me.id);
    assert.deepEqual(sorted(res.body.readMessageIds), [m1.id, m3.id]);
    assert.deepEqual(await readMessageIds(me.id), [m1.id, m3.id]);
});

test('own messages are not marked as read', async () => {
    const { me, conversation, m1, mine, m3, cookie } = await arrange();

    const res = await markRead(conversation.id, cookie, m1.id, m3.id);

    assert.ok(!res.body.readMessageIds.includes(mine.id));
    assert.ok(!(await readMessageIds(me.id)).includes(mine.id));
});

test('re-reading is a no-op: no new rows, empty response', async () => {
    const { me, conversation, m1, m3, cookie } = await arrange();

    await markRead(conversation.id, cookie, m1.id, m3.id);
    const second = await markRead(conversation.id, cookie, m1.id, m3.id);

    assert.equal(second.status, 201);
    assert.deepEqual(second.body.readMessageIds, []);
    // State is unchanged: still exactly the same two MessageRead rows.
    assert.deepEqual(await readMessageIds(me.id), [m1.id, m3.id]);
});

test('to lower than from -> 400', async () => {
    const { conversation, m1, m3, cookie } = await arrange();

    const res = await markRead(conversation.id, cookie, m3.id, m1.id);

    assert.equal(res.status, 400);
    assert.ok(
        res.body.errors.some(
            (e) => e.msg === 'to must be greater than or equal to from'
        ),
        `unexpected validation body: ${JSON.stringify(res.body)}`
    );
});

test('from and to are both required -> 400', async () => {
    const { conversation, m1, m3, cookie } = await arrange();

    const noFrom = await request(app)
        .post(`/api/conversations/${conversation.id}/messages/read?to=${m3.id}`)
        .set('Cookie', cookie);
    assert.equal(noFrom.status, 400);
    assert.ok(
        noFrom.body.errors.some(
            (e) => e.msg === 'lower limit should be an integer greater or equal to 1'
        ),
        `unexpected validation body: ${JSON.stringify(noFrom.body)}`
    );

    const noTo = await request(app)
        .post(`/api/conversations/${conversation.id}/messages/read?from=${m1.id}`)
        .set('Cookie', cookie);
    assert.equal(noTo.status, 400);
    assert.ok(
        noTo.body.errors.some(
            (e) => e.msg === 'upper limit should be an integer'
        ),
        `unexpected validation body: ${JSON.stringify(noTo.body)}`
    );
});

test('a non-participant or removed participant -> 404', async () => {
    const { me, other, conversation, m1, m3, cookie } = await arrange();

    const stranger = await createVerifiedUser();
    const strangerConversation = await createConversation({
        createdBy: other,
    });
    const strangerRes = await markRead(
        strangerConversation.id,
        await loginAs(stranger),
        m1.id,
        m3.id
    );
    assert.equal(strangerRes.status, 404);
    assert.equal(strangerRes.body.error, 'no such conversationparticipant');

    // The requester is a participant, but their row was removed. The cookie
    // stays valid because only the participant row changed, not the user.
    await prisma.conversationParticipant.update({
        where: {
            userId_conversationId: {
                userId: me.id,
                conversationId: conversation.id,
            },
        },
        data: { deletedAt: new Date(), deletedById: me.id },
    });
    const removedRes = await markRead(conversation.id, cookie, m1.id, m3.id);
    assert.equal(removedRes.status, 404);
    assert.equal(removedRes.body.error, 'no such conversationparticipant');
});

test('a message from another conversation inside the id range is not marked', async () => {
    const { me, conversation, m1, foreign, m3, cookie } = await arrange();

    // Sanity: the foreign id really does fall inside the requested range.
    assert.ok(foreign.id > m1.id && foreign.id < m3.id);

    const res = await markRead(conversation.id, cookie, m1.id, m3.id);

    assert.ok(!res.body.readMessageIds.includes(foreign.id));
    assert.ok(!(await readMessageIds(me.id)).includes(foreign.id));
});

test('a soft-deleted message in the range is skipped', async () => {
    const { me, other, conversation, m1, m3, cookie } = await arrange();

    await prisma.message.update({
        where: { id: m3.id },
        data: { deletedAt: new Date(), deletedById: other.id },
    });

    const res = await markRead(conversation.id, cookie, m1.id, m3.id);

    assert.deepEqual(sorted(res.body.readMessageIds), [m1.id]);
    assert.deepEqual(await readMessageIds(me.id), [m1.id]);
});

test('a range with nothing markable -> 201 and an empty result', async () => {
    const { me, conversation, mine, cookie } = await arrange();

    // Containing only the requester's own message: nothing to create.
    const res = await markRead(conversation.id, cookie, mine.id, mine.id);

    assert.equal(res.status, 201);
    assert.deepEqual(res.body.readMessageIds, []);
    assert.deepEqual(await readMessageIds(me.id), []);
});
