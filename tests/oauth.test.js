const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { findOrCreateOAuthUser } = require('../config/passport');
const { Provider } = require('../generated/prisma')
const prisma = require('../db/prisma');
const { resetDb } = require('./helpers/db');
const { createUser } = require('./helpers/factories');
const { GRACE_DAYS } = require('../utils/accountLifecycle');

beforeEach(resetDb);
after(() => prisma.$disconnect());
//just teesting on if branches lets see what happens
const oauthLogin = (overrides = {}) => findOrCreateOAuthUser({
    provider: Provider.GOOGLE,
    providerId: 'google_1',
    email: null,
    emailVerifiedByProvider: false,
    displayName: 'OAuth user',
    picture: null,
    ...overrides,
});
test('The incoming email belongs to a DIFFERENT live account -> ok:false', async () => {
    await createUser({
        password: null,
        provider: Provider.GOOGLE,
        providerId: 'google_1',
    });

    await createUser({
        email: 'sameemail@gmail.com',
    });
    const before = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    const result = await oauthLogin({
        email: 'sameemail@gmail.com',
    })
    const after = await prisma.user.findMany({ orderBy: { id: 'asc' } });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'another account already uses this email');
    assert.deepEqual(after, before);

});



