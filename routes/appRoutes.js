const { Router } = require('express');
const appController = require('../controllers/appController');
const authRouter = require('./authRoutes.js');
const { authenticateToken } = require('../middlewares/auth');
const { readLimiter, writeLimiter, conversationLimiter, messageLimiter } = require('../middlewares/rateLimiter');
const {
    addConversationParticipantValidation,
    userUpdateValidation,
    validate,
    deleteConversationParticipantValidation,
    deleteConversationValidation,
    createMessageValidation,
    deleteMessageValidation,
    messagesReadValidation,
    promoteConversationParticipantValidation,
    demoteConversationParticipantValidation,
    createConversationValidation,
    getConversationMessagesValidation,
    getUsersConversationsValidation,
} = require('../middlewares/validation');
const appRouter = Router();

appRouter.use('/', authRouter);
appRouter.get('/api/health',
    appController.health
);
//get other user profile
appRouter.get('/api/profile/:targetUserId',
    readLimiter,
    authenticateToken,
    appController.getProfile
);
//jwt user routes
appRouter.get('/api/user',
    readLimiter,
    authenticateToken,
    appController.getUser
);
appRouter.post('/api/user',
    writeLimiter,
    authenticateToken,
    userUpdateValidation,
    validate,
    appController.updateUser
);

appRouter.delete('/api/user',
    writeLimiter,
    authenticateToken,
    appController.deleteUser
);
//TODO:
//disable other people being able to add u to conversation
// appRouter.post('/api/user',
//     authenticateToken,
//     appController.disableInvite
// );
//enable other people being able to add u to conversation
// appRouter.post('/api/user',
//     authenticateToken,
//     appController.enableInvite
// );

//create new conversation
appRouter.post('/api/conversations',
    conversationLimiter,
    authenticateToken,
    createConversationValidation,
    validate,
    appController.createConversation
);
//get users conversations(with pagination like getConversationMesasges)
//api/conversations?before=value1&limit=value2
appRouter.get('/api/conversations',
    readLimiter,
    authenticateToken,
    getUsersConversationsValidation,
    validate,
    appController.getUsersConversations
);
//delete a conversation
appRouter.delete('/api/conversations/:conversationId',
    conversationLimiter,
    authenticateToken,
    deleteConversationValidation,
    validate,
    appController.deleteConversation
);
//add a participant to a conversation
appRouter.post('/api/conversations/:conversationId/participants/:targetUserId',
    writeLimiter,
    authenticateToken,
    addConversationParticipantValidation,
    validate,
    appController.addConversationParticipant
);
//delete a participant
appRouter.delete('/api/conversations/:conversationId/participants/:targetUserId',
    writeLimiter,
    authenticateToken,
    deleteConversationParticipantValidation,
    validate,
    appController.deleteConversationParticipant
);
appRouter.post('/api/conversations/:conversationId/participants/:targetUserId/promote',
    writeLimiter,
    authenticateToken,
    promoteConversationParticipantValidation,
    validate,
    appController.promoteConversationParticipant
);
appRouter.post('/api/conversations/:conversationId/participants/:targetUserId/demote',
    writeLimiter,
    authenticateToken,
    demoteConversationParticipantValidation,
    validate,
    appController.demoteConversationParticipant
);
//sending a message in a conversation
appRouter.post('/api/conversations/:conversationId/messages',
    messageLimiter,
    authenticateToken,
    createMessageValidation,
    validate,
    appController.createMessage
);
//deleting a message in a conversation
appRouter.delete('/api/conversations/:conversationId/messages',
    messageLimiter,
    authenticateToken,
    deleteMessageValidation,
    validate,
    appController.deleteMessage
);
//get conversation's messages(with pagination)
//api/conversations/:conversationId/messages?before=value1&limit=value2
appRouter.get('/api/conversations/:conversationId/messages',
    readLimiter,
    authenticateToken,
    getConversationMessagesValidation,
    validate,
    appController.getConversationMessages
);
//marking messages as read(get from& to in query as range of messages read)
//api/conversations/:conversationId/messages/read?from=value1&to=value2
appRouter.post('/api/conversations/:conversationId/messages/read',
    writeLimiter,
    authenticateToken,
    messagesReadValidation,
    validate,
    appController.messagesRead
);

// TODO:add reply routes/feature
// TODO:add pinned message routes/feature
// TODO:add pinned conversation routes/feature
//
module.exports = appRouter;
