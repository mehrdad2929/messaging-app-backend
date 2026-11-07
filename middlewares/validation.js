const { normalizeEmail } = require('../utils/normalize')
const { body, param, query, validationResult } = require('express-validator');
// Conversation list cursors are "<epochMillis>_<conversationId>". The id is
// the tiebreak for lastMessageAt, which is not unique. Decode here so a bad
// cursor is a 400 instead of a Prisma 500.
const isConversationCursor = (value) => {
    if (typeof value !== 'string' || !/^\d+_\d+$/.test(value)) return false;
    const [at, id] = value.split('_').map(Number);
    return Number.isSafeInteger(at)
        && Number.isSafeInteger(id)
        && !Number.isNaN(new Date(at).getTime());
};
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
    body('conversationType')
        .isIn(['DM', 'GROUPCHAT', 'CHANNEL'])
        .withMessage('conversationType must be DM, GROUPCHAT or CHANNEL'),
    body('targetUserId')
        .if(body('conversationType').equals('DM'))
        .exists().withMessage('targetUserId is required for a DM').bail()
        .isInt({ min: 1 }).withMessage('targetUserId must be a positive integer')
        .toInt(),
    body('conversationName')
        .if(body('conversationType').isIn(['GROUPCHAT', 'CHANNEL']))
        .exists().withMessage('conversationName is required for a group or channel').bail()
        .isString().withMessage('conversationName must be a string').bail()
        .trim()
        .notEmpty().withMessage('conversationName is required for a group or channel')
        .isLength({ max: 100 }).withMessage('conversationName must be at most 100 characters'),
    body('conversationParticipantsIds')
        .optional()
        .isArray({ max: 100 }).withMessage('conversationParticipantsIds must be an array of at most 100 ids'),
    body('conversationParticipantsIds.*')
        .isInt({ min: 1 }).withMessage('each participant id must be a positive integer')
        .toInt(),
];

const participantParamsValidation = [
    param('conversationId').isInt({ min: 1 }).withMessage('conversationId must be an integer').toInt(),
    param('targetUserId').isInt({ min: 1 }).withMessage('targetUserId must be an integer').toInt(),
];
exports.addConversationParticipantValidation = participantParamsValidation;
exports.deleteConversationParticipantValidation = participantParamsValidation;
exports.promoteConversationParticipantValidation = participantParamsValidation
exports.demoteConversationParticipantValidation = participantParamsValidation;

exports.deleteConversationValidation = [
    param('conversationId')
        .isInt().withMessage('conversationId must be an integer').toInt(),
];
exports.getUsersConversationsValidation = [
    query('after')
        .optional()
        .custom(isConversationCursor).withMessage('after must be a valid cursor'),
    query('before')
        .optional()
        .custom(isConversationCursor).withMessage('before must be a valid cursor')
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
        .isInt().withMessage('conversationId must be an integer')
        .toInt(),
    body('messageContent')
        .trim()
        .notEmpty().withMessage('messageContent is required')
        .isLength({ max: 5000 }).withMessage('messageContent is too long(it should be lower than 5000 charachter)')
];
exports.deleteMessageValidation = [
    param('conversationId')
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
