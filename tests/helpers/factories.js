const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../../db/prisma');
const app = require('../../app');

// Arranging state for a test: users, conversations, messages.
//
// These write to the DB DIRECTLY, not through the API. That is on purpose:
// a test about messages must not fail because signup or login changed. The
// exception is loginAs() below, which goes through POST /auth/login because
// the cookie it produces is itself part of what most tests exercise.
//
// Anything that IS the thing under test must be called through HTTP in the
// test, never through a factory here.

const DEFAULT_PASSWORD = 'secret123';

// Hashing costs ~100ms at cost 10, and almost every factory call uses the
// same password. Hash it ONCE at module load and reuse the digest; a custom
// password override still gets hashed on demand.
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

// A short random suffix on usernames/emails. resetDb() already guarantees an
// empty table, so this is not strictly needed - it exists so a failing test
// is easy to read ("user_3f9a1b2c" is obviously a fixture) and so a test that
// forgets cleanup can't collide with the next one by accident.
function suffix() {
    return randomUUID().slice(0, 8);
}

// Creates a user with sensible defaults. Any column can be overridden:
//
//   createUser()                                  // verified? no
//   createUser({ emailVerified: new Date() })     // verified
//   createUser({ password: null, provider: 'GOOGLE', providerId: '123' })
//   createUser({ deletedAt: new Date() })         // inside the grace window
//   createUser({ email: null })                   // OAuth row with no email
//
// password is accepted as PLAINTEXT and hashed here, so callers never have to
// remember to hash. `password: null` means "OAuth-only account".
async function createUser(overrides = {}) {
    const {
        username = `user_${suffix()}`,
        email = `${username}@example.com`,
        displayName = username,
        password = DEFAULT_PASSWORD,
        ...rest
    } = overrides;

    let passwordHash = null;
    if (password !== null) {
        passwordHash = password === DEFAULT_PASSWORD
            ? DEFAULT_PASSWORD_HASH
            : await bcrypt.hash(password, 10);
    }

    return prisma.user.create({
        data: {
            username,
            email,
            displayName,
            password: passwordHash,
            ...rest,
        },
    });
}

// The common case for app routes: requireVerified 403s every fixture whose
// email isn't verified, so tests that call /api/* need this preset. It is a
// wrapper, not a replacement - createUser above is still the only way to make
// signup-state (unverified), OAuth-only, deleted, or email-less users.
async function createVerifiedUser(overrides = {}) {
    // spread order matters: an explicit emailVerified in overrides wins, so a
    // test can still ask for an unverified user on purpose.
    return createUser({ emailVerified: new Date(), ...overrides });
}

// Mirrors what POST /api/conversations writes for group/channel creation: the
// conversation row plus the creator as OWNER. Pass `participants` to add more
// members in the same call.
async function createConversation({
    conversationType = 'GROUPCHAT',
    name = null,
    dmKey = null,
    createdBy = null,
    participants = [],
    ...rest
} = {}) {
    return prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.create({
            data: { conversationType, name, dmKey, ...rest },
        });

        if (createdBy) {
            await tx.conversationParticipant.create({
                data: {
                    userId: createdBy.id,
                    conversationId: conversation.id,
                    role: 'OWNER',
                },
            });
        }

        const others = participants.filter((user) => user.id !== createdBy?.id);
        if (others.length > 0) {
            await tx.conversationParticipant.createMany({
                data: others.map((user) => ({
                    userId: user.id,
                    conversationId: conversation.id,
                })),
            });
        }

        return conversation;
    });
}

// Same shape the createDm helper in appController produces: one DM row with a
// canonical dmKey (sorted ids, so the pair is unique in either order) plus two
// participants.
async function createDm(userA, userB) {
    const dmKey = [userA.id, userB.id].sort((a, b) => a - b).join('_');

    return prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.create({
            data: { conversationType: 'DM', dmKey },
        });
        await tx.conversationParticipant.createMany({
            data: [
                { userId: userA.id, conversationId: conversation.id },
                { userId: userB.id, conversationId: conversation.id },
            ],
        });
        return conversation;
    });
}

async function addParticipant(conversation, user, role = 'MEMBER') {
    return prisma.conversationParticipant.create({
        data: {
            userId: user.id,
            conversationId: conversation.id,
            role,
        },
    });
}

// Also bumps Conversation.lastMessageAt, mirroring POST /messages. Tests
// arrange through this factory, so activity ordering would be untestable if
// only the controller bumped it.
async function createMessage({
    conversation,
    author,
    content = 'hello',
    ...rest
}) {
    return prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
            data: {
                content,
                conversationId: conversation.id,
                userId: author.id,
                ...rest,
            },
        });
        await tx.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: message.createdAt },
        });
        return message;
    });
}

// Logs in through the REAL route, so the cookie is exactly what a browser
// would get: bcrypt check, JWT payload, cookie flags, all of it.
//
// Returns only the "token=..." pair. That is what supertest wants for
// `.set('Cookie', ...)`, and it drops Path/HttpOnly/Expires attributes that
// are meaningless when the test sends the header itself. A test that needs to
// assert those flags should inspect the login response directly instead.
async function loginAs(user, password = DEFAULT_PASSWORD) {
    const res = await request(app)
        .post('/auth/login')
        .send({ username: user.username, password });

    if (res.status !== 200) {
        // Fail here, not three assertions later with a confusing 401. The
        // status and body say which part broke (user missing? password?).
        throw new Error(
            `loginAs(${user.username}) failed: ${res.status} ${JSON.stringify(res.body)}`
        );
    }

    const header = res.headers['set-cookie']?.find((c) => c.startsWith('token='));
    if (!header) {
        throw new Error(`loginAs(${user.username}) returned no token cookie`);
    }
    return header.split(';')[0];
}

// A signed cookie WITHOUT going through the login route. Use this only when
// login is supposed to fail or is not what is being tested - e.g. a deleted
// user must still be rejected by authenticateToken, so we need a token that
// was valid when it was issued. It signs the same payload authController uses,
// so authenticateToken treats it identically.
function cookieFor(user) {
    const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
    return `token=${token}`;
}

module.exports = {
    DEFAULT_PASSWORD,
    createUser,
    createVerifiedUser,
    createConversation,
    createDm,
    addParticipant,
    createMessage,
    loginAs,
    cookieFor,
};
