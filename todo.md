at every step look at previos projects its probebly done before 
(for auth(passport config rouets etc) , test , postman , deploy)
1.routes
    1.authroutes 1.authcontroller
    2.approutes  2.appcontorller
2.manualy verify its working with postman
3.write integeration test and ci with github action
    (see full breakdown in section 7 below)
4.frontend(client side)
5.CD
6.bonus : for pseudo real time / real time messaging app
    1.polling:client re-hits RESTapi every N sec
    2.Long pooling:no idea
    3.websocket(REST for sinup etc and websocket for live messaging)

for new techs  understand what ur working with and ask ai to be more 
   cautios with giving u code and treat more as a teacher

===============================================================
DECISIONS & STANDING NOTES
===============================================================
O. [decided: C-lite grace window - built] deleteUser only sets deletedAt; the
   row keeps its unique values (username, email, provider+providerId) for a
   14-day grace window (GRACE_DAYS lives in utils/accountLifecycle.js, in CODE
   not .env: it is policy, not a secret). During the window the account is
   frozen - middlewares/auth.js already 401s any deletedAt user, so no
   per-route blocking is needed. Logging in IS the restore: a successful
   password login (password checked BEFORE any restore, so a wrong password
   can never cancel a deletion) or an OAuth provider+providerId match clears
   deletedAt. No public reactivate route and no restore OTP - the login
   itself proves ownership, and it is the only place ownership can be proven
   without reopening the enumeration/budget questions C1 closed. No new
   column: the window is derived from deletedAt + GRACE_DAYS, one source of
   truth. The @unique in the DB is still the real wall; anonymization is what
   lifts it.
   Expiry: past the window the row is anonymized (username ->
   deleted_<id>_<rand3hex>, email -> null, displayName -> 'Deleted User',
   picture/provider/providerId -> null, password untouched, id PRESERVED so
   Message/MessageRead/participant FKs keep working and history survives).
   Expiry happens LAZILY wherever a tombstone blocks something (signup 409
   check, OAuth identity/email refusals) plus a daily sweep in server.js so
   untouched rows expire too. Login deliberately does NOT lazily anonymize an
   expired tombstone: it returns a plain 401 with no write. An expired OAuth
   identity is REFUSED ("sign up again"), never silently turned into a fresh
   empty account - login intent is not signup intent.
F. [wontfix-for-now] app.set('trust proxy', 1) stays commented out.
   trigger: the day this deploys behind a proxy, enable it or the rate
   limiter sees one shared IP for all users. it also governs req.ip/req.protocol,
   so logs show the proxy IP too. use 1 (trust exactly one hop), NOT true: true
   trusts the whole X-Forwarded-For chain, letting clients spoof their IP and
   dodge the limiter.
