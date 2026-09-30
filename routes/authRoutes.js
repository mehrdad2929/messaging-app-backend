const { Router } = require('express');
const authController = require('../controllers/authController');
const { loginValidation, validate, signupValidation, resetPasswordValidaiton, passwordSetForOAuthValidaiton } = require("../middlewares/validation");
const { authenticateToken } = require('../middlewares/auth');
const { authLimiter, checkLimiter, readLimiter } = require('../middlewares/rateLimiter');
const authRouter = Router();
//for more auth can also check ip with jwt(so preventing token theft usegae on other devicesa aka one more layer of security)
authRouter.post('/auth/signup',
    authLimiter,
    signupValidation,
    validate,
    authController.signup
);
authRouter.post('/auth/login',
    authLimiter,
    loginValidation,
    validate,
    authController.login
);
authRouter.post('/auth/passwordSetForOAuth',
    checkLimiter,
    authenticateToken,
    passwordSetForOAuthValidaiton,
    validate,
    authController.passwordSetForOAuth
);
authRouter.post('/auth/passwordReset',
    checkLimiter,
    authenticateToken,
    resetPasswordValidaiton,
    validate,
    authController.passwordReset
);

authRouter.get('/auth/google', readLimiter, authController.googleAuth);
authRouter.get('/auth/google/callback', authController.googleCallback);
authRouter.get('/auth/github', readLimiter, authController.githubAuth);
authRouter.get('/auth/github/callback', authController.githubCallback);

authRouter.get('/auth/check', checkLimiter, authenticateToken, authController.checkAuth);

authRouter.post('/auth/logout', authController.logout); // worth adding — clears the cookie

module.exports = authRouter;
