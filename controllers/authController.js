const cookieParser = require('cookie-parser');
const prisma = require('../db/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ok, created, httpError } = require('../utils/respond');
const { codesEqual } = require('../utils/otp.js');
const FRONTEND_URL = process.env.FRONTEND_URL;

// The OTP policy (cooldown/TTL/attempts) and issueCodeForUser live in
// utils/verification.js, shared with updateUser in appController — see the
// comment at the top of that file for why it isn't defined here.
const { issueCodeForUser, MAX_ATTEMPTS } = require('../utils/verification');

const initPassport = () => {
    if (!require('../config/passport').initialized) {
        require('../config/passport');
    }
};

exports.signup = async (req, res, next) => {
    try {
        const { username, email, displayName, password } = req.body;
        const existingUsername = await prisma.user.findUnique({
            where: { username }
        });
        if (existingUsername) {
            throw httpError(409, "User with this username already exists");
        }
        const existingEmail = await prisma.user.findUnique({
            where: { email: email }
        });
        if (existingEmail) {
            throw httpError(409, "User with this email already exists");
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                username,
                email,
                displayName,
                password: hashedPassword
            }
        });

        //loging in
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV == 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        })
        // First code goes out HERE, not via the frontend: signup is the one
        // moment we know this email has never received a code, so there is no
        // user intent to wait for — one fewer round trip, zero new failure
        // modes. Login deliberately does NOT send (it happens constantly and
        // every send costs email budget; the banner + resend button covers it).
        // BEST-EFFORT on purpose: the mailer throws in production when SMTP is
        // down/misconfigured, and "email hiccup" must never become "signup
        // failed" (the account exists by now — a 500 here would strand the
        // user on "username already exists" at retry). Failure is logged and
        // the user taps resend (request-code) whenever.
        // OPS NOTE (not implemented): a dead SMTP server is visible ONLY in
        // these server logs. Production needs log monitoring/alerting on
        // repeated [otp] failures, otherwise nobody gets paged while every
        // signup silently skips its code. Tracked in todo.md loose end J.
        let verificationSent = false;
        try {
            await issueCodeForUser(user.id);
            verificationSent = true;
        } catch (mailError) {
            console.error(`[otp] signup code NOT sent for user ${user.id}:`, mailError.message);
        }
        return created(res, { userId: user.id, authenticated: true, verificationSent });
    } catch (error) {
        next(error);
        //should i spent somtimes on the error handling(more gracfully/more specific)
    }
};

exports.login = async (req, res, next) => {
    try {
        const { username, password } = req.body;
        const user = await prisma.user.findUnique({
            where: { username }
        });
        if (!user || user.deletedAt || user.password == null || !(await bcrypt.compare(password, user.password))) {
            throw httpError(401, 'Invalid credentials');
        }
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV == 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        })
        // emailVerified rides along so the frontend can show the verify banner
        // immediately without waiting for a checkAuth round trip. The user row
        // is already in hand (fetched above for the password check), so this
        // costs no extra query. Source of truth stays the DB per request —
        // this flag is a convenience copy, not a second source.
        return ok(res, { userId: user.id, authenticated: true, emailVerified: user.emailVerified !== null });
    } catch (error) {
        next(error);
    }
};

exports.requestCode = async (req, res, next) => {
    // NOTE the third parameter. Express calls handlers as (req, res, next),
    // but if you don't LIST next you can't USE it — the catch below would
    // throw ReferenceError instead of forwarding the error. (err vs error
    // is just a variable name; the missing parameter was the real bug.)
    try {
        // No body needed: the email comes from the logged-in user's OWN row,
        // not from client input. That kills two bugs at once: no trusting a
        // stranger's email address, and no "create a user with email only"
        // problem (username/displayName are required by the schema, so that
        // old find-or-create could never have worked).
        const code = await issueCodeForUser(req.user.id);
        // DEV_RETURN_CODE=true puts the code in the response so you can test
        // with curl and no inbox. NEVER do this in production.
        const body = { message: 'Verification code sent (check console in dev)' };
        if (process.env.NODE_ENV !== 'production' && process.env.DEV_RETURN_CODE === 'true') {
            body.code = code;
        }
        return created(res, body);
    } catch (err) {
        next(err);
    }
};

