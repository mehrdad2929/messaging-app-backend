const passport = require('passport');
const { Provider } = require('../generated/prisma')
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const prisma = require('../db/prisma');

// NOTE: this file used to hold two separate copies of the login logic (one
// per provider) that drifted apart, plus a blanket "reject anyone whose
// email exists" branch that made the branches below it unreachable. What is
// here now: ONE shared function (findOrCreateOAuthUser) with every case in
// one place, and both strategies just translate their profile into the same
// four facts and call it.

function generateUsername(displayName, email = 'email', provider) {
    let baseUsername;

    if (displayName) {
        baseUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    } else if (email) {
        baseUsername = email.split('@')[0];
    } else {
        baseUsername = `${provider}_user`;
    }

    return baseUsername.substring(0, 30);
}

async function findAvailableUsername(baseUsername) {
    let username = baseUsername;
    let counter = 1;

    while (await prisma.user.findUnique({ where: { username } })) {
        username = `${baseUsername}_${counter}`;
        counter++;
    }

    return username;
}

// Creates the row for a brand-new OAuth user. Kept separate so the decision
// function below stays readable: every "create" path ends up here.
async function createOAuthUser({ provider, providerId, email, emailVerifiedByProvider, displayName, picture }) {
    const baseUsername = generateUsername(displayName, email, provider);
    const username = await findAvailableUsername(baseUsername);
    return prisma.user.create({
        data: {
            username,
            // displayName is required by the schema, but providers may omit
            // it (GitHub user with no name set), so fall back to the username
            // instead of crashing on undefined.
            displayName: displayName || username,
            email,
            picture,
            provider,
            providerId,
            password: null, // OAuth-only for now; they can set one later via passwordSetForOAuth
            // Only stamp verified when the PROVIDER checked the email. Our
            // own OTP check stamps it separately (see verifyCode).
            ...(email && emailVerifiedByProvider ? { emailVerified: new Date() } : {}),
        }
    });
}

// THE decision table. Returns { ok: true, user } or { ok: false, reason }.
// A refusal is not an error: the strategy turns it into
// done(null, false, { message: reason }), which is passport's way of saying
// "nothing broke, but this login is not allowed".
async function findOrCreateOAuthUser({ provider, providerId, email, emailVerifiedByProvider, displayName, picture }) {
    if (email === '') email = null; // providers sometimes send "" instead of null

    // 1. Do we already know this exact login? Same provider AND same id, and
    //    not soft-deleted. This is the happy path: just log them in.
    const oAuthUser = await prisma.user.findFirst({
        where: { provider, providerId, deletedAt: null }
    });

    // 2. Does any live account already own this email? Null when the provider
    //    gave us no email at all (private GitHub email does this).
    const emailUser = email
        ? await prisma.user.findFirst({ where: { email, deletedAt: null } })
        : null;

    // ----- CASE 1: returning user -----
    if (oAuthUser) {
        // The incoming email belongs to a DIFFERENT live account (happens if
        // the user changed their Google email to one that's taken). Refuse
        // rather than steal it. (Same account is fine: emailUser.id === id.)
        if (emailUser && emailUser.id !== oAuthUser.id) {
            return { ok: false, reason: 'another account already uses this email' };
        }
        // First login came with no email, now the provider sends one, and we
        // just proved nobody else owns it -> attach it to their row.
        if (!oAuthUser.email && email) {
            return {
                ok: true,
                user: await prisma.user.update({
                    where: { id: oAuthUser.id },
                    data: {
                        email,
                        // Trust the provider's check: verified there means
                        // verified here.
                        ...(emailVerifiedByProvider ? { emailVerified: new Date() } : {}),
                    }
                })
            };
        }
        // Provider now confirms an email we already had on file -> stamp it.
        if (email && email === oAuthUser.email && emailVerifiedByProvider && !oAuthUser.emailVerified) {
            return {
                ok: true,
                user: await prisma.user.update({
                    where: { id: oAuthUser.id },
                    data: { emailVerified: new Date() }
                })
            };
        }
        return { ok: true, user: oAuthUser };
    }

    // Everything below is a brand-new login (unknown provider+id). But first,
    // one trap: soft-deleted rows STILL hold their unique values
    // (provider+id, email, username), so a "fresh" create would crash with a
    // unique violation. Fail with a clear message instead of a 500.
    const deletedIdentity = await prisma.user.findFirst({
        where: { provider, providerId, deletedAt: { not: null } }
    });
    if (deletedIdentity) {
        return { ok: false, reason: 'this account was deleted. contact support to restore it' };
    }

    // ----- CASE 2: new login, provider gave no email -----
    // Nothing to match on, so just create. Login works via the identity
    // (provider+id); they can attach an email later.
    if (!email) {
        return { ok: true, user: await createOAuthUser({ provider, providerId, email, emailVerifiedByProvider, displayName, picture }) };
    }

    // ----- CASES 3/4/5: new login WITH an email -----
    if (emailUser) {
        // CASE 5: the email lives on the OTHER provider's account.
        // Point them at the right button instead of a dead-end error.
        if (emailUser.provider && emailUser.provider !== provider) {
            return { ok: false, reason: `this email is registered with ${emailUser.provider}, use that login` };
        }
        // CASE 4: the email belongs to a password account (no provider yet).
        // Link ONLY if the provider verified the email. Why so strict?
        // Linking on an unverified claim lets anyone type your email into a
        // Google/GitHub signup and walk into your account (takeover).
        // Google verifies emails; GitHub's basic profile does not (we pass
        // false for it below), so GitHub logins never auto-link for now.
        if (!emailUser.provider) {
            if (!emailVerifiedByProvider) {
                return { ok: false, reason: 'this email already has an account. log in with your password instead' };
            }
            return {
                ok: true,
                user: await prisma.user.update({
                    where: { id: emailUser.id },
                    data: {
                        provider,
                        providerId,
                        picture: picture ?? emailUser.picture,
                        // The provider just proved ownership, so our row is
                        // verified from this moment on.
                        emailVerified: new Date(),
                        // NOTE: the password stays. Both logins keep working.
                    }
                })
            };
        }
        // Leftover edge: same provider but a different providerId somehow
        // (the identity lookup above should have caught it). Refuse loudly
        // rather than guess.
        return { ok: false, reason: 'this email is already linked to a different account' };
    }

    // Same unique-trap as above, for email: a soft-deleted row may still hold
    // it. (Any LIVE row would have been found as emailUser, so a hit here is
    // necessarily a deleted one.) Signup behaves the same way, so this is
    // consistent, not a new rule.
    const deletedEmail = await prisma.user.findFirst({ where: { email } });
    if (deletedEmail) {
        return { ok: false, reason: 'this email belongs to a deleted account. contact support to restore it' };
    }

    // ----- CASE 3: genuinely new email -> create -----
    return { ok: true, user: await createOAuthUser({ provider, providerId, email, emailVerifiedByProvider, displayName, picture }) };
}

