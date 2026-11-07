const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../db/prisma');
const { resetDb } = require('./helpers/db');
const { createVerifiedUser, createDm, loginAs } = require('./helpers/factories');

// 7.13 + 7.14 - POST /api/conversations, DM path.
//
// DM uniqueness is a DB constraint: dmKey is [lowId, highId] sorted, so the
// pair is unique in either order. createDm relies on that and maps P2002 on
// dmKey to a 409. A pre-check would race; the constraint does not.
//
// 404 is deliberately identical for "no such id" and "soft-deleted user": the
// caller must not learn which ids exist. Only the arrange step differs.

beforeEach(resetDb);
after(() => prisma.$disconnect());

const MISSING_USER_ID = 999999;

function postConversation(cookie, body) {
    return request(app)
        .post('/api/conversations')
        .set('Cookie', cookie)
        .send(body);
}

function postDm(cookie, targetUserId) {
    return postConversation(cookie, { conversationType: 'DM', targetUserId });
}

const canonicalDmKey = (a, b) => [a, b].sort((x, y) => x - y).join('_');

async function dmRows() {
    return prisma.conversation.findMany({
        where: { conversationType: 'DM' },
        orderBy: { id: 'asc' },
    });
}

async function participantIds(conversationId) {
    const rows = await prisma.conversationParticipant.findMany({
        where: { conversationId },
        orderBy: { userId: 'asc' },
    });
    return rows.map((row) => row.userId);
}

test('creates one DM with the canonical dmKey and both members', async () => {
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();

    const res = await postDm(await loginAs(alice), bob.id);

    assert.equal(res.status, 201);
    assert.equal(res.body.conversation.conversationType, 'DM');
    assert.equal(res.body.conversation.dmKey, canonicalDmKey(alice.id, bob.id));

    const rows = await dmRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, res.body.conversation.id);

    const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: rows[0].id },
        orderBy: { userId: 'asc' },
    });
    assert.deepEqual(participants.map((p) => p.userId), [alice.id, bob.id].sort((a, b) => a - b));
    assert.deepEqual(participants.map((p) => p.role), ['MEMBER', 'MEMBER']);
});

test('duplicate DM in the same order -> 409 and still one conversation', async () => {
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();
    const cookie = await loginAs(alice);

    const first = await postDm(cookie, bob.id);
    assert.equal(first.status, 201);

    const res = await postDm(cookie, bob.id);

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'this dm already exist');

    const rows = await dmRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, first.body.conversation.id);
    assert.equal(rows[0].dmKey, canonicalDmKey(alice.id, bob.id));
    assert.deepEqual(await participantIds(rows[0].id), [alice.id, bob.id].sort((a, b) => a - b));
});

test('duplicate DM in reversed order -> 409, proving dmKey order independence', async () => {
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();

    const first = await postDm(await loginAs(alice), bob.id);
    assert.equal(first.status, 201);

    const res = await postDm(await loginAs(bob), alice.id);

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'this dm already exist');

    const rows = await dmRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, first.body.conversation.id);
    assert.deepEqual(await participantIds(rows[0].id), [alice.id, bob.id].sort((a, b) => a - b));
});

test('two simultaneous identical DM creates: exactly one 201, one 409, one row', async () => {
    // Sequential duplicates would also 409. Firing both at once is what
    // exercises the unique index itself: whichever transaction loses the
    // race gets P2002 and must still map it to 409, with nothing half-written.
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();
    const cookie = await loginAs(alice);

    const [one, two] = await Promise.all([
        postDm(cookie, bob.id),
        postDm(cookie, bob.id),
    ]);

    const statuses = [one.status, two.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409]);

    const winner = one.status === 201 ? one : two;
    const loser = one.status === 409 ? one : two;
    assert.equal(loser.body.error, 'this dm already exist');

    const rows = await dmRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, winner.body.conversation.id);
    assert.equal((await participantIds(rows[0].id)).length, 2);
});

test('soft-deleted target user -> 404 and no rows', async () => {
    const alice = await createVerifiedUser();
    const gone = await createVerifiedUser({ deletedAt: new Date() });

    const res = await postDm(await loginAs(alice), gone.id);

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no such targetUser');
    assert.equal((await dmRows()).length, 0);
    assert.equal(await prisma.conversationParticipant.count(), 0);
});

test('nonexistent target user -> the same 404 and no rows', async () => {
    const alice = await createVerifiedUser();

    const res = await postDm(await loginAs(alice), MISSING_USER_ID);

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no such targetUser');
    assert.equal((await dmRows()).length, 0);
    assert.equal(await prisma.conversationParticipant.count(), 0);
});

test('self-DM -> 403 and no rows', async () => {
    const alice = await createVerifiedUser();

    const res = await postDm(await loginAs(alice), alice.id);

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'you can not have DM with yourself');
    assert.equal((await dmRows()).length, 0);
    assert.equal(await prisma.conversationParticipant.count(), 0);
});

test('DM without targetUserId -> 400 on the targetUserId field', async () => {
    const alice = await createVerifiedUser();

    const res = await postConversation(await loginAs(alice), { conversationType: 'DM' });

    assert.equal(res.status, 400);
    assert.equal(res.body.errors.length, 1);
    assert.equal(res.body.errors[0].path, 'targetUserId');
    assert.equal((await dmRows()).length, 0);
    assert.equal(await prisma.conversationParticipant.count(), 0);
});

test('deleting a DM -> 403 and the conversation is untouched', async () => {
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();
    const dm = await createDm(alice, bob);

    const res = await request(app)
        .delete(`/api/conversations/${dm.id}`)
        .set('Cookie', await loginAs(alice));

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'You can not delete a DM');

    const row = await prisma.conversation.findUnique({ where: { id: dm.id } });
    assert.equal(row.deletedAt, null);
    assert.equal(row.deletedById, null);
});

test('leaving a DM as yourself -> 403; membership is immutable for now', async () => {
    // 7.13 locks today's rule. When self-leave lands (todo S), this test flips
    // to a success case and moves to deleteConversationParticipant.test.js.
    const alice = await createVerifiedUser();
    const bob = await createVerifiedUser();
    const dm = await createDm(alice, bob);

    const res = await request(app)
        .delete(`/api/conversations/${dm.id}/participants/${alice.id}`)
        .set('Cookie', await loginAs(alice));

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'cannot delete a participant from a DM');

    const row = await prisma.conversationParticipant.findUnique({
        where: { userId_conversationId: { userId: alice.id, conversationId: dm.id } },
    });
    assert.equal(row.deletedAt, null);
    assert.equal(row.deletedById, null);
});
