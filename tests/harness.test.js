const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../db/prisma');
const { resetDb } = require('./helpers/db');
const {
    DEFAULT_PASSWORD,
    createUser,
    createVerifiedUser,
    createConversation,
    createDm,
    addParticipant,
    createMessage,
    loginAs,
    cookieFor,
} = require('./helpers/factories');

// Self-test for the harness itself. These do not test app features - they
// prove the helpers do what the real suites will assume. If one of these
// fails, every later test's failure message is suspect.
//
// each test starts from an empty DB, same as every real test file will.
beforeEach(resetDb);
after(() => prisma.$disconnect());

test('resetDb empties the tables and restarts ids', async () => {
    const first = await createUser();
    assert.equal(first.id, 1);

    await resetDb();

    assert.equal(await prisma.user.count(), 0);

    // RESTART IDENTITY matters because messages are paginated by id cursor:
    // a test must never inherit sequence values from the previous test.
    const second = await createUser();
    assert.equal(second.id, 1);
});

test('createUser + loginAs produces a cookie the app accepts', async () => {
    const user = await createUser();

    const cookie = await loginAs(user);
    assert.match(cookie, /^token=/);

    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.user.id, user.id);
    assert.equal(res.body.user.username, user.username);
});

test('createUser hashes the password and allows a missing one', async () => {
    const user = await createUser();

    // The stored value must not be the plaintext we passed in.
    const stored = await prisma.user.findUnique({
        where: { id: user.id },
        select: { password: true },
    });
    assert.notEqual(stored.password, DEFAULT_PASSWORD);

    // OAuth-only rows have no password and cannot log in with one.
    const oauthUser = await createUser({
        password: null,
        provider: 'GOOGLE',
        providerId: 'google-123',
    });
    const res = await request(app)
        .post('/auth/login')
        .send({ username: oauthUser.username, password: DEFAULT_PASSWORD });
    assert.equal(res.status, 401);
});

test('createVerifiedUser sets emailVerified, createUser does not', async () => {
    const plain = await createUser();
    const verified = await createVerifiedUser();

    assert.equal(plain.emailVerified, null);
    assert.notEqual(verified.emailVerified, null);
});

test('cookieFor works without the login route', async () => {
    const user = await createUser();

    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', cookieFor(user));

    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, user.id);
});

test('createDm makes two participants and a canonical dmKey', async () => {
    const alice = await createUser({ username: 'alice' });
    const bob = await createUser({ username: 'bob' });

    // Deliberately backwards: the key must be sorted, not call order.
    const dm = await createDm(bob, alice);

    assert.equal(dm.conversationType, 'DM');
    assert.equal(dm.dmKey, `${alice.id}_${bob.id}`);

    const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: dm.id },
    });
    assert.equal(participants.length, 2);
});

test('createConversation + addParticipant + createMessage write the rows', async () => {
    const owner = await createUser();
    const member = await createUser();

    const conversation = await createConversation({
        name: 'team',
        createdBy: owner,
        participants: [member],
    });

    const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: conversation.id },
        orderBy: { userId: 'asc' },
    });
    assert.equal(participants.length, 2);
    assert.equal(
        participants.find((p) => p.userId === owner.id).role,
        'OWNER'
    );

    // addParticipant is for adding someone after creation.
    const late = await createUser();
    await addParticipant(conversation, late);
    assert.equal(
        await prisma.conversationParticipant.count({
            where: { conversationId: conversation.id },
        }),
        3
    );

    const message = await createMessage({
        conversation,
        author: member,
        content: 'hi',
    });
    assert.equal(message.content, 'hi');
    assert.equal(message.conversationId, conversation.id);
    assert.equal(message.userId, member.id);
});