exports.verifyCode = async (req, res, next) => {
    // Same fix as requestCode: next must be listed to be usable.
    try {
        // Only the code comes from the client now. The user (and their email)
        // comes from the login cookie: req.user.id was put there by
        // authenticateToken, so a caller can only ever verify THEMSELVES.
        // (The old version took an email from the body, letting anyone probe
        // anybody else's codes.)
        const { code } = req.body;
        if (!code) {
            throw httpError(400, 'code is required');
        }

        // Find the user's newest LIVE code (unused, unexpired). One generic
        // message for every failure below — never reveal whether the code
        // expired or the guess was simply wrong.
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const record =
            user &&
            !user.deletedAt &&
            (await prisma.verificationCode.findFirst({
                where: {
                    userId: user.id,
                    consumedAt: null,
                    expiresAt: { gt: new Date() },
                },
                orderBy: { createdAt: 'desc' },
                // my quastion:i dont think we need to orderBy
                //since there is only one code at a time look at 1c
                // claude answer:The catch is that the guarantee isn't airtight. The cooldown check and the
                // delete-then-create are separate steps, so two /request-code calls arriving at the same instant
                // can both pass the check and both create a code. That leaves two live codes. Without orderBy,
                // findFirst returns an arbitrary one, and the user might be checked against the older code while
                // the email they're holding has the newer one.
            }));
        if (!record) {
            // THROW, don't return: returning an Error object sends no response
            // at all (Express ignores handler return values) and the request
            // would hang until the client times out. Throwing lands in the
            // catch below, which forwards to the error funnel in app.js.
            throw httpError(400, 'Invalid or expired code');
        }

        // Check the guess. Wrong guess = attempts + 1, and at MAX_ATTEMPTS
        // the code is burned so it can never be guessed again. (This cap is THE
        // defense that makes 6-digit codes viable: 5 tries out of 1M.)
        if (!codesEqual(String(code).trim(), record.codeHash)) {
            const attempts = record.attempts + 1;
            await prisma.verificationCode.update({
                where: { id: record.id },
                data: {
                    attempts,
                    // Burn on exhaustion: same as "used", just never verified anyone.
                    consumedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
                },
            });
            throw httpError(400, 'Invalid or expired code');
        }

        // ATOMIC update: mark user verified AND burn the code together in
        // a transaction. If either write fails, NEITHER happens — so a code
        // can never be half-used or double-used.
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: record.userId },
                data: { emailVerified: new Date() },
            });
            await tx.verificationCode.update({
                where: { id: record.id },
                data: { consumedAt: new Date() },
            });
        });

        return ok(res, { verified: true, message: 'Email verified successfully' });
    } catch (err) {
        next(err);
    }
};
exports.passwordSetForOAuth = async (req, res, next) => {
    try {
        const { password } = req.body;
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        })
        if (user.password) {
            throw httpError(409, 'this user has a password go to reset password for change');
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.update({
            where: { id: req.user.id },
            data: { password: hashedPassword }
        })
        return ok(res, { message: "password set succefully" });
    } catch (error) {
        next(error);
    }
}
exports.passwordReset = async (req, res, next) => {
    try {
        //logic
        const { currentPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });
        if (!user.password) {
            throw httpError(401, 'this account is authorized with oauth');
        }
        if (!(await bcrypt.compare(currentPassword, user.password))) {
            throw httpError(401, 'wrong current password');
        }
        //gonna add a way to reset with email later for forgoten pass
        if (await bcrypt.compare(newPassword, user.password)) {
            throw httpError(409, 'same Password as before');

            //or later we can use a list of passwords that user used so we here can check
            //if they used the newPassword ever before and error according to that
        }
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: req.user.id },
            data: { password: newHashedPassword }
        })
        return ok(res, { message: "password updated succefully" });
    } catch (error) {
        next(error);
    }
};
exports.logout = (req, res, next) => {
    // to handle cases where not authenticated(not logged in) client hits the logout
    // const token = req.cookies.token;
    // if (!token) {
    //     res.json({ message: 'You are not logged in' })
    // }
    res.clearCookie('token');
    return ok(res, { message: 'Logged out successfully' });
}

exports.googleAuth = (req, res, next) => {
    initPassport();
    const passport = require('passport');
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
};

exports.googleCallback = (req, res, next) => {
    initPassport();
    const passport = require('passport');
    passport.authenticate('google', { session: false }, (err, user) => {
        if (err || !user) {
            return res.redirect(`${FRONTEND_URL}?error=oauth_failed`);
        }
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV == 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        })
        res.redirect(FRONTEND_URL);
    })(req, res, next);
};

exports.githubAuth = (req, res, next) => {
    initPassport();
    const passport = require('passport');
    passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
};

exports.githubCallback = (req, res, next) => {
    initPassport();
    const passport = require('passport');
    //session false means we don't use session(hence serialize deserialize is not used (redundant))
    passport.authenticate('github', { session: false }, (err, user) => {
        if (err || !user) {
            return res.redirect(`${FRONTEND_URL}?error=oauth_failed`);
        }
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV == 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        })
        res.redirect(FRONTEND_URL);
    })(req, res, next);
};
exports.checkAuth = (req, res) => {
    return ok(res, { authenticated: true, user: req.user });
};
