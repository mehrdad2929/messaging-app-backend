require('@dotenvx/dotenvx').config();
const express = require('express');
const appRouter = require('./routes/appRoutes');
const prisma = require('./db/prisma');
const cors = require('cors');
const passport = require('passport');
const cookieParser = require('cookie-parser');
const app = express();
const helmet = require('helmet');
const morgan = require('morgan');
const { globalLimiter } = require('./middlewares/rateLimiter');
const { httpError } = require('./utils/respond');
const allowedOrigins = [
    'http://localhost:5173',
    //messagign app frontend deployment url
];
//if behind a proxy
//app.set('trust proxy', 1)
//for now gonna use moragan
app.use(morgan('dev'));
//TODO:gonna use  pino(pino+http) for later(prod)
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/', globalLimiter, appRouter);
//anything that reaches here matched no route above -> 404
app.use((req, res, next) => {
    next(httpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
});
//ONE place that turns an error into a response. every httpError() you throw
//anywhere in the app ends up here, so all error bodies look the same.
app.use((err, req, res, next) => {
    if (err.statusCode === undefined) {
        // no statusCode means nobody expected this -> it's a BUG, not a user mistake.
        // log the whole thing (prisma/sql/stack) but don't send it: it can leak
        // table names, column names and query fragments to whoever is calling.
        console.error(err);
        return res.status(500).json({ error: 'Something went wrong' });
    }
    // we threw this one on purpose, so the message is safe to show.
    console.log(`[${err.statusCode}] ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
});
module.exports = app;
