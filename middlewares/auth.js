const cookieParser = require('cookie-parser');
const prisma = require('../db/prisma');
if (process.env.NODE_ENV !== 'production') {
    require('@dotenvx/dotenvx').config();
}
const jwt = require('jsonwebtoken');
const { httpError } = require('../utils/respond');

exports.authenticateToken = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return next(httpError(401, 'No token provided'));
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // id is the primary key so findUnique can use it; deletedAt: null is an
        // extra filter prisma applies on top, so a soft-deleted user is rejected.
        const userExists = await prisma.user.findUnique({
            where: { id: decoded.id, deletedAt: null },
            select: { id: true }
        });

        if (!userExists) {
            return next(httpError(401, 'User no longer exists'));
        }

        req.user = decoded;
        next();
    } catch (err) {
        // jwt.verify throws these two for a bad/expired token, which is the
        // client's problem -> 401. anything else is a real bug -> next(err).
        if (err.name === 'TokenExpiredError') {
            return next(httpError(401, 'Token expired'));
        }
        if (err.name === 'JsonWebTokenError') {
            return next(httpError(401, 'Invalid token'));
        }
        next(err);
    }
};
