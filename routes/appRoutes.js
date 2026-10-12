//NOTE:always set up a test(postman,httpie,curl , integeration test ,console log etc(anything basicly))
//environment then write the code
const { Router } = require('express');
const appController = require('../controllers/appController');
const authRouter = require('./authRoutes.js');
const { authenticateToken, requireVerified } = require('../middlewares/auth');
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

// VERIFICATION POLICY (Option B): login stays open; everything that touches
// other users' data or content requires requireVerified AFTER authenticateToken
// (order matters: requireVerified reads req.user, which only authenticateToken
// sets). Deliberately OPEN: health, signup/login/logout/checkAuth (the frontend
// needs checkAuth while unverified — it's how the banner learns the flag
// flipped), request-code/verify-code (the path TO verified), password
// set/reset, updateUser (a typo'd email must stay fixable or the user is
// locked out forever), deleteUser (blocking self-deletion for unverified is
// hostile), OAuth start/callback.
appRouter.use('/', authRouter);
appRouter.get('/api/health',
    appController.health
);
//get other user profile
appRouter.get('/api/profile/:targetUserId',
    readLimiter,
    authenticateToken,
    requireVerified,
    appController.getProfile
);
//jwt user routes
appRouter.get('/api/user',
    readLimiter,
    authenticateToken,
    requireVerified,
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
    requireVerified,
    createConversationValidation,
    validate,
    appController.createConversation
);
//get users conversations(with pagination like getConversationMesasges)
//api/conversations?before=value1&limit=value2
appRouter.get('/api/conversations',
    readLimiter,
    authenticateToken,
    requireVerified,
    getUsersConversationsValidation,
    validate,
    appController.getUsersConversations
);
//delete a conversation
appRouter.delete('/api/conversations/:conversationId',
    conversationLimiter,
    authenticateToken,
    requireVerified,
    deleteConversationValidation,
    validate,
    appController.deleteConversation
);
//add a participant to a conversation
appRouter.post('/api/conversations/:conversationId/participants/:targetUserId',
    writeLimiter,
    authenticateToken,
    requireVerified,
    addConversationParticipantValidation,
    validate,
    appController.addConversationParticipant
);
//delete a participant
appRouter.delete('/api/conversations/:conversationId/participants/:targetUserId',
    writeLimiter,
    authenticateToken,
    requireVerified,
    deleteConversationParticipantValidation,
    validate,
    appController.deleteConversationParticipant
);
appRouter.post('/api/conversations/:conversationId/participants/:targetUserId/promote',
    writeLimiter,
    authenticateToken,
    requireVerified,
    promoteConversationParticipantValidation,
    validate,
    appController.promoteConversationParticipant
);
appRouter.post('/api/conversations/:conversationId/participants/:targetUserId/demote',
    writeLimiter,
    authenticateToken,
    requireVerified,
    demoteConversationParticipantValidation,
    validate,
    appController.demoteConversationParticipant
);
//sending a message in a conversation
appRouter.post('/api/conversations/:conversationId/messages',
    messageLimiter,
    authenticateToken,
    requireVerified,
    createMessageValidation,
    validate,
    appController.createMessage
);
//deleting a message in a conversation
appRouter.post('/api/conversations/:conversationId/messages/delete',
    messageLimiter,
    authenticateToken,
    requireVerified,
    deleteMessageValidation,
    validate,
    appController.deleteMessage
);
//get conversation's messages(with pagination)
//api/conversations/:conversationId/messages?before=value1&limit=value2
appRouter.get('/api/conversations/:conversationId/messages',
    readLimiter,
    authenticateToken,
    requireVerified,
    getConversationMessagesValidation,
    validate,
    appController.getConversationMessages
);
//marking messages as read(get from& to in query as range of messages read)
//api/conversations/:conversationId/messages/read?from=value1&to=value2
appRouter.post('/api/conversations/:conversationId/messages/read',
    writeLimiter,
    authenticateToken,
    requireVerified,
    messagesReadValidation,
    validate,
    appController.messagesRead
);

// TODO:add reply routes/feature
// TODO:add pinned message routes/feature
// TODO:add pinned conversation routes/feature
//
module.exports = appRouter;
