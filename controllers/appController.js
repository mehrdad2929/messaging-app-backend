exports.health = (req, res) => {
    res.status(200).json({ message: 'messaging app is running' });
};

exports.getProfile = async (req, res, next) => {
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
            }
        });
        res.json(user);
    } catch (error) {
        next(error);
    }
};
