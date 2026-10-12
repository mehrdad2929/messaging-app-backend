const prisma = require('../db/prisma');
const { httpError } = require('./respond');
const { newCode, hashCode } = require('./otp.js');
const { sendOtpEmail } = require('./mailer.js');

// This file exists for one reason: TWO controllers need "send this user a
// fresh code" (the request-code route in authController, and updateUser in
// appController after an email change). Importing it from one controller
// into the other would tangle them, so the shared logic lives here and both
// require it. Controllers stay thin; this file owns the OTP policy.

// ---- email verification (OTP) tuning ----
// These live HERE, not in .env. .env is for secrets and per-environment
// values (keys, urls, things that differ between laptop and production).
// These three are product policy: identical everywhere, and a reader should
// see the numbers where they're used. Secrets (OTP_PEPPER) and behavior
// switches (DEV_RETURN_CODE) stay in env.
const RESEND_COOLDOWN_SECONDS = 60; // wait this long before sending another code
const CODE_TTL_MINUTES = 10;        // a code dies this long after creation
const MAX_ATTEMPTS = 5;             // wrong guesses before the code is burned

// Shared guts for "send this user a fresh code". Returns the raw code (only
// a ROUTE ever exposes it, and only in dev via DEV_RETURN_CODE).
// Throws 429 via httpError when the cooldown hasn't passed.
async function issueCodeForUser(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || !user.email) {
        throw httpError(404, 'no such user');
    }
    // Cooldown: the newest live code must be older than 60s. Stops double-taps
    // AND attackers burning your email budget. 429 (not a generic ok) so an
    // honest client can show a "wait X seconds" countdown.
    const latest = await prisma.verificationCode.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
    });
    if (
        latest &&
        !latest.consumedAt &&
        Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000
    ) {
        throw httpError(429, 'A code was just sent, please wait before retrying');
    }
    // One live code at a time: burn older unused ones so only the newest
    // email works. (Prevents "which of my 3 codes is right?")
    await prisma.verificationCode.deleteMany({
        where: { userId: user.id, consumedAt: null },
    });
    // RAW goes to the email, HASH goes to the DB (see utils/otp.js for why).
    const code = newCode();
    await prisma.verificationCode.create({
        data: {
            userId: user.id,
            codeHash: hashCode(code).toString('hex'),
            expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
        },
    });
    // Also console-logged in dev — see utils/mailer.js.
    await sendOtpEmail(user.email, code);
    return code;
}

module.exports = { issueCodeForUser, RESEND_COOLDOWN_SECONDS, CODE_TTL_MINUTES, MAX_ATTEMPTS };
