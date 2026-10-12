const { normalizeEmail } = require('../utils/normalize')
const { body, param, query, validationResult } = require('express-validator');
exports.signupValidation = [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('displayName').trim().notEmpty().withMessage('displayname is required'),
    body('email')
        .customSanitizer(normalizeEmail)
        .isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

exports.loginValidation = [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
];
//TODO: doing now
// request-code takes NO body: the email comes from the logged-in user's own
// row (see requestCode). There is nothing to validate, so this route skips
// validation middleware entirely — the rate limiter + authenticateToken are
// the guards.
exports.verifyCodeValidation = [
    body('code').trim().matches(/^\d{6}$/).withMessage('Code must be 6 digits')
];
//NOTE:when image uploading is done im gonna add a regex check here based on image upload service
exports.userUpdateValidation = [
    body('newUsername')
        .optional()
        .trim()
        .notEmpty().withMessage('Username cannot be empty')
        .isLength({ min: 3, max: 30 }).withMessage('Username must be between 3 and 30 characters'),

    body('newDisplayName')
        .optional()
        .trim()
        .notEmpty().withMessage('Display name cannot be empty')
        .isLength({ max: 50 }).withMessage('Display name must be at most 50 characters'),

    body('newEmail')
        .optional()
        .customSanitizer(normalizeEmail)
        .notEmpty().withMessage('Email cannot be empty')
        .isEmail().withMessage('Valid email is required'),
];
exports.passwordSetForOAuthValidaiton = [
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];
exports.resetPasswordValidaiton = [
    body('currentPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

exports.createConversationValidation = [
    body('conversationParticipantsIds')
        .optional()
        .notEmpty().withMessage('conversationParticipantsIds is required')
        .isArray({ min: 0, max: 100 }).withMessage('conversationParticipantsIds must be an array between 0 and 100 size'),
    body('conversationParticipantsIds.*')
        .optional()
        .isInt().withMessage('each participant id must be an integer')
        .toInt(),
    body('targetUserId')
        .optional()
        .notEmpty().withMessage('targetUserId is required')
        .isInt().withMessage('targetUserId should be integer')
        .toInt(),
    body('conversationName')
        .optional()
        .notEmpty().withMessage('conversationName is required')
        .isString().withMessage('conversationName should be string'),
    body('conversationType')
        .notEmpty().withMessage('conversationType is required')
        .isIn(['DM', 'GROUPCHAT', 'CHANNEL']).withMessage('conversationType must be DM,GROUPCHAT,CHANNEL'),
    body().custom((_, { req }) => {
        const { conversationType, conversationName, conversationParticipantsIds, targetUserId } = req.body;
        if (conversationType === 'DM' && targetUserId === undefined) {
            throw new Error('you need to provide targetUserId for DM');
        }
        if (targetUserId === req.user.id) {
            throw new Error(' you can not have DM with yourself');
        }
        if ((conversationType === 'GROUPCHAT' || conversationType === 'CHANNEL') && conversationName === undefined) {
            throw new Error(`you need to provide conversationName for ${conversationType}`);
        }
        return true;
    }),
];
exports.addConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('conversationId is required')
        .isInt().withMessage('conversationId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('targetUserId is required')
        .isInt().withMessage('targetUserId must be an integer').toInt()
];
exports.deleteConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('conversationId is required')
        .isInt().withMessage('conversationId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('targetUserId is required')
        .isInt().withMessage('targetUserId must be an integer').toInt()
];
exports.promoteConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('conversationId is required')
        .isInt().withMessage('conversationId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('targetUserId is required')
        .isInt().withMessage('targetUserId must be an integer').toInt()
];
exports.demoteConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('conversationId is required')
        .isInt().withMessage('conversationId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('targetUserId is required')
        .isInt().withMessage('targetUserId must be an integer').toInt()
];
exports.deleteConversationValidation = [
    param('conversationId')
        .notEmpty().withMessage('conversationId is required')
        .isInt().withMessage('conversationId must be an integer').toInt(),
];
exports.getUsersConversationsValidation = [
    query('after')
        .optional()
        .isInt({ min: 1 }).withMessage('after must be a positive integer')
        .toInt(),
    query('before')
        .optional()
        .isInt({ min: 1 }).withMessage('before must be a positive integer')
        .toInt()
        .custom((value, { req }) => {
            if (value !== undefined && req.query.after !== undefined) {
                throw new Error('cannot provide both before and after');
            }
            return true;
        }),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100')
        .toInt()
];
exports.getConversationMessagesValidation = [
    param('conversationId')
        .isInt().withMessage('conversationId must be an integer')
        .toInt(),
    query('after')
        .optional()
        .isInt({ min: 1 }).withMessage('after must be a positive integer')
        .toInt(),
    query('before')
        .optional()
        .isInt({ min: 1 }).withMessage('before must be a positive integer')
        .toInt()
        .custom((value, { req }) => {
            if (value !== undefined && req.query.after !== undefined) {
                throw new Error('cannot provide both before and after');
            }
            return true;
        }),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100')
        .toInt()
];
exports.messagesReadValidation = [
    param('conversationId')
        .isInt().withMessage('conversationId must be an integer')
        .toInt(),
    query('from')
        .isInt({ min: 1 }).withMessage('lower limit should be an integer greater or equal to 1')
        .toInt(),
    query('to')
        .isInt().withMessage('upper limit should be an integer')
        .toInt()
        .custom((value, { req }) => {
            if (value < req.query.from) {
                throw new Error('to must be greater than or equal to from');
            }
            return true;
        })
];
exports.createMessageValidation = [
    param('conversationId')
        .notEmpty().withMessage('conversationId is required')
        .isInt().withMessage('conversationId must be an integer')
        .toInt(),
    body('messageContent')
        .trim()
        .notEmpty().withMessage('messageContent is required')
        .isLength({ max: 5000 }).withMessage('messageContent is too long(it should be lower than 5000 charachter)')
];
exports.deleteMessageValidation = [
    param('conversationId')
        .notEmpty().withMessage('conversationId is required')
        .isInt().withMessage('conversationId must be an integer')
        .toInt(),
    body('messageIds')
        .notEmpty().withMessage('messageIds is required')
        .isArray({ min: 1 }).withMessage('messageIds must be an array'),
    body('messageIds.*')
        .isInt().withMessage('each message id must be an integer')
        .toInt(),
];
exports.validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};
