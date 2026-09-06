const { Router } = require('express');
const appController = require('../controllers/appController');
const authRouter = require('./authRotues');
const { authenticateToken } = require('../middlewares/auth');
const { userUpdateValidaiton, validate } = require('../middlewares/validation');
const appRouter = Router();

appRouter.use('/', authRouter);
appRouter.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
//get other user profile
appRouter.get('/api/profile/:id',
    authenticateToken,
    appController.getProfile
);
//jwt user routes
appRouter.get('/api/user',
    authenticateToken,
    appController.getUser
);
appRouter.post('/api/user',
    userUpdateValidaiton,
    validate,
    authenticateToken,
    appController.updateUser
);

appRouter.delete('/api/user',
    authenticateToken,
    appController.deleteUser
);
//long/  polling paths
//conversation/message routes:
//
//starting a new group chat
appRouter.post('/api/dm',
    authenticateToken,
    appController.createDm
);
//starting a new group chat
appRouter.post('/api/groupChat',
    authenticateToken,
    appController.createGroupChat
);
//TODO:split the conversation routes to DMs and GCs
//and work on their respectice controllers
//
//sending a message in a conversation
// appRouter.post('/api/conversations/:conversationId/messages',
//     authenticateToken,
//     appController.createMessage
// );
// //getting all the converations of the user
// appRouter.get('/api/conversations',
//     authenticateToken,
//     appController.getConversation
// );
// //marking messages as read
// appRouter.post('/api/conversations/:conversationId/messages/:messageId/read',
//     authenticateToken,
//     appController.messagesRead
// );
// //fetching a conversations messags
// appRouter.get('/api/conversations/:conversationId/messages',
//     authenticateToken,
//     appController.conversationFetch
// );
// TODO:add reply routes/feature
// TODO:add pinned message routes/feature
// TODO:add pinned conversation routes/feature
module.exports = appRouter;
