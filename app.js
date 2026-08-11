const express = require('express');
const appRouter = require('./routes/appRoutes');
const prisma = require('./db/prisma');
const cors = require('cors');
const passport = require('passport');
const cookieParser = require('cookie-parser');
const app = express();

const allowedOrigins = [
    'http://localhost:5173',
    //messagign app frontend deployment url
];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/', appRouter);
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.statusCode || 500).send(err.message);
});
module.exports = app;
