const { Router } = require('express');
const appController = require('../controllers/appController');
const authRouter = require('./authRotues');
const { authenticateToken } = require('../middlewares/auth');
const appRouter = Router();

appRouter.use('/', authRouter);

appRouter.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

appRouter.get('/api/profile',
    authenticateToken,
    appController.getProfile
);

module.exports = appRouter;
