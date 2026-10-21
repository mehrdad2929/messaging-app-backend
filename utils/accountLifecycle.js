const prisma = require('../db/prisma');
const crypto = require('crypto');

// Account deletion GRACE WINDOW (decided in todo.md item O).
//
// deleteUser sets deletedAt and keeps ALL row values for GRACE_DAYS. During
// the window the account is locked out (middlewares/auth.js 401s on
// deletedAt), but a successful PASSWORD login or OAuth identity match
// RESTORES it by clearing deletedAt. Logging in IS the ownership proof, so
// there is no public restore route and no OTP restore. After the window the
// tombstone is anonymized: unique values free up and re-signup works again.
//
// Expiry is applied two ways ON PURPOSE:
//   - lazily, wherever a tombstone blocks something (signup 409, OAuth
//     identity/email refusals) - correctness must not depend on the sweep;
//   - the daily sweep in server.js - so untouched tombstones expire too.
//
// GRACE_DAYS lives in CODE, not .env: it is policy, not a secret (same rule
// as the OTP constants in utils/verification.js).
//
// No extra column exists: the window is DERIVED from deletedAt + GRACE_DAYS.
// One source of truth, so the two can never disagree.

const GRACE_DAYS = 14;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

// True only for a tombstone whose window has ended. A LIVE account
// (deletedAt === null) is never "expired".
function graceExpired(user) {
    return user.deletedAt !== null &&
        Date.now() - user.deletedAt.getTime() >= GRACE_MS;
}

// The moment the window closes. deleteUser returns it as `restorableUntil`
// so the frontend can say "log in before <date> to cancel deletion".
function graceEndedAt(deletedAt) {
    return new Date(deletedAt.getTime() + GRACE_MS);
}

// The tombstone transform. It KEEPS `id`, so Message / MessageRead /
// ConversationParticipant foreign keys stay valid and history survives, and
// it FREES every unique value so the username/email can be registered again.
//
// Field notes against prisma/schema.prisma:
//   - username is NOT nullable  -> must become a placeholder, not null
//   - displayName is NOT nullable -> 'Deleted User', never null
//     (the old commented-out block in deleteUser used null here and would
//      have crashed on the NOT NULL constraint)
//   - email is nullable + unique -> null is fine (Postgres allows many NULLs
//     in a unique column)
//   - provider/providerId are cleared TOGETHER: they form the
//     @@unique([provider, providerId]) identity, and an expired identity left
//     behind would keep the OAuth refusal firing forever
//   - password is left as-is: the row is past its window, so login checks the
//     password and then refuses with 401. Keeping the hash costs nothing and
//     avoids rewriting a credential we no longer need.
//   - deletedAt is left as-is too: clearing it would make the row look LIVE
//     (and the login restore path would then hand it back).
async function anonymizeUser(user) {
    return prisma.user.update({
        where: { id: user.id },
        data: {
            // random suffix: a live user literally named `deleted_<id>` must
            // not collide with the placeholder
            username: `deleted_${user.id}_${crypto.randomBytes(3).toString('hex')}`,
            email: null,
            displayName: 'Deleted User',
            picture: null,
            provider: null,
            providerId: null,
        },
    });
}

// The daily sweep: fully anonymize every tombstone whose window has ended,
// even ones nothing ever touches again (lazy checks only fire on contact).
//
// Why the `startsWith` skip: anonymizing deliberately does NOT clear
// deletedAt (clearing it would make the row look live again), so every future
// sweep would see the same row and rewrite it with a NEW random username,
// forever. The placeholder embeds the row's own id, which nobody can register
// in advance, so it doubles as the "already anonymized" marker - no extra
// column needed.
async function anonymizeExpiredUsers() {
    const expired = await prisma.user.findMany({
        where: {
            deletedAt: {
                not: null,
                lte: new Date(Date.now() - GRACE_MS),
            },
        },
        select: { id: true, username: true },
    });
    let anonymized = 0;
    for (const user of expired) {
        if (user.username.startsWith(`deleted_${user.id}_`)) continue; // done already
        await anonymizeUser(user);
        anonymized++;
    }
    return anonymized;
}

module.exports = {
    GRACE_DAYS,
    graceExpired,
    graceEndedAt,
    anonymizeUser,
    anonymizeExpiredUsers,
};
