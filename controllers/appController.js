const prisma = require('../db/prisma');
const { Role, ConversationType } = require('../generated/prisma')
const { ok, created, httpError } = require('../utils/respond');
exports.health = async (req, res) => {
    const checks = {
        server: 'ok', // if we're executing this, Express is definitionally up
        database: 'unknown'
    };

    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = 'ok';
    } catch (error) {
        checks.database = 'down';
    }

    const isHealthy = Object.values(checks).every((status) => status === 'ok');

    // one shape for both outcomes: whatever the health is, you get
    // { status, checks, timestamp }. only the status code changes.
    return res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'ok' : 'degraded',
        checks,
        timestamp: new Date().toISOString()
    });
};
exports.getProfile = async (req, res, next) => {
    try {
        const targetUserId = parseInt(req.params.targetUserId);
        const user = await prisma.user.findUnique({
            where: {
                id: targetUserId
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                picture: true,
                deletedAt: true
            }
        });
        if (!user || user.deletedAt) {
            throw httpError(404, 'no such user!');
        }
        return ok(res, { user });
    } catch (error) {
        next(error);
    }
};
exports.getUser = async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                picture: true,
                provider: true,
                createdAt: true,
                deletedAt: true
                //some more info maybe
            }
        });
        if (!user || user.deletedAt) {
            throw httpError(404, 'no such user!');
        }
        return ok(res, { user });
    } catch (error) {
        next(error);
    }
};
exports.updateUser = async (req, res, next) => {
    try {
        const { newUsername, newEmail, newDisplayName, newPicture } = req.body;
        const userId = req.user.id;
        const newUser = await prisma.user.update({
            where: { id: userId },
            data: {
                username: newUsername ?? undefined,
                email: newEmail ?? undefined,
                displayName: newDisplayName ?? undefined,
                picture: newPicture ?? undefined
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                picture: true,
                provider: true,
                createdAt: true,
            }
        });
        return created(res, { user: newUser });
    } catch (error) {
        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0];
            return next(httpError(409, `User with this ${field} already exists`));
        }
        next(error);
    }
};
exports.deleteUser = async (req, res, next) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                deletedAt: new Date(),
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                picture: true,
                provider: true,
                createdAt: true,
                deletedAt: true
            }
        });
        res.clearCookie('token');
        return ok(res, { user });
    } catch (error) {
        next(error);
    }
};

