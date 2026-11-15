const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../db/prisma');
const { resetDb } = require('./helpers/db');
const { createUser, createVerifiedUser, loginAs } = require('./helpers/factories');
const { MAX_ATTEMPTS } = require('../utils/verification');

// 7.17 - the email verification flow, proven by hand on 2026-10-11.
//
// Codes come from the response body because .env.test sets DEV_RETURN_CODE
// (the route only exposes it outside production). No inbox is involved, and
// SMTP points at 127.0.0.1:1 so the mailer fails fast and falls back to
// console-only instead of creating an Ethereal account over the network.
//
// Every test starts from an empty DB, so each user gets at most one new code
// and never hits the 60s cooldown by accident (except the test that wants it).

beforeEach(resetDb);
after(() => prisma.$disconnect());

const GATED_ROUTE = '/api/user';

const requestCode = (cookie) =>
    request(app).post('/auth/request-code').set('Cookie', cookie);

const verifyCode = (cookie, code) =>
    request(app).post('/auth/verify-code').set('Cookie', cookie).send({ code });

// One digit off in a way that is always a valid 6-digit string. Deriving it
// from the real code keeps the test from accidentally guessing correctly.
const wrongCode = (code) =>
    String((Number(code) + 1) % 1000000).padStart(6, '0');

const liveCodes = (userId) =>
    prisma.verificationCode.findMany({ where: { userId, consumedAt: null } });

test('signup sends the first verification code', async () => {
    const res = await request(app).post('/auth/signup').send({
        username: 'alice',
        email: 'alice@example.com',
        displayName: 'Alice',
        password: 'secret123',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.verificationSent, true);

    const user = await prisma.user.findUnique({ where: { id: res.body.userId } });
    assert.equal(user.emailVerified, null);
    assert.equal((await liveCodes(user.id)).length, 1);
});

test('unverified user is 403 on a gated route', async () => {
    const alice = await createUser();

    const res = await request(app)
        .get(GATED_ROUTE)
        .set('Cookie', await loginAs(alice));

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Please verify your email first');
});

test('resending inside the cooldown -> 429', async () => {
    const alice = await createUser();
    const cookie = await loginAs(alice);

    const first = await requestCode(cookie);
    assert.equal(first.status, 201);
    assert.match(first.body.code, /^\d{6}$/);

    const res = await requestCode(cookie);

    assert.equal(res.status, 429);
    assert.equal(res.body.error, 'A code was just sent, please wait before retrying');
    assert.equal((await liveCodes(alice.id)).length, 1);
});

test('wrong code -> 400 and the user stays unverified', async () => {
    const alice = await createUser();
    const cookie = await loginAs(alice);
    const { body } = await requestCode(cookie);

    const res = await verifyCode(cookie, wrongCode(body.code));

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid or expired code');

    const user = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(user.emailVerified, null);
});

test('correct code -> 200, verified, code consumed, gate opens', async () => {
    const alice = await createUser();
    const cookie = await loginAs(alice);
    const { body } = await requestCode(cookie);

    const res = await verifyCode(cookie, body.code);

    assert.equal(res.status, 200);
    assert.equal(res.body.verified, true);

    const user = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.ok(user.emailVerified instanceof Date);
    assert.equal((await liveCodes(alice.id)).length, 0);

    const gated = await request(app).get(GATED_ROUTE).set('Cookie', cookie);
    assert.equal(gated.status, 200);
});

test('reusing a consumed code -> 400', async () => {
    const alice = await createUser();
    const cookie = await loginAs(alice);
    const { body } = await requestCode(cookie);

    assert.equal((await verifyCode(cookie, body.code)).status, 200);

    const res = await verifyCode(cookie, body.code);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid or expired code');
});

test(`five wrong guesses burn the code, so the right one fails after`, async () => {
    const alice = await createUser();
    const cookie = await loginAs(alice);
    const { body } = await requestCode(cookie);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const res = await verifyCode(cookie, wrongCode(body.code));
        assert.equal(res.status, 400);
    }

    const burned = await prisma.verificationCode.findFirst({
        where: { userId: alice.id },
        orderBy: { createdAt: 'desc' },
    });
    assert.equal(burned.attempts, MAX_ATTEMPTS);
    assert.ok(burned.consumedAt instanceof Date);

    // The real code is now worthless, even though it was never used.
    const res = await verifyCode(cookie, body.code);
    assert.equal(res.status, 400);

    const user = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(user.emailVerified, null);
});

test('changing the email re-gates the user and sends a new code', async () => {
    const alice = await createVerifiedUser();
    const cookie = await loginAs(alice);

    const res = await request(app)
        .post('/api/user')
        .set('Cookie', cookie)
        .send({ newEmail: 'alice.new@example.com' });

    assert.equal(res.status, 200);
    assert.equal(res.body.verificationSent, true);
    assert.equal(res.body.user.email, 'alice.new@example.com');
    assert.equal(res.body.user.emailVerified, null);
    assert.equal((await liveCodes(alice.id)).length, 1);

    // Getting a new address does not keep the old verification.
    const gated = await request(app).get(GATED_ROUTE).set('Cookie', cookie);
    assert.equal(gated.status, 403);
});

test('editing to the same email sends nothing and keeps verification', async () => {
    const alice = await createVerifiedUser();
    const cookie = await loginAs(alice);

    const res = await request(app)
        .post('/api/user')
        .set('Cookie', cookie)
        .send({ newEmail: alice.email });

    assert.equal(res.status, 200);
    assert.equal('verificationSent' in res.body, false);
    assert.equal(res.body.user.emailVerified, alice.emailVerified.toISOString());
    assert.equal(await prisma.verificationCode.count(), 0);
});
