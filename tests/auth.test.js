const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../app');
const prisma = require('../db/prisma');
const { resetDb } = require('./helpers/db');
const { createUser, cookieFor } = require('./helpers/factories');
const { GRACE_DAYS } = require('../utils/accountLifecycle');

// 7.10 - the authentication gate itself.
//
// Target: GET /auth/check. It runs authenticateToken but NOT requireVerified,
// and has no validation or business logic, so every failure here is the
// middleware's own decision. (requireVerified -> 403 is 7.17, not this file.)
//
// The interesting case is the last one that still returns 401: a token that
// was perfectly valid when it was issued, for a user who has since been
// soft-deleted. That only works because authenticateToken re-reads the user
// from the DB with `deletedAt: null` instead of trusting the JWT payload.
// Which is also why those tests use cookieFor(), not loginAs(): logging in
// would RESTORE the deleted account (C-lite) and quietly undo the fixture.
beforeEach(resetDb);
after(() => prisma.$disconnect());

// Baseline: the same request shape the failing tests use, with a live user.
// If this ever breaks, the 401s below are meaningless.
test('valid token for a live user -> 200', async () => {
    const user = await createUser();

    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', cookieFor(user));

    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.user.id, user.id);
    assert.equal(res.body.user.username, user.username);
});

test('no cookie -> 401 No token provided', async () => {
    const res = await request(app).get('/auth/check');

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'No token provided');
});

test('malformed token -> 401 Invalid token', async () => {
    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', 'token=not-a-jwt');

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid token');
});

test('token signed with the wrong secret -> 401 Invalid token', async () => {
    const user = await createUser();

    // Same payload shape as a real token, wrong key: this is what a forged
    // cookie looks like, and it must not be distinguishable from garbage.
    const forged = jwt.sign(
        { id: user.id, username: user.username },
        'definitely-not-the-secret',
        { expiresIn: '7d' }
    );

    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', `token=${forged}`);

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid token');
});

test('expired token -> 401 Token expired', async () => {
    const user = await createUser();

    // Explicit past `exp` rather than a negative expiresIn, so the intent is
    // readable. jsonwebtoken checks exp before we ever touch the DB.
    const expired = jwt.sign(
        {
            id: user.id,
            username: user.username
        },
        process.env.JWT_SECRET,
        { expiresIn: -60 }
    );

    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', `token=${expired}`);

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Token expired');
});

test('valid token for a hard-deleted user -> 401 User no longer exists', async () => {
    const user = await createUser();
    await prisma.user.delete({ where: { id: user.id } });

    // The token is still cryptographically perfect; only the DB lookup fails.
    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', cookieFor(user));

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'User no longer exists');
});

test('valid token for a soft-deleted user(not past GRACE_DAYS) -> 401 and no writes', async () => {
    const deletedAt = new Date();
    const user = await createUser({
        username: 'softdeleted',
        deletedAt,
    });

    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', cookieFor(user));

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'User no longer exists');

    // The middleware must not "helpfully" anonymize or clear anything on a
    // failed auth: the row is still an untouched tombstone.
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.notEqual(after.deletedAt, null);
    assert.equal(after.username, 'softdeleted');
    assert.equal(after.displayName, 'softdeleted');
});

test('valid token past the grace window -> 401 (deletion does not reopen)', async () => {
    const pastGrace = new Date(
        Date.now() - (GRACE_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    const user = await createUser({ deletedAt: pastGrace });

    const res = await request(app)
        .get('/auth/check')
        .set('Cookie', cookieFor(user));

    // Same status as the in-window case: a token is never a way back in.
    // Restoring is login's job, and only inside the window.
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'User no longer exists');
});
