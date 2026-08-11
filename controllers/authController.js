const cookieParser = require('cookie-parser');
const prisma = require('../db/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
if (process.env.NODE_ENV !== 'production') {
    require('@dotenvx/dotenvx').config();
}

const FRONTEND_URL = process.env.FRONTEND_URL;

const initPassport = () => {
    if (!require('../config/passport').initialized) {
        require('../config/passport');
    }
};

exports.signup = async (req, res, next) => {
    try {
        const { username, email, displayName, password } = req.body;
        const existingUsername = await prisma.user.findUnique({
            where: { username: username }
        });
        if (existingUsername) {
            return res.status(409).json({
                message: "User with this username already exists"
            });
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
        res.status(201).json({ message: 'User created successfully', userId: user.id });
    } catch (error) {
        next(error);
    }
};

exports.login = async (req, res, next) => {
    try {
        const { username, password } = req.body;
        const user = await prisma.user.findUnique({
            where: { username }
        });
        if (!user || user.password == null || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV == 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        })
        res.json({ userId: user.id, logedIn: true });
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
    res.json({ message: 'Logged out successfully' })
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
    res.json({ authenticated: true, user: req.user });
};