const createDm = async ({ targetUserId, currentUserId }) => {
    const result = await prisma.$transaction(async (tx) => {
        const targetUser = await tx.user.findUnique({
            where: { id: targetUserId }
        });
        if (!targetUser) {
            throw httpError(404, 'no such targetUser');
        }
        const dmKey = [currentUserId, targetUserId].sort((a, b) => a - b).join('_');
        const existingDm = await tx.conversation.findUnique({
            where: {
                dmKey: dmKey,
            }
        });
        if (existingDm) {
            throw httpError(409, 'this Dm already exist')
        }
        const conversation = await tx.conversation.create({
            data: {
                conversationType: ConversationType.DM,
                dmKey
            }
        });
        await tx.conversationParticipant.createMany({
            data: [
                { userId: currentUserId, conversationId: conversation.id },
                { userId: targetUserId, conversationId: conversation.id }
            ]
        })
        return { conversation };
    })
    return result;
}
const createGroupOrChannel = async ({ conversationName, conversationType, currentUserId, conversationParticipantsIds }) => {
    const result = await prisma.$transaction(async (tx) => {
        const existingParticipantsIdsObj = await tx.user.findMany({
            where: {
                id: {
                    in:
                        conversationParticipantsIds
                },
                deletedAt: null
            },
            select: { id: true }
        })
        const conversation = await tx.conversation.create({
            data: { name: conversationName, conversationType }
        })
        const existingParticipantsIds = existingParticipantsIdsObj.map((obj) => obj.id);
        const nonExistingParticipantsIds = conversationParticipantsIds.filter((id) => !existingParticipantsIds.includes(id));
        await tx.conversationParticipant.create({
            data: {
                userId: currentUserId,
                conversationId: conversation.id,
                role: Role.OWNER
            }
        })
        await tx.conversationParticipant.createMany({
            data: existingParticipantsIds.filter((id) => id != currentUserId).map(id => ({
                userId: id,
                conversationId: conversation.id
            })),
            skipDuplicates: true
        })
        return { conversation, existingParticipantsIds, nonExistingParticipantsIds }
    })
    return result;
}
exports.createConversation = async (req, res, next) => {
    try {
        const { conversationType, conversationName, conversationParticipantsIds, targetUserId } = req.body;
        let conversationCreationResult;
        if (conversationType === ConversationType.DM) {
            conversationCreationResult = await createDm({ targetUserId, currentUserId: req.user.id });
        } else if (conversationType === ConversationType.GROUPCHAT || conversationType === ConversationType.CHANNEL) {
            conversationCreationResult = await createGroupOrChannel({
                conversationName,
                conversationType,
                currentUserId: req.user.id,
                conversationParticipantsIds: Array.isArray(conversationParticipantsIds) ? conversationParticipantsIds : []
            });
        } else {
            throw httpError(400, 'invalid conversationType');
        }
        // DM gives back { conversation }, group/channel gives back
        // { conversation, existingParticipantsIds, nonExistingParticipantsIds }.
        // the extra keys only exist for group creation, which is fine.
        return created(res, conversationCreationResult);
    } catch (error) {
        next(error);
    }
};
exports.getUsersConversations = async (req, res, next) => {
    try {
        const limit = Math.min(req.query.limit || 30, 100);
        const before = req.query.before;
        const after = req.query.after;
        const userId = req.user.id;
        const searchingConversations = await prisma.conversation.findMany({
            where: {
                conversationParticipants: {
                    some: { userId, deletedAt: null }
                },
                ...(before && { id: { lt: before } }),
                ...(after && { id: { gt: after } }),
                deletedAt: null

            },
            select: {
                id: true, name: true, conversationType: true
            },
            orderBy: { id: after ? 'asc' : 'desc' },
            take: limit
        })
        const conversations = after ? searchingConversations : searchingConversations.reverse();
        const nextCursor = conversations.length === limit
            ? conversations[after ? conversations.length - 1 : 0].id
            : null;
        return ok(res, { conversations, nextCursor })
    } catch (error) {
        next(error)
    }
};

