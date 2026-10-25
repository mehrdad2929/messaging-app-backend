const prisma = require('../../db/prisma');

// The ONE thing every test file shares: a clean database between tests.
//
// Use it as `beforeEach(resetDb)`. Nothing in an individual test should need
// cleanup code - that is the point of this file.
//
// Why each part:
//   - TRUNCATE (not DELETE) empties the tables in one operation. Much faster,
//     and it does not scan row by row.
//   - RESTART IDENTITY resets the autoincrement counters. Pagination is
//     id-cursor based, so a test must never inherit sequence values from the
//     test before it.
//   - CASCADE also truncates tables that reference these (Message -> User,
//     etc.). Without it Postgres refuses to truncate a table other FKs point at.
//   - "VerificationCode" MUST stay in the list: a leftover row carries its
//     60-second resend cooldown into the next test, which shows up as a
//     mysterious 429.
//
// $executeRawUnsafe, not $executeRaw: TRUNCATE takes no bind parameters.
// Safe here because the table list is a hard-coded literal, not user input.
const TABLES = `
    "MessageRead",
    "Message",
    "ConversationParticipant",
    "Conversation",
    "VerificationCode",
    "User"
`;

async function resetDb() {
    await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE ${TABLES}
        RESTART IDENTITY CASCADE;
    `);
}

module.exports = { resetDb };