P. [decided, not a task] GitHub never auto-links (basic profile asserts no
   verified email, so the link branch can't trust it). listed so it reads
   as a decision, not a bug. relax by fetching the /user/emails API inside the
   strategy verify callback (needs user:email scope) and passing its verified
   flag.

===============================================================
FUTURE WORKFLOWS (features, design before building)
===============================================================
M. forgot-password flow doesn't exist. passwordReset needs login, and
   request-code is authed-only, so there is NO logged-out recovery path.
   needs a public OTP variant, which reopens the enumeration/budget questions
   C1 deliberately closed. design before building.
J. no alerting on OTP mail failures. signup and email-change sends are
   best-effort by design (a dead SMTP server must not fail account creation),
   so a down mailer is visible ONLY as [otp] lines in the server logs.
   production needs log monitoring/alerting on repeated "[otp] ... NOT sent"
   lines, otherwise signups silently skip their codes and nobody gets paged.
Q. [research] use sentry middleware (how can i use it in this project and in
   general what does it offer)
R. [security, design first] changing/resetting a password does NOT invalidate
   existing JWTs, so a stolen token keeps working for up to 7 days after the
   owner rotates the password. requireVerified does not help here (and is not
   the right gate for the password routes - see the note in routes/authRoutes.js).
   fix: add tokenVersion (or passwordChangedAt) to User, bump it on password
   change/reset, and in authenticateToken reject tokens whose iat predates it.
   needs one column + migration, and logout-everywhere can reuse the same bump.
S. [future, design first] leaving a conversation (self-removal). Today
   DELETE /conversations/:id/participants/:targetUserId lets a MEMBER remove
   themselves from a group/channel, but a DM is blocked by the DM guard in
   deleteConversationParticipant. Allowing self-leave from a DM needs
   `conversationType === DM && userId !== targetUserId`; addConversationParticipant
   must keep refusing DMs. dmKey @unique is then the hard part: the leaver's
   pair can no longer create the DM again (409), and there is no restore route.
   open questions:
     - history visibility on return: does the leaver see messages sent while
       they were away, or only up to their leave date?
     - messages sent to someone who left: still delivered (rows stay), or a
       send-time membership check refuses them?
     - can a DM bring back someone who left: restore the same conversation by
       dmKey on the next create, or keep it closed forever?
     - 200 vs 201 when restoring an existing conversation.
     - optional pair-table cleanup: if DMs get a dedicated user-pair table (or
       dmKey rows become reusable), decide how old rows are freed.
     - if a CHECK (the two dmKey ids differ) migration is added, test
       prisma.conversation.create({ dmKey: '3_3' }) rejects it; the API already
       403s self-DM before reaching the DB.
   also flips the 7.13 test "leaving a DM as yourself -> 403"; move that test
   to deleteConversationParticipant.test.js when the behavior lands.

===============================================================
7.TESTING ROADMAP (detail for step 3 above)
===============================================================
decisions made:
  - integration tests via supertest against real app + real prisma + real postgres.
    NOT unit tests: every bug we fixed was only visible at the http/db boundary
    (findUnique with non-unique fields, data nested inside where, missing await,
     select:{deletedAt:null}, wrong cursor direction). a mocked prisma would
    have passed all of them.
  - runner: node:test (built in) + supertest. zero config, works with commonjs.
    alt: vitest if i want watch mode + nicer diffs.
  - rate limiters MUST be skipped in tests or the suite throttles itself into 429s.
  - isolation plan (decided 2026-10-23): ONE shared test DB + TRUNCATE ...
    RESTART IDENTITY CASCADE in beforeEach + --test-concurrency=1. do NOT wrap
    tests in prisma transactions: the app queries through a different pooled
    connection, so it cannot see uncommitted fixtures (READ COMMITTED), and
    supertest's real HTTP socket stops AsyncLocalStorage/context from reaching
    the express handler. making it work needs a global override in db/prisma.js
    or a req.db/services refactor.
    scale trigger: if the suite gets slow (roughly 30-60s) or grows past ~10
    files, switch to one database (or schema) per test FILE - each file is its
    own process, so it can set DATABASE_URL before requiring app, and the schema
    can be cloned from a migrated template DB (CREATE DATABASE x TEMPLATE ...).
    full analysis: project-based-notes/"project based knowledg"/
                  Integration testing — DB isolation options.md

--- step 1: prerequisites (do before writing a single test) ---
7.1. [done] @@index([conversationId, id]) on Message (migrated 2026-09-28).
     lesson kept: @@index is NOT @@unique — a lookup structure, not a
     constraint; never valid in a findUnique where. planner picks it up
     from the WHERE/ORDER BY shape on its own (proven via EXPLAIN).
7.2. [done] messaging_app_db_test created 2026-10-22; `prisma migrate deploy`
     applied all 18 migrations. deploy (not db push) so the test DB matches
     the committed migration history, which is also what CI will do (7.21).
7.3. [done] already covered, no change needed: .gitignore has ".env.*" plus
     "!.env.example", so .env.test is ignored but the template stays tracked.
7.4. [done] skip: () => process.env.NODE_ENV === 'test' added to makeLimiter,
     so every limiter inherits it. skip is read per REQUEST, so it only fires
     when .env.test set NODE_ENV=test; production limits are untouched.
     (store is in-memory + keyed by ip, so a suite creating 40 messages
      hits the 30/min messageLimiter and later tests get 429. counter never
      resets between tests -> flaky)
7.5. [done] "test": "node --test --env-file=.env.test --test-concurrency=1 tests/"
     plus supertest added as a devDependency. two deliberate changes vs the
     draft above:
       - "tests/" instead of "tests/**/*.test.js": npm runs scripts under sh,
         where ** is not recursive (it would look for tests/<dir>/<file>).
       - --test-concurrency=1: node runs test FILES in parallel by default,
         so two files would truncate one shared test DB under each other.
     .env.test is the single loader (server.js's dotenvx never runs in tests),
     and it points at messaging_app_db_test.
7.6. [done] 404 handler returns JSON like every other error

--- step 2: test harness (one time, reused by everything) ---
7.7. [done] tests/helpers/db.js - resetDb(), used as beforeEach(resetDb):
         TRUNCATE TABLE "MessageRead", "Message", "ConversationParticipant",
                        "Conversation", "VerificationCode", "User"
                        RESTART IDENTITY CASCADE;
     RESTART IDENTITY matters: pagination is id-cursor based and sequences
     must not carry state between tests.
     VerificationCode MUST be in the list: leftover OTP rows carry their 60s
     cooldowns into the next test (request-code would 429 for no visible
     reason). OTP tests should also delete a user's codes directly when they
     need a fresh code without waiting out the cooldown.
     $executeRawUnsafe is required (TRUNCATE takes no bind parameters); the
     table list is a hard-coded literal, so there is no injection surface.
     tests/harness.test.js proves an id restarts at 1 after a reset.
7.8. [done] tests/helpers/factories.js - createUser(), createConversation(),
     createDm(), addParticipant(conv, user, role), createMessage(),
     loginAs(user) -> "token=..." cookie, cookieFor(user) -> jwt signed
     directly. without these every test is 30 lines of prisma boilerplate.
     decisions:
       - factories write to the DB directly (arrange), tests call the API
         (act) and assert response + DB. a factory must never replace the
         endpoint under test.
       - loginAs is the exception: it uses the real POST /auth/login so the
         cookie (bcrypt, payload, flags) is genuine. it throws on non-200 so
         the failure points at login, not at a later 401.
       - cookieFor exists only for cases where login is blocked on purpose
         (deleted / expired grace user). authenticateToken still re-reads the
         user from the DB, so the middleware is genuinely exercised.
       - default password secret123, hashed ONCE at module load; custom
         passwords are hashed on demand and `password: null` means OAuth-only.
       - usernames/emails get a random suffix even though resetDb already
         cleans up: readable failures, and a forgotten cleanup cannot collide.
7.9. [done] oauth boundary: /auth/google and /auth/github are NEVER called by
     the suite (live redirect + real client ids). .env.test carries dummy
     client ids only so requiring config/passport.js registers the strategies
     without throwing. the decision logic is tested by calling
     findOrCreateOAuthUser(profile) directly with fake profiles.
     STILL OPEN: that decision table (in-window restore / expired refusal /
     email collision / new user) has not been written yet - add it in step 3.

--- step 3: test cases, in priority order ---
(line refs predate rewrites; correct them when the tests land, not before)
7.10. [done] auth gate: tests/auth.test.js, target GET /auth/check (has
      authenticateToken but not requireVerified, so every failure is the
      middleware's own). 8 cases, one per branch in middlewares/auth.js:
      live token -> 200; no cookie -> 401 "No token provided"; garbage token,
      wrong-secret token -> 401 "Invalid token"; past exp -> 401 "Token
      expired"; hard-deleted user id, soft-deleted user (in window), and
      past-grace tombstone -> 401 "User no longer exists".
      lessons locked in:
        - a valid JWT is not enough: authenticateToken re-reads the user with
          `deletedAt: null`, so a token issued BEFORE deletion stops working
          immediately. deleted tests MUST use cookieFor(), never loginAs() -
          login restores an in-window account and would undo the fixture.
        - past-grace returns the same 401 as in-window: restoring is login's
          job and only inside the window; the token never reopens an account.
        - failed auth performs no writes (assert deletedAt/username/displayName
          unchanged), so a 401 can't half-anonymize a tombstone.
      exact error strings are asserted on purpose: status is always 401, so
      the message is the only observable difference between branches.
7.11. [done] deleteMessage role matrix: tests/deleteMessage.test.js, 8 tests.
      rule (appController.deleteMessage):
        OWNER  -> any message in the conversation
        ADMIN  -> own message, or an author whose role is MEMBER
        MEMBER -> own message only
      so ADMIN cannot touch another ADMIN's or the OWNER's message; the
      diagonal (requester is the author) is allowed for every role because
      "own message" is a separate branch, not a row of the matrix.
      coverage: 3 matrix tests (one request per requester role, 3 messages -
      one author per role) + 3 own-message tests + non-participant 403 +
      re-delete is a no-op. every success asserts the response arrays AND the
      row (deletedAt set, deletedById = requester); denial asserts deletedAt
      stays null.
      contract decisions (controller changed 2026-10-26):
        - per-message denial is NOT 403. batch endpoint -> 200 with
          deletedIds / forbiddenIds / missingIds. 403 stays reserved for
          "not a participant" (or soft-deleted participant row); 404 for a
          missing/deleted conversation. an all-or-nothing 403 would let one
          bad id cancel the whole batch.
        - missingIds merges unknown ids, already-deleted ids AND ids that
          exist in another conversation. one bucket on purpose: the API must
          never confirm that a message exists where the caller can't see it.
          (the conversationId in the findMany where is the security clause)
        - requestedIds is deduped ([...new Set(...)]), and all five arrays are
          sorted ascending: findMany has no orderBy, so raw order depended on
          the query plan and could differ between runs.
        - re-deleting is a no-op: `deletedAt: null` filters the row out, so it
          lands in missingIds, not forbiddenIds.
      fixtures: requester + authors created with createVerifiedUser(), roles
      set directly via addParticipant() - never through promote/demote, so a
      broken promote route can't fail this file.
7.12. [done] pagination cursor math: tests/getConversationMessages.test.js, 8 tests
      (getConversationMessages is appController.js:595; the old 575 ref was
      stale after the 7.11 rewrite - always re-grep before trusting a line
      ref in this file).
      contract:
        - messages are ALWAYS returned oldest -> newest, in all three modes:
          no cursor = newest `limit`; before=X = the limit immediately older
          than X; after=X = the limit immediately newer than X.
        - hasMore (new): is there another page in this direction?
        - nextCursor: the edge to continue FROM (oldest in page when going
          back, newest when going forward), and null whenever hasMore is
          false - so the client never needs a throwaway request to find the
          end. (the old length===limit check emitted a cursor when a full
          page happened to be the end)
      implementation:
        - fetch limit+1 and trim the extra row (oldest when going back,
          newest when going forward). that is how hasMore is known without a
          second query.
        - orderBy id asc in BOTH directions; take is NEGATIVE when going
          back. Postgres returns the last N rows already ascending, so there
          is no reverse() and no offset math.
        - goingBack = (after === undefined): first page and before scroll
          back; only after moves forward.
      two real bugs found while writing this:
        - Express 5 exposes req.query as a getter, so express-validator's
          toInt() never writes back. before/after arrived as STRINGS and
          `id: { lt: "5" }` threw PrismaClientValidationError -> every cursor
          request was a 500. limit survived only because Math.min coerces.
          the controller now reads them through matchedData(req), which holds
          the sanitized values express-validator produced (the same fix is
          used by 7.12b/7.12c); a raw Number() was the first fix.
        - Prisma `cursor: { id } + skip: 1` is WRONG for this app: skip is an
          OFFSET on the filtered rows, not "skip the cursor row". proven on
          the test DB: with m4 soft-deleted, cursor=4/skip1 returned [6,7]
          instead of [5,6,7] forward and [1,2] instead of [1,2,3] backward -
          it drops the next VISIBLE message whenever the cursor row itself is
          filtered out (exactly what happens when a message is deleted between
          pages). a nonexistent cursor id also returns [] and silently ends
          the feed. lt/gt compare ids only, so they stay correct.
      tests: first page; before walk (3 pages partition 1..7, no dup/gap);
      after walk; exactly-limit-but-no-more (hasMore false); default limit 30;
      soft-deleted row skipped without consuming the page; a cursor pointing
      at a soft-deleted row loses no neighbour (regression guard for the
      Prisma-cursor trap); before+after -> 400.
7.12b. [done] conversations list pagination, now ordered by last activity:
      tests/getUsersConversations.test.js, 10 tests.
      feature: Conversation.lastMessageAt (non-null, default now()) + migration
      backfill from MAX(message.createdAt), deleted messages included. bumped in
      createMessage (inside its transaction) and mirrored by the createMessage
      factory; createDm/createGroupOrChannel get the DB default. no rollback
      when the newest message is deleted: the activity happened when it was
      sent. reading does not bump.
      contract: newest activity first (lastMessageAt desc, id desc tiebreak),
      and pages are serialized descending too; `before` walks older and
      `after` newer still hold. hasMore/nextCursor as in 7.12, but nextCursor
      is "<epochMillis>_<conversationId>": lastMessageAt is NOT unique (ms
      precision, and batches collide), so id is the tiebreak and the cursor
      has to carry both. validation rejects anything else with 400.
      trim is the mirror of messages because the order is descending: going
      back take +(limit+1) and trim the LAST; forward take -(limit+1) and trim
      the FIRST.
      tests: first page + lastMessageAt payload; before walk partitions 7 (the
      activity order is deliberately a permutation of id order); after walk;
      exactly-limit-no-more; default 30; soft-deleted conversation skipped;
      participant filter (foreign + removed participant, both with newer
      activity so a broken filter would land at the top); a new message bumps
      the oldest conversation to first; before+after 400; malformed or
      impossible cursor 400.
7.12c. [done] messagesRead range tests: tests/messagesRead.test.js, 9 tests.
      range, not pagination: marks other users' unread messages in [from,to]
      only; own messages skipped; re-read is a state no-op (201 + []); to<from
      400; from/to required; non-participant and removed participant 404; a
      foreign conversation id inside the range is not marked; soft-deleted
      message skipped; nothing markable -> 201 + [].
7.12d. [open, deferred] Conversation list ordering index.
       No index supports `ORDER BY lastMessageAt DESC, id DESC` today. Do not
       add it preemptively.
       trigger: run EXPLAIN (ANALYZE, BUFFERS) on the real getUsersConversations
       query against seeded data first. Add the index only when a realistic
       account loses the index (Sort node) or examines rows far beyond the page
       size. Seed at least 1k and 10k conversations for one user, with most rows
       belonging to other users, then compare with and without the index on the
       test DB (CREATE INDEX / DROP INDEX locally; no migration until the
       trigger fires).
       what it fixes: only the ordering and cursor half of the query, and only
       for accounts with thousands of conversations (bots, admins). It does not
       remove the participant EXISTS filter - the planner may still drive from
       ConversationParticipant(userId, conversationId) and sort.
       if every user needs it, the real fix is participant-side:
       copy lastMessageAt onto ConversationParticipant and index
       (userId, lastMessageAt, conversationId) so a user's page is one range
       scan + PK lookups into Conversation. A plain ascending index serves
       DESC, DESC by scanning backwards. cost: every message updates one row
       per participant plus index maintenance, so a 10k-member channel pays
       10k writes per message - good for many-conversations-per-user with
       modest groups, bad for huge channels. do not adopt blindly.
       note: the tiebreak must be conversationId, not participant.id; the
       cursor is (lastMessageAt, conversationId) and participant.id is unrelated.
7.13. [done] DM uniqueness -> 409, plus soft-delete lifecycle:
      tests/createConversation.test.js, 10 tests.
      contract:
        - POST /conversations {conversationType:"DM", targetUserId} creates
          ONE conversation whose dmKey is [lowId,highId] sorted, so the pair is
          unique in either order; both participants are MEMBER.
        - duplicate in either order -> 409 "this dm already exist" from the
          P2002-on-dmKey mapping; the original conversation is untouched.
        - two CONCURRENT identical creates -> exactly one 201 and one 409; the
          loser's transaction rolls back, leaving 1 conversation + 2
          participants. That is the test that exercises the unique index.
        - soft-deleted target and nonexistent target -> the SAME 404
          "no such targetUser", so the API never confirms an id exists.
        - self-DM -> 403 "you can not have DM with yourself" from the
          controller (moved out of validation 2026-11-06).
        - DM without targetUserId -> 400 with one error on path targetUserId
          (7.14).
        - DELETE a DM -> 403 "You can not delete a DM"; deletedAt untouched.
        - leaving a DM as yourself -> 403 "cannot delete a participant from a
          DM"; membership is immutable until todo S lands, when this test flips
          and moves to deleteConversationParticipant.test.js.
      removed from the old scope: "removed participant can be restored via
      addConversationParticipant" is impossible for DMs - add blocks DMs before
      its restore branch, and a normally-created DM has both members as MEMBER
      (the MEMBER role check fires first anyway).
      arrange: both duplicate calls go through the real endpoint (a factory
      second call would throw P2002 in arrange); delete/leave tests arrange the
      DM with createDm(). every fixture is createVerifiedUser().
7.14. [done] validation: POST /conversations {conversationType:"DM"} with no
      targetUserId -> 400. covered in tests/createConversation.test.js (asserts
      exactly one error, with path "targetUserId").
      the 2026-11-06 validation rewrite also made targetUserId and
      conversationName conditional on conversationType and removed the
      group/channel false positive where targetUserId=self was rejected.
7.15. [done] cross-conversation isolation: admin of conv A cannot delete a
      message in conv B (proves why conversationId belongs in the findMany)
7.16. [open] createConversation happy paths: DM, GROUPCHAT, CHANNEL
      (append to tests/createConversation.test.js in a separate commit).
      include a regression: GROUPCHAT with targetUserId = self -> 201 (locks
      the validator false-positive removed 2026-11-06).
7.17. [open] email verification cases (all proven manually 2026-10-11, lock them in):
      signup auto-sends (verificationSent:true); gated route 403 while
      unverified; cooldown 429 on instant resend; wrong code 400; verify
      200; code reuse 400; burn after 5 misses (consumedAt set, attempts:5);
      email change re-gates + resends (verificationSent:true); same-email
      edit sends nothing (no verificationSent key). needs
      DEV_RETURN_CODE=true in .env.test so the suite reads codes with no
      inbox (NEVER in a real env). purge a user's codes directly when a
      test needs a fresh code without waiting out the 60s cooldown.

--- step 4: ci (do last, once step 3 is green locally) ---
run npx prisma migrate in the ci so the migration exist in the ci
7.18. [open] .github/workflows/test.yml
7.19. [open] postgres:16 service container
7.20. [open] set DATABASE_URL and JWT_SECRET as real workflow env vars.
      CI has no .env file, and undefined JWT_SECRET makes jwt.sign throw,
      which fails every auth test. same symptom, other suspect: dotenvx runs
      in server.js only — require('./app') alone never injects .env (prisma's
      side-effect load covers it). suspect this split first.
7.21. [open] npx prisma migrate deploy, then npm test

--- websocket readiness (do BEFORE writing ws code) ---
7.22. [open] move db logic out of controllers into a services/ layer
      (messageService.create(...), conversationService.addParticipant(...)).
      controllers only handle http concerns, ws handlers call the same services.
      this is what makes ws cheap to add + cheap to test.
7.23. [open] keep REST as the sole source of message history. ws only pushes NEW events.
      then the REST tests from 7.10-7.17 double as the regression net for the
      ws migration.
7.24. [open] only then write ws tests (ws client + real server). nothing to test yet,
      so this is deferred not skipped.
7.25. [open] WebSockets:(email verification) if the app sends messages over Socket.IO, the socket's own auth needs
      the same verified check. Gating the HTTP routes doesn't cover it.
      concretely: the Socket.IO handshake must run requireVerified logic,
      not just JWT verification.
7.26. [open] deletion grace window (C-lite, utils/accountLifecycle.js):
      deleteUser returns restorableUntil/graceDays; login inside the window
      clears deletedAt and returns reactivated:true; expired tombstone ->
      login 401 with NO write; signup on an expired tombstone's username or
      email anonymizes it and succeeds (in-window -> 409); expired OAuth
      identity -> refused ("sign up again"), not auto-created; anonymize
      keeps id (threads intact) and frees username/email/provider+providerId.

=========================================================================================================================
8.RESPONSE CONTRACT (what the frontend branches on)
===============================================================
One shape for every error: { error: "message" }. Validation errors carry
{ errors: [...] } with details. Frontend branches on HTTP STATUS:
  400 bad input | 401 not logged in / bad token | 403 logged in but not
  allowed (incl. requireVerified) | 404 doesn't exist | 409 conflict
  (already exists) | 429 rate limited, retry later
Two tribal rules: (1) branching on WHICH 401 needs message-matching; when it
hurts, add a `code` field in utils/respond.js + app.js error handler only.
(2) 401 means "i don't know who you are" — "already has a password" and
"same password" are 409s, not 401s. Unexpected bugs (no statusCode) log fully
server-side; the client only ever sees "Something went wrong".