exports.deleteConversation = async (req, res, next) => {
    try {
        const conversationId = parseInt(req.params.conversationId);
        const result = await prisma.$transaction(async (tx) => {

            const conversation = await tx.conversation.findFirst({
                where: { id: conversationId }
            })
            if (!conversation || conversation.deletedAt) {
                throw httpError(404, "no such conversation")
            }
            const participant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId: req.user.id, conversationId }
                }
            })
            if (!participant || participant.deletedAt) {
                throw httpError(403, "you are not a participant of this conversation")
            }
            if (participant.role !== Role.OWNER) {
                throw httpError(403, "only the conversation owner can do this")
            }
            const deletedConversation = await tx.conversation.update({
                where: { id: conversationId },
                data: {
                    deletedAt: new Date(),
                    deletedById: req.user.id
                },
                omit: {
                    dmKey: true
                }
            })
            return { deletedConversation }
        });
        return ok(res, { conversation: result.deletedConversation })
    } catch (error) {
        next(error)
    }
};
exports.addConversationParticipant = async (req, res, next) => {
    try {
        const { conversationId, targetUserId } = req.params;
        const userId = req.user.id;
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.conversationParticipant.findUnique({
                userId_conversationId: { userId, conversationId }
            })
            if (!user || user.deletedAt) {
                throw httpError(404, "you are not a participant in this conversation");
            }
            if (user.role === Role.MEMBER) {
                throw httpError(403, "you cannot add other members to this conversation");
            }
            const existingConversation = await tx.conversation.findUnique({
                where: {
                    id: conversationId,
                }
            });
            if (!existingConversation || existingConversation.deletedAt) {
                throw httpError(404, "no such a conversation")
            }
            if (existingConversation.conversationType == ConversationType.DM) {
                throw httpError(403, "u can not add new participant to a dm")
            }
            const targetUser = await tx.user.findUnique({
                where: {
                    id: targetUserId,
                }
            });
            if (!targetUser) {
                throw httpError(404, "no such a user")
            }
            const existingParticipant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId: targetUserId, conversationId },
                }
            });

            if (existingParticipant) {
                if (!existingParticipant.deletedAt) {
                    throw httpError(409, "user is already a participant in this conversation");
                }
                const conversationParticipant = await tx.conversationParticipant.update({
                    where: {
                        userId_conversationId: { userId: targetUserId, conversationId }
                    },
                    data: { deletedAt: null, deletedById: null }
                })
                return { conversationParticipant }
            }
            const conversationParticipant = await tx.conversationParticipant.create({
                data: {
                    userId: targetUserId,
                    conversationId
                }
            })
            return { conversationParticipant }
        })
        return created(res, { conversationParticipant: result.conversationParticipant })
    } catch (error) {
        next(error)
    }
};
exports.deleteConversationParticipant = async (req, res, next) => {
    try {
        const { conversationId, targetUserId } = req.params;
        const userId = req.user.id;
        const result = await prisma.$transaction(async (tx) => {
            const existingConversation = await tx.conversation.findUnique({
                where: { id: conversationId }
            });
            if (!existingConversation || existingConversation.deletedAt) {
                throw httpError(404, "no such conversation");
            }
            const user = await tx.conversationParticipant.findUnique({
                where: { userId_conversationId: { userId, conversationId } }
            })
            if (!user || user.deletedAt) {
                throw httpError(403, "you are not a participant in this conversation");
            }
            if (user.role === Role.MEMBER && userId !== targetUserId) {
                throw httpError(403, "you cannot remove other members from this conversation");
            }
            if (existingConversation.conversationType === ConversationType.DM) {
                throw httpError(403, "cannot delete a participant from a DM");
            }
            const targetUser = await tx.conversationParticipant.findUnique({
                where: { userId_conversationId: { userId: targetUserId, conversationId } },

            });
            if (!targetUser || targetUser.deletedAt) {
                throw httpError(404, "this targetUser is not a participant in this conversation");
            }
            if (user.role === Role.ADMIN && targetUser.role === Role.OWNER) {
                throw httpError(403, "you cannot remove owner as admin in this conversation");
            }

            const targetUserDelete = await tx.conversationParticipant.update({
                where: { userId_conversationId: { userId: targetUserId, conversationId } },
                data: {
                    deletedAt: new Date(),
                    deletedById: req.user.id
                }
            });

            return { targetUserDelete };
        });

        return ok(res, { conversationParticipant: result.targetUserDelete })
    } catch (error) {
        next(error);
    }
};
exports.createMessage = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const { messageContent } = req.body;
        const userId = req.user.id;
        const result = await prisma.$transaction(async (tx) => {
            const existingConversation = await tx.conversation.findUnique({
                where: { id: conversationId }
            });
            if (!existingConversation || existingConversation.deletedAt) {
                throw httpError(404, "no such conversation");
            }
            const conversationParticipant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId, conversationId },
                }
            })
            if (!conversationParticipant || conversationParticipant.deletedAt) {
                throw httpError(404, "you are not a participant in this conversation");
            }
            if (existingConversation.conversationType == ConversationType.CHANNEL && conversationParticipant.role == Role.MEMBER) {
                throw httpError(403, "you can not message in a channel as member")
            }
            const message = await tx.message.create({
                data: { userId, conversationId, content: messageContent },
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    conversationId: true,
                    user: {
                        select: { id: true, username: true, displayName: true, picture: true }
                    }
                }
            });
            return { message }
        })
        return created(res, { message: result.message })
    } catch (error) {
        next(error)
    }
}
exports.deleteMessage = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const { messageIds } = req.body;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            const existingConversation = await tx.conversation.findFirst({
                where: { id: conversationId, deletedAt: null }
            });
            if (!existingConversation) {
                throw httpError(404, "no such conversation");
            }

            const requesterParticipant = await tx.conversationParticipant.findUnique({
                where: { userId_conversationId: { userId, conversationId } }
            });
            if (!requesterParticipant || requesterParticipant.deletedAt) {
                throw httpError(403, "you are not a participant in this conversation");
            }

            // fetch the target messages, with their author's role in THIS conversation
            const existingMessages = await tx.message.findMany({
                where: { id: { in: messageIds }, conversationId, deletedAt: null },
                select: {
                    id: true,
                    userId: true,
                    user: {
                        select: {
                            conversationParticipants: {
                                where: { conversationId },
                                select: { role: true }
                            }
                        }
                    }
                }
            });

            const allowedIds = existingMessages
                .filter((msg) => {
                    const isOwnMessage = msg.userId === userId;
                    const authorRole = msg.user.conversationParticipants[0]?.role;

                    if (requesterParticipant.role === Role.OWNER) return true;
                    if (requesterParticipant.role === Role.ADMIN) return isOwnMessage || authorRole === Role.MEMBER;
                    return isOwnMessage; // MEMBER
                })
                .map((msg) => msg.id);

            if (allowedIds.length > 0) {
                await tx.message.updateMany({
                    where: { id: { in: allowedIds } },
                    data: { deletedAt: new Date(), deletedById: userId }
                });
            }

            return {
                requestedIds: messageIds,
                existingIds: existingMessages.map((m) => m.id),
                deletedIds: allowedIds
            };
        });

        return ok(res, {
            requestedIds: result.requestedIds,
            existingIds: result.existingIds,
            deletedIds: result.deletedIds
        });
    } catch (error) {
        next(error);
    }
};
exports.getConversationMessages = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const limit = Math.min(req.query.limit || 30, 100);
        const before = req.query.before;
        const after = req.query.after;
        const userId = req.user.id;
        const result = await prisma.$transaction(async (tx) => {
            const existingConversation = await tx.conversation.findUnique({
                where: { id: conversationId }
            });
            if (!existingConversation || existingConversation.deletedAt) {
                throw httpError(404, "no such conversation");
            }
            const conversationParticipant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId, conversationId },
                }
            })
            if (!conversationParticipant || conversationParticipant.deletedAt) {
                throw httpError(403, "you are not a participant in this conversation");
            }
            const messages = await tx.message.findMany({
                where: {
                    conversationId,
                    ...(before && { id: { lt: before } }),
                    ...(after && { id: { gt: after } }),
                    deletedAt: null
                },
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    user: {
                        select: { id: true, username: true, displayName: true, picture: true }
                    }
                },
                orderBy: { id: after ? 'asc' : 'desc' },
                take: limit
            })
            return { messages };
        });
        const messages = after ? result.messages : result.messages.reverse();
        const nextCursor = messages.length === limit
            ? messages[after ? messages.length - 1 : 0].id
            : null;
        return ok(res, {
            messages, nextCursor
        });
    } catch (error) {
        next(error);
    }
};
exports.demoteConversationParticipant = async (req, res, next) => {
    try {
        const { conversationId, targetUserId } = req.params;
        const userId = req.user.id
        const result = await prisma.$transaction(async (tx) => {
            const existingConversation = await tx.conversation.findUnique({
                where: { id: conversationId }
            });
            if (!existingConversation || existingConversation.deletedAt) {
                throw httpError(404, "no such conversation");
            }
            const targetUserConversationParticipant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId: targetUserId, conversationId }
                }
            })
            if (!targetUserConversationParticipant || targetUserConversationParticipant.deletedAt) {
                throw httpError(404, "this user dosent exist in this conversation");
            }
            if (targetUserConversationParticipant.role === Role.MEMBER) {
                throw httpError(409, "this user can not be demoted further");
            }
            const jwtUserConversationParticipant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId, conversationId }
                }
            })
            if (!jwtUserConversationParticipant
                || jwtUserConversationParticipant.deletedAt
                || jwtUserConversationParticipant.role === Role.MEMBER) {
                throw httpError(403, "you are not a admin/owner in this conversation");
            }
            const targetUserDemotion = await tx.conversationParticipant.update({
                where: { userId_conversationId: { userId: targetUserId, conversationId } },
                data: {
                    role: Role.MEMBER
                },
                select: {
                    id: true,
                    userId: true,
                    conversationId: true,
                    role: true
                }
            })
            return { targetUserDemotion };
        });
        return ok(res, { conversationParticipant: result.targetUserDemotion })
    } catch (error) {
        next(error)
    }
}
exports.promoteConversationParticipant = async (req, res, next) => {
    try {
        const { conversationId, targetUserId } = req.params;
        const userId = req.user.id
        const result = await prisma.$transaction(async (tx) => {
            const existingConversation = await tx.conversation.findUnique({
                where: { id: conversationId }
            });
            if (!existingConversation || existingConversation.deletedAt) {
                throw httpError(404, "no such conversation");
            }
            const targetUserConversationParticipant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId: targetUserId, conversationId }
                }
            })
            if (!targetUserConversationParticipant || targetUserConversationParticipant.deletedAt) {
                throw httpError(404, "this user dosent exist in this conversation");
            }
            if (targetUserConversationParticipant.role !== Role.MEMBER) {
                throw httpError(409, "this user can not be promoted further");
            }
            const jwtUserConversationParticipant = await tx.conversationParticipant.findUnique({
                where: {
                    userId_conversationId: { userId, conversationId }
                }
            })
            if (!jwtUserConversationParticipant
                || jwtUserConversationParticipant.deletedAt
                || jwtUserConversationParticipant.role === Role.MEMBER) {
                throw httpError(403, "you are not a admin/owner in this conversation");
            }
            const targetUserPromotion = await tx.conversationParticipant.update({
                where: { userId_conversationId: { userId: targetUserId, conversationId } },
                data: {
                    role: Role.ADMIN
                },
                select: {
                    id: true,
                    userId: true,
                    conversationId: true,
                    role: true
                }
            })
            return { targetUserPromotion };
        });
        return ok(res, { conversationParticipant: result.targetUserPromotion })
    } catch (error) {
        next(error)
    }
}
exports.messagesRead = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const { from, to } = req.query;
        const userId = req.user.id
        const result = await prisma.$transaction(async (tx) => {
            const existingConversationParticipant = await tx.conversationParticipant.findUnique({
                where: { userId_conversationId: { userId, conversationId } }
            });
            if (!existingConversationParticipant || existingConversationParticipant.deletedAt) {
                throw httpError(404, "no such conversationparticipant");
            }
            const existingMessages = await tx.message.findMany({
                where: {
                    id: {
                        gte: parseInt(from),
                        lte: parseInt(to)
                    },
                    conversationId,
                    deletedAt: null, deletedById: null
                },
                select: { id: true, userId: true }
            })
            const messagesReadBefore = await tx.messageRead.findMany({
                where: {
                    messageId: {
                        gte: parseInt(from),
                        lte: parseInt(to)
                    },
                    userId,
                },
                select: { id: true, messageId: true, userId: true }
            })
            const messagesReadBeforeMessageIds = new Set(messagesReadBefore.map(obj => obj.messageId));
            const messagesNotReadYet = existingMessages.filter(obj => !messagesReadBeforeMessageIds.has(obj.id));
            await tx.messageRead.createMany({
                data: messagesNotReadYet
                    .filter(obj => obj.userId !== userId)
                    .map(obj => ({
                        messageId: obj.id,
                        userId
                    }))
            })
            const messagesReadNow = await tx.messageRead.findMany({
                where: {
                    messageId: { in: messagesNotReadYet.map((obj) => obj.id) },
                    userId,
                },
                select: { id: true, messageId: true, userId: true }
            })
            return { existingMessages, messagesReadBefore, messagesReadNow };
        });
        return created(res, {
            userId,
            existingMessages: result.existingMessages,
            messagesReadBefore: result.messagesReadBefore,
            messagesReadNow: result.messagesReadNow
        })
    } catch (error) {
        next(error)
    }
}
