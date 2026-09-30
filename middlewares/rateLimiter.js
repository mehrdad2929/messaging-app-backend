const rateLimit = require('express-rate-limit');

const makeLimiter = (windowMinutes, max, message = 'too many attempts, please try again later') => rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    windowMs: windowMinutes * 60 * 1000,
    max,
    // NOTE: express-rate-limit sends this body itself and never goes through
    // app.js's error handler, so it can't use utils/respond.js. That means
    // { error: message } here is a hand-written copy of the shape that
    // app.js:36 produces for every other error in the app.
    // If you ever change the error format in app.js, change it here too.
    message: { error: message },
});

exports.authLimiter = makeLimiter(
    15, 10,
    'too many attempts, please try again later'
);

exports.readLimiter = makeLimiter(
    1, 100,
    'too many requests, slow down'
);

exports.writeLimiter = makeLimiter(
    1, 30,
    'too many requests, slow down'
);

exports.conversationLimiter = makeLimiter(
    1, 10,
    'too many conversation actions, slow down'
);

exports.messageLimiter = makeLimiter(
    1, 30,
    'too many messages, slow down'
);

exports.checkLimiter = makeLimiter(
    1, 60,
    'too many requests, slow down'
);

exports.globalLimiter = makeLimiter(
    1, 300,
    'too many requests, slow down'
);