passport.use(
    'google',
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const result = await findOrCreateOAuthUser({
                    provider: Provider.GOOGLE,
                    providerId: profile.id,
                    email: profile.emails?.[0]?.value ?? null,
                    // Google tells us whether IT verified the email. Believe
                    // either field; default to untrusted when neither is set.
                    emailVerifiedByProvider: profile.emails?.[0]?.verified === true
                        || profile._json?.email_verified === true,
                    displayName: profile.displayName,
                    picture: profile.photos?.[0]?.value,
                });
                if (!result.ok) {
                    console.log(`[oauth:google] refused ${profile.id}: ${result.reason}`);
                    return done(null, false, { message: result.reason });
                }
                return done(null, result.user);
            } catch (error) {
                console.error('Google OAuth Error:', error);
                return done(error, null);
            }
        }
    )
);

passport.use(
    'github',
    new GitHubStrategy(
        {
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: process.env.GITHUB_CALLBACK_URL || '/auth/github/callback',
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const result = await findOrCreateOAuthUser({
                    provider: Provider.GITHUB,
                    providerId: profile.id,
                    email: profile.emails?.[0]?.value || profile._json?.email || null,
                    // GitHub's basic profile does NOT say whether the email
                    // is verified (that needs a separate user:email API call
                    // plus checking its `verified` flag). So we pass false:
                    // GitHub logins get their own account and never auto-link
                    // to a password account. Safe default; relax it later by
                    // fetching the email list and passing the real flag.
                    emailVerifiedByProvider: false,
                    displayName: profile.displayName || profile.username,
                    picture: profile.photos?.[0]?.value || profile._json?.avatar_url,
                });
                if (!result.ok) {
                    console.log(`[oauth:github] refused ${profile.id}: ${result.reason}`);
                    return done(null, false, { message: result.reason });
                }
                return done(null, result.user);
            } catch (error) {
                console.error('GitHub OAuth Error:', error);
                return done(error, null);
            }
        }
    )
);
module.exports = passport;
// Exported so tests can call the decision logic with fake profiles instead
// of going through Google/GitHub, e.g.
//   findOrCreateOAuthUser({ provider: 'GOOGLE', providerId: 'x', ... })
module.exports.findOrCreateOAuthUser = findOrCreateOAuthUser;
