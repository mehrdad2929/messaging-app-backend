const prisma = require('../db/prisma');
exports.health = (req, res) => {
    res.status(200).json({ message: 'messaging app is running' });
};
exports.getProfile = async (req, res, next) => {
    try {
        const otherUserId = parseInt(req.params.id);
        const user = await prisma.user.findUnique({
            where: {
                id: otherUserId, deletedAt: null
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                picture: true,
            }
        });
        if (!user) {
            return res.status(404).json('no such user!');
        }
        res.status(200).json({ message: 'here is user!', user });
    } catch (error) {
        next(error);
    }
};
exports.getUser = async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id, deletedAt: null },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                picture: true,
                provider: true,
                createdAt: true,
                //some more info maybe
            }
        });
        if (!user) {
            return res.status(404).json('no such user!');
        }
        res.status(200).json({ message: 'here is user!', user });
    } catch (error) {
        next(error);
    }
};
exports.updateUser = async (req, res, next) => {
    try {
        const { newUsername, newEmail, newDisplayName, newPicture } = req.body;

        const existingUsername = await prisma.user.findFirst({
            where: {
                username: newUsername,
                deletedAt: null
            }
        });
        if (existingUsername) {
            return res.status(409).json({ message: "User with this username already exists" });
        }
        const existingEmail = await prisma.user.findFirst({
            where: {
                email: newEmail,
                NOT: { id: req.user.id }
            }
        });
        if (existingEmail) {
            return res.status(409).json({ message: "User with this email already exists" });
        }
        const newUser = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                username: newUsername,
                email: newEmail,
                displayName: newDisplayName,
                picture: newPicture
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
        res.status(201).json({ message: 'updated the user succesfully', newUser });
    } catch (error) {
        next(error);
    }
};
exports.deleteUser = async (req, res, next) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                deletedAt: new Date()
            },
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                picture: true,
                provider: true,
                createdAt: true,
                deleteUser: true
            }
        });
        res.clearCookie('token');
        res.json(user);
    } catch (error) {
        next(error);
    }
};


//TODO:do the group chat now
exports.createGroupChat = async (req, res, next) => {
    try {
        // res.status(201).json({ message: 'created group chat succefully', groupChat });
        res.status(404).json('this route isnt handled/exist yet')
    } catch (error) {
        next(error);
    }
};
exports.createDm = async (req, res, next) => {
    try {
        const { otherUserId } = req.body
        const findOtherUser = await prisma.user.findUnique({
            where: { id: otherUserId }
        })
        if (!findOtherUser) {
            return res.status(404).json({ error: 'no such otherUser' })
        }
        //cause for uniqeness the db(postgre/prisma) sees (a,b) different from (b,a) 
        //so we need to make some order between the ids
        const higherId = req.user.id > otherUserId ? req.user.id : otherUserId;
        const lowerId = req.user.id > otherUserId ? otherUserId : req.user.id;
        const existingDm = await prisma.dm.findFirst({
            where: {
                AND: [
                    { dmUserAId: higherId },
                    { dmUserBId: lowerId },
                ]
            }
        });
        if (existingDm) {
            return res.status(409).json({ error: 'this Dm already exist ' })
        }
        //solving the race condition with a transaction
        const result = await prisma.$transaction(async (tx) => {
            const conversation = await tx.conversation.create({ data: {} })
            const dm = await tx.dm.create({
                data: {
                    dmUserAId: higherId,
                    dmUserBId: lowerId,
                    conversationId: conversation.id
                }
            });
            const conversationParticipanA = await tx.conversationParticipant.create({
                data: {
                    userId: higherId,
                    conversationId: conversation.id
                }
            });
            const conversationParticipanB = await tx.conversationParticipant.create({
                data: {
                    userId: lowerId,
                    conversationId: conversation.id
                }
            });
            return { dm };
        })
        res.status(201).json({ message: 'created dm succefully', dm: result.dm });
    } catch (error) {
        next(error);
    }
};
