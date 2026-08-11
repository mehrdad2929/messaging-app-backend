const { Router } = require('express');
const authController = require('../controllers/authController');
const { loginValidation, validate, signupValidation } = require("../middlewares/validation");
const { authenticateToken } = require('../middlewares/auth');
const authRouter = Router();

authRouter.post('/auth/signup',
    signupValidation,
    validate,
    authController.signup
);

authRouter.post('/auth/login',
    loginValidation,
    validate,
    authController.login
);

authRouter.get('/auth/google', authController.googleAuth);
authRouter.get('/auth/google/callback', authController.googleCallback);
authRouter.get('/auth/github', authController.githubAuth);
authRouter.get('/auth/github/callback', authController.githubCallback);
authRouter.get('/auth/check', authenticateToken, authController.checkAuth);

authRouter.post('/auth/logout', authController.logout); // worth adding — clears the cookie

module.exports = authRouter;
