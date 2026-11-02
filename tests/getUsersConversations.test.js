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

// 7.12b - cursor pagination for GET /api/conversations.
//
// The list is ordered by LAST ACTIVITY, newest first (lastMessageAt desc,
// id desc as tiebreak), and pages are serialized in that same descending
// order. `before` walks older, `after` walks newer - same meaning as the
// message endpoint, mirrored because the display order is descending.
//
// The cursor encodes BOTH halves of the sort key ("<epochMillis>_<id>")
// because lastMessageAt is not unique: timestamps have millisecond precision
// and several conversations can share one. Comparing only the timestamp
// would skip or repeat rows at a page boundary.
//
// The activity times below are deliberately a permutation of creation order:
// c5 is newest, c4 oldest. If the endpoint ever falls back to sorting by id,
// every assertion here fails immediately.
beforeEach(resetDb);
after(() => prisma.$disconnect());

const BASE = new Date('2026-01-01T00:00:00.000Z');
const MINUTE = 60_000;
const at = (minutes) => new Date(BASE.getTime() + minutes * MINUTE);

// conversation number -> activity minute
const ACTIVITY = { 1: 2, 2: 6, 3: 4, 4: 1, 5: 7, 6: 5, 7: 3 };
const ACTIVITY_ORDER = [5, 2, 6, 3, 7, 1, 4]; // newest -> oldest

async function arrange() {
    const user = await createVerifiedUser();
    const conversations = [];

    for (let i = 1; i <= 7; i++) {
        conversations.push(await createConversation({
            createdBy: user,
            name: `c${i}`,
            // Pinned so the DB default (now) cannot outrank the activity times.
            lastMessageAt: BASE,
        }));
    }

    for (let i = 1; i <= 7; i++) {
        await createMessage({
            conversation: conversations[i - 1],
            author: user,
            content: `m${i}`,
            createdAt: at(ACTIVITY[i]),
        });
    }

    const c = (n) => conversations[n - 1];
    return {
        user,
        cookie: await loginAs(user),
        c,
        cursorFor: (n) => `${at(ACTIVITY[n]).getTime()}_${c(n).id}`,
    };
}

const getList = (cookie, query = '') =>
    request(app).get(`/api/conversations${query}`).set('Cookie', cookie);

const ids = (res) => res.body.conversations.map((conversation) => conversation.id);
const expected = (c) => ACTIVITY_ORDER.map((n) => c(n).id);

test('first page: newest activity first, cursor points at the oldest in the page', async () => {
    const { cookie, c, cursorFor } = await arrange();

    const res = await getList(cookie, '?limit=3');

    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), [c(5).id, c(2).id, c(6).id]);
    assert.equal(res.body.hasMore, true);
    assert.equal(res.body.nextCursor, cursorFor(6));

    // The sort key is part of the payload, so a client can render "3m ago".
    assert.deepEqual(
        res.body.conversations.map((conversation) => conversation.lastMessageAt),
        [at(ACTIVITY[5]), at(ACTIVITY[2]), at(ACTIVITY[6])]
            .map((date) => date.toISOString())
    );
});

test('before walk: pages partition the list with no duplicates or gaps', async () => {
    const { cookie, c, cursorFor } = await arrange();

    const first = await getList(cookie, '?limit=3');
    const second = await getList(
        cookie,
        `?limit=3&before=${first.body.nextCursor}`
    );
    const third = await getList(
        cookie,
        `?limit=3&before=${second.body.nextCursor}`
    );

    assert.deepEqual(ids(first), [c(5).id, c(2).id, c(6).id]);
    assert.deepEqual(ids(second), [c(3).id, c(7).id, c(1).id]);
    assert.deepEqual(ids(third), [c(4).id]);

    assert.equal(second.body.hasMore, true);
    assert.equal(second.body.nextCursor, cursorFor(1));
    assert.equal(third.body.hasMore, false);
    assert.equal(third.body.nextCursor, null);

    assert.deepEqual(
        [...ids(first), ...ids(second), ...ids(third)],
        expected(c)
    );
});

test('after walk: newer pages are descending and continue from the newest', async () => {
    const { cookie, c, cursorFor } = await arrange();

    const second = await getList(
        cookie,
        `?limit=3&after=${cursorFor(7)}`
    );
    const third = await getList(
        cookie,
        `?limit=3&after=${second.body.nextCursor}`
    );

    assert.deepEqual(ids(second), [c(2).id, c(6).id, c(3).id]);
    assert.equal(second.body.hasMore, true);
    assert.equal(second.body.nextCursor, cursorFor(2));

    assert.deepEqual(ids(third), [c(5).id]);
    assert.equal(third.body.hasMore, false);
    assert.equal(third.body.nextCursor, null);
});

