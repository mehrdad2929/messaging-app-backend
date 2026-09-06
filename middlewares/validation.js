const { body, validationResult } = require('express-validator');

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

exports.userUpdateValidaiton = [
    body('newUsername').trim().notEmpty().withMessage('Username is required'),
    body('newPicture').trim().notEmpty().withMessage('need a valid url for picture'),
    body('newDisplayName').trim().notEmpty().withMessage('displayname is required'),
    body('newEmail').isEmail().withMessage('Valid email is required'),
];
exports.passwordSetForOAuthValidaiton = [
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];
exports.resetPasswordValidaiton = [
    body('currentPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];
exports.validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};
