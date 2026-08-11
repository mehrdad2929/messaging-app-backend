const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const prisma = require('../db/prisma');
if (process.env.NODE_ENV !== 'production') {
    require('@dotenvx/dotenvx').config();
}

let initialized = false;

function generateUsername(displayName, email, provider) {
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
                const email = profile.emails?.[0]?.value;
                const providerId = profile.id;
                const provider = 'google';
                const displayName = profile.displayName;
                const picture = profile.photos?.[0]?.value;

                let user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { provider: provider, providerId: providerId },
                            { email: email, provider: null }
                        ]
                    }
                });

                if (user && user.provider !== provider) {
                    user = await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            provider: provider,
                            providerId: providerId,
                            picture: picture
                        }
                    });
                } else if (!user) {
                    const baseUsername = generateUsername(displayName, email, provider);
                    const username = await findAvailableUsername(baseUsername);

                    user = await prisma.user.create({
                        data: {
                            username: username,
                            email: email,
                            displayName: displayName,
                            picture: picture,
                            provider: provider,
                            providerId: providerId,
                            password: null
                        }
                    });
                }

                return done(null, user);
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
                const email = profile.emails?.[0]?.value || profile._json?.email;
                const providerId = profile.id;
                const provider = 'github';
                const displayName = profile.displayName || profile.username;
                const picture = profile.photos?.[0]?.value || profile._json?.avatar_url;

                let user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { provider: provider, providerId: providerId },
                            { email: email, provider: null }
                        ]
                    }
                });

                if (user && user.provider !== provider) {
                    user = await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            provider: provider,
                            providerId: providerId,
                            picture: picture
                        }
                    });
                } else if (!user) {
                    const baseUsername = generateUsername(profile.username, email, provider);
                    const username = await findAvailableUsername(baseUsername);

                    user = await prisma.user.create({
                        data: {
                            username: username,
                            email: email,
                            displayName: displayName,
                            picture: picture,
                            provider: provider,
                            providerId: providerId,
                            password: null
                        }
                    });
                }

                return done(null, user);
            } catch (error) {
                console.error('GitHub OAuth Error:', error);
                return done(error, null);
            }
        }
    )
);
module.exports = passport;
module.exports.initialized = true;
