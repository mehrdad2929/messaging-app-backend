const { body, param, query, validationResult } = require('express-validator');
const { Role, ConversationType } = require('../generated/prisma')
exports.signupValidation = [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('displayName').trim().notEmpty().withMessage('displayname is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

exports.loginValidation = [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
];
//TODO:when image uploading is done im gonna add a regex check here based on image upload service
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
        .trim()
        .notEmpty().withMessage('Email cannot be empty')
        .isEmail().withMessage('Valid email is required')
        .normalizeEmail(),
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
        .isArray().withMessage('conversationParticipantsIds must be an array'),
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
        .notEmpty().withMessage('userId is required')
        .isIn(['DM', 'GROUPCHAT', 'CHANNEL']).withMessage('conversationType must be DM,GROUPCHAT,CHANNEL'),
    body().custom((_, { req }) => {
        const { conversationType, conversationName, conversationParticipantsIds } = req.body;
        if (conversationType === 'DM' && req.body.targetUserId === undefined) {
            throw new Error('you need to provide targetUserId for DM');
        } if ((conversationType === 'GROUPCHAT' || conversationType === 'CHANNEL') && req.body.conversationName === undefined) {
            throw new Error(`you need to provide conversationName for ${conversationType}`);
        }
        return true;
    })
];
exports.addConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('userId is required')
        .isInt().withMessage('conversationId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('targetUserId is required')
        .isInt().withMessage('targetId must be an integer').toInt()
];
exports.deleteConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('userId is required')
        .isInt().withMessage('userId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('targetUserId is required')
        .isInt().withMessage('targetUserId must be an integer').toInt()
];
exports.promoteConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('userId is required')
        .isInt().withMessage('userId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('userId is required')
        .isInt().withMessage('userId must be an integer').toInt()
];
exports.demoteConversationParticipantValidation = [
    param('conversationId')
        .notEmpty().withMessage('userId is required')
        .isInt().withMessage('userId must be an integer').toInt(),
    param('targetUserId')
        .notEmpty().withMessage('userId is required')
        .isInt().withMessage('userId must be an integer').toInt()
];
exports.deleteConversationValidation = [
    param('conversationId')
        .notEmpty().withMessage('userId is required')
        .isInt().withMessage('userId must be an integer').toInt(),
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
        .isInt({ min: 1 }).withMessage('lower limit should be an integer greater or equal to 0')
        .toInt(),
    query('to')
        .isInt().withMessage('upper limit should be an integer')
        .toInt()
        .custom((value, { req }) => {
            if (value <= req.query.from) {
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
        .isInt().withMessage('each participant id must be an integer')
        .toInt(),
];
exports.validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};