test('a full page with nothing newer reports hasMore false', async () => {
    const { cookie, c, cursorFor } = await arrange();

    // Exactly three conversations are newer than c3.
    const res = await getList(
        cookie,
        `?limit=3&after=${cursorFor(3)}`
    );

    assert.deepEqual(ids(res), [c(5).id, c(2).id, c(6).id]);
    assert.equal(res.body.hasMore, false);
    assert.equal(res.body.nextCursor, null);
});

test('default limit is 30: the whole list, newest activity first', async () => {
    const { cookie, c } = await arrange();

    const res = await getList(cookie);

    assert.deepEqual(ids(res), expected(c));
    assert.equal(res.body.hasMore, false);
    assert.equal(res.body.nextCursor, null);
});

test('a soft-deleted conversation is skipped and does not consume the page', async () => {
    const { user, cookie, c, cursorFor } = await arrange();

    await prisma.conversation.update({
        where: { id: c(6).id },
        data: { deletedAt: new Date(), deletedById: user.id },
    });

    // c6 was third; the page still contains three rows, so one row was
    // pulled from the next activity slot but the cursor stays consistent.
    const first = await getList(cookie, '?limit=3');
    assert.deepEqual(ids(first), [c(5).id, c(2).id, c(3).id]);
    assert.equal(first.body.hasMore, true);
    assert.equal(first.body.nextCursor, cursorFor(3));

    const all = await getList(cookie);
    assert.equal(all.body.conversations.length, 6);
    assert.ok(!ids(all).includes(c(6).id));
});

test('only conversations where the user is an active participant are listed', async () => {
    const { user, cookie, c } = await arrange();
    const otherUser = await createVerifiedUser();

    // Newer activity than every fixture conversation, so a filter bug would
    // put these at the top of the list rather than merely adding a row.
    const foreign = await createConversation({
        createdBy: otherUser,
        name: 'foreign',
        lastMessageAt: at(20),
    });
    const left = await createConversation({
        createdBy: user,
        name: 'left',
        lastMessageAt: at(21),
    });
    await prisma.conversationParticipant.update({
        where: {
            userId_conversationId: { userId: user.id, conversationId: left.id },
        },
        data: { deletedAt: new Date(), deletedById: user.id },
    });

    const res = await getList(cookie);

    assert.deepEqual(ids(res), expected(c));
    assert.ok(!ids(res).includes(foreign.id));
    assert.ok(!ids(res).includes(left.id));
});

test('a new message moves its conversation to the top of the list', async () => {
    const { user, cookie, c } = await arrange();

    // c4 is the OLDEST activity; one message makes it the newest.
    await createMessage({
        conversation: c(4),
        author: user,
        content: 'bump',
        createdAt: at(10),
    });

    const res = await getList(cookie);

    assert.deepEqual(
        ids(res),
        [c(4).id, c(5).id, c(2).id, c(6).id, c(3).id, c(7).id, c(1).id]
    );
});

test('before and after together -> 400', async () => {
    const { cookie, cursorFor } = await arrange();

    const res = await getList(
        cookie,
        `?before=${cursorFor(5)}&after=${cursorFor(2)}`
    );

    assert.equal(res.status, 400);
    assert.ok(
        res.body.errors.some((e) => e.msg === 'cannot provide both before and after'),
        `unexpected validation body: ${JSON.stringify(res.body)}`
    );
});

test('a malformed or impossible cursor -> 400', async () => {
    const { cookie, c } = await arrange();

    const malformed = await getList(cookie, '?before=abc');
    assert.equal(malformed.status, 400);
    assert.ok(
        malformed.body.errors.some((e) => e.msg === 'before must be a valid cursor'),
        `unexpected validation body: ${JSON.stringify(malformed.body)}`
    );

    // Well-formed shape, but the timestamp cannot be represented as a Date.
    const impossible = await getList(
        cookie,
        `?after=999999999999999999999_${c(1).id}`
    );
    assert.equal(impossible.status, 400);
    assert.ok(
        impossible.body.errors.some((e) => e.msg === 'after must be a valid cursor'),
        `unexpected validation body: ${JSON.stringify(impossible.body)}`
    );
});
