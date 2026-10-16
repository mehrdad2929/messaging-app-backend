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
O. deleted accounts hold uniques forever (deleteUser anonymization still
   commented out). consistent with the OAuth deleted-row behavior, but arrived
   at by accident, never chosen. pick a policy: free the name/email or not.
F. [wontfix-for-now] app.set('trust proxy', 1) stays commented out.
   trigger: the day this deploys behind a proxy, enable it or the rate
   limiter sees one shared IP for all users.
P. [decided, not a task] GitHub never auto-links (basic profile asserts no
   verified email, so the link branch can't trust it). listed so it reads
   as a decision, not a bug. relax by fetching user:email flags.

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

--- step 1: prerequisites (do before writing a single test) ---
7.1. [done] @@index([conversationId, id]) on Message (migrated 2026-09-28).
     lesson kept: @@index is NOT @@unique — a lookup structure, not a
     constraint; never valid in a findUnique where. planner picks it up
     from the WHERE/ORDER BY shape on its own (proven via EXPLAIN).
7.2. [open] create separate test database: messaging_app_db_test
7.3. [open] add .env.test to .gitignore (keep .env.example as the template)
7.4. [open] add skip to the makeLimiter factory in middlewares/rateLimiter.js:
         skip: () => process.env.NODE_ENV === 'test'
     (store is in-memory + keyed by ip, so a suite creating 40 messages
      hits the 30/min messageLimiter and later tests get 429. counter never
      resets between tests -> flaky)
7.5. [open] replace the placeholder test script in package.json:
         "test": "node --test --env-file=.env.test tests/**/*.test.js"
7.6. [done] 404 handler returns JSON like every other error

--- step 2: test harness (one time, reused by everything) ---
7.7. [open] tests/helpers/db.js - truncate between tests:
         TRUNCATE TABLE "MessageRead", "Message", "ConversationParticipant",
                        "Conversation", "VerificationCode", "User"
                        RESTART IDENTITY CASCADE;
     RESTART IDENTITY matters: pagination is id-cursor based and sequences
     must not carry state between tests.
     VerificationCode MUST be in the list: leftover OTP rows carry their 60s
     cooldowns into the next test (request-code would 429 for no visible
     reason). OTP tests should also delete a user's codes directly when they
     need a fresh code without waiting out the cooldown.
7.8. [open] tests/helpers/factories.js - createUser(), createConversation(),
     loginAs(user) -> cookie header, addParticipant(conv, user, role)
     without these every test is 30 lines of prisma boilerplate
7.9. [open] skip oauth routes in tests (/auth/google, /auth/github) - they need real
     client ids and make live network calls

--- step 3: test cases, in priority order ---
(line refs predate rewrites; correct them when the tests land, not before)
7.10. [open] auth: no cookie -> 401; soft-deleted user -> 401 (middlewares/auth.js:16)
7.11. [open] deleteMessage role matrix (appController.js:499-507)
      3 requester roles x 3 author roles, table driven. highest value test.
7.12. [open] pagination cursor math (appController.js:575-577)
      assert before/after ordering AND nextCursor. was wrong once already.
7.13. [open] DM uniqueness -> 409, plus soft-delete lifecycle (createDm, line 133)
7.14. [open] validation: POST /conversations {conversationType:"DM"} with no
      targetUserId -> 400. (was broken, fixed; test locks it in)
7.15. [open] cross-conversation isolation: admin of conv A cannot delete a
      message in conv B (proves why conversationId belongs in the findMany)
7.16. [open] createConversation happy paths: DM, GROUPCHAT, CHANNEL
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
