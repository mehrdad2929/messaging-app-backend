const cookieParser = require('cookie-parser');
const prisma = require('../db/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ok, created, httpError } = require('../utils/respond');

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
        return created(res, { userId: user.id, authenticated: true });
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
        return ok(res, { userId: user.id, authenticated: true });
    } catch (error) {
        next(error);
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
