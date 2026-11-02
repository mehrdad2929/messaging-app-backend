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

// 7.12 - keyset pagination for GET /api/conversations/:id/messages.
//
// The response is ALWAYS oldest -> newest, whatever direction was asked for:
//   no cursor   -> the newest `limit` messages
//   before=X    -> the `limit` messages immediately older than X
//   after=X     -> the `limit` messages immediately newer than X
// nextCursor is the edge the client continues FROM (oldest when scrolling
// back, newest when scrolling forward) and is null when hasMore is false.
//
// Every test uses limit=3 with 7 messages. A single page proves nothing here:
// the old implementation looked correct until the second request, which is
// how the direction bug survived manual testing.
beforeEach(resetDb);
after(() => prisma.$disconnect());

const TOTAL = 7;
const LIMIT = 3;

async function arrange() {
    const user = await createVerifiedUser();
    const conversation = await createConversation();
    await addParticipant(conversation, user, 'MEMBER');

    const messages = [];
    for (let i = 1; i <= TOTAL; i++) {
        messages.push(await createMessage({
            conversation,
            author: user,
            content: `m${i}`,
        }));
    }

    return {
        user,
        conversation,
        cookie: await loginAs(user),
        // content -> id, so the assertions read like the messages
        id: (n) => messages[n - 1].id,
    };
}

function getPage(conversationId, cookie, query = '') {
    return request(app)
        .get(`/api/conversations/${conversationId}/messages${query}`)
        .set('Cookie', cookie);
}

const ids = (res) => res.body.messages.map((m) => m.id);
const contents = (res) => res.body.messages.map((m) => m.content);

// The DB has a check constraint: deletedAt and deletedById must be set
// together (a soft-deleted row always records who deleted it).
async function softDelete(message, byUser) {
    await prisma.message.update({
        where: { id: message.id },
        data: { deletedAt: new Date(), deletedById: byUser.id },
    });
}

test('first page: newest limit messages, ascending, cursor = oldest in page', async () => {
    const { conversation, cookie, id } = await arrange();

    const res = await getPage(conversation.id, cookie, `?limit=${LIMIT}`);

    assert.equal(res.status, 200);
    // newest 3 are m5,m6,m7 but returned in chat order (m5 first)
    assert.deepEqual(ids(res), [id(5), id(6), id(7)]);
    assert.deepEqual(contents(res), ['m5', 'm6', 'm7']);
    assert.equal(res.body.hasMore, true);
    // continue OLDER from the oldest message in this page
    assert.equal(res.body.nextCursor, id(5));
});

test('before walk: pages partition the ids with no duplicates or gaps', async () => {
    const { conversation, cookie, id } = await arrange();

    const first = await getPage(conversation.id, cookie, `?limit=${LIMIT}`);
    const second = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&before=${first.body.nextCursor}`
    );
    const third = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&before=${second.body.nextCursor}`
    );

    assert.deepEqual(ids(first), [id(5), id(6), id(7)]);
    assert.deepEqual(ids(second), [id(2), id(3), id(4)]);
    assert.deepEqual(ids(third), [id(1)]);
    assert.equal(second.body.hasMore, true);
    assert.equal(second.body.nextCursor, id(2));
    assert.equal(third.body.hasMore, false);
    assert.equal(third.body.nextCursor, null);

    // The whole point: three pages, seven distinct messages, in order.
    const walked = [...ids(third), ...ids(second), ...ids(first)];
    assert.deepEqual(walked, [1, 2, 3, 4, 5, 6, 7].map(id));
});

test('after walk: newer pages are ascending and continue from the newest', async () => {
    const { conversation, cookie, id } = await arrange();

    const second = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&after=${id(2)}`
    );
    const third = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&after=${second.body.nextCursor}`
    );

    assert.deepEqual(ids(second), [id(3), id(4), id(5)]);
    assert.equal(second.body.hasMore, true);
    assert.equal(second.body.nextCursor, id(5));

    assert.deepEqual(ids(third), [id(6), id(7)]);
    assert.equal(third.body.hasMore, false);
    assert.equal(third.body.nextCursor, null);
});

test('a full page with nothing after it reports hasMore false', async () => {
    const { conversation, cookie, id } = await arrange();

    // exactly LIMIT rows remain (m5,m6,m7). The old length===limit check
    // would have emitted a cursor here and forced one useless request; the
    // limit+1 probe knows there is nothing left.
    const res = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&after=${id(4)}`
    );

    assert.deepEqual(ids(res), [id(5), id(6), id(7)]);
    assert.equal(res.body.hasMore, false);
    assert.equal(res.body.nextCursor, null);
});

test('default limit is 30: all messages, no cursor', async () => {
    const { conversation, cookie } = await arrange();

    const res = await getPage(conversation.id, cookie);

    assert.equal(res.body.messages.length, TOTAL);
    assert.deepEqual(contents(res), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    assert.equal(res.body.hasMore, false);
    assert.equal(res.body.nextCursor, null);
});

test('soft-deleted messages are skipped and do not consume the page', async () => {
    const { user, conversation, cookie, id } = await arrange();
    await softDelete({ id: id(3) }, user);

    // ids < 5 that are visible: 1,2,4 - only three, so the page is short.
    const res = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&before=${id(5)}`
    );

    assert.deepEqual(ids(res), [id(1), id(2), id(4)]);
    assert.equal(res.body.hasMore, false);
    assert.equal(res.body.nextCursor, null);
});

test('a cursor pointing at a soft-deleted message loses no neighbour', async () => {
    const { user, conversation, cookie, id } = await arrange();
    await softDelete({ id: id(4) }, user);

    // This is the case Prisma's `cursor + skip:1` gets wrong: skip is an
    // OFFSET on the filtered rows, so a deleted cursor row would also drop
    // m3 (backwards) or m5 (forwards). Comparing ids has no such edge.
    const back = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&before=${id(4)}`
    );
    const forward = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&after=${id(4)}`
    );

    assert.deepEqual(ids(back), [id(1), id(2), id(3)]);
    assert.equal(back.body.hasMore, false);
    assert.deepEqual(ids(forward), [id(5), id(6), id(7)]);
    assert.equal(forward.body.hasMore, false);
});

test('before and after together -> 400', async () => {
    const { conversation, cookie, id } = await arrange();

    const res = await getPage(
        conversation.id,
        cookie,
        `?limit=${LIMIT}&before=${id(5)}&after=${id(2)}`
    );

    assert.equal(res.status, 400);
    assert.ok(
        res.body.errors.some((e) => e.msg === 'cannot provide both before and after'),
        `unexpected validation body: ${JSON.stringify(res.body)}`
    );
});
