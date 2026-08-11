const cookieParser = require('cookie-parser');
const prisma = require('../db/prisma');
if (process.env.NODE_ENV !== 'production') {
    require('@dotenvx/dotenvx').config();
}
const jwt = require('jsonwebtoken');

exports.authenticateToken = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const userExists = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true }
        });

        if (!userExists) {
            return res.status(401).json({ error: 'User no longer exists' });
        }

        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error(err);
        res.status(500).json({ error: 'Authentication error' });
    }
};

