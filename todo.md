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

===============================================================
BACKEND LOOSE ENDS (found during the bug review, not fixed yet)
===============================================================
A. [done]add @@index([conversationId, id]) to model Message in prisma/schema.prisma + migrated
     (see section 8 note: @@index is NOT @@unique)
B.[done] add a 404 handler in app.jsa
     (no 404 handler exists, unknown routes fall through to express's default HTML page)
C.[done] VERIFY dotenvx actually injects into process.env
     node -e "require('./app.js'); console.log('JWT set:', !!process.env.JWT_SECRET)"
     authController.js:5-7 calls @dotenvx/dotenvx .config() but recent dotenvx
     versions do NOT push vars into process.env from a plain .config() call.
     app printed "injected env (0) from .env" on every boot which is suspicious.
     if false -> prisma only worked because prisma loads .env itself
D.[done] finish addConversationParticipant in appController.js:339 - missing `await`
     on the tx.conversationParticipant.update() (where/data already fixed)
E. [done]response envelope - option 3 applied. spec in section 8.
     (fixed while there: old shapes were inconsistent across endpoints, and
      err.message was sent to the client for every error incl. 500s, which
      could leak prisma/sql internals)
F. [there is no proxy now no reason to add it]app.js:16 app.set('trust proxy', 1) is commented out
     needed once deployed behind a proxy or the rate limiter sees one shared IP
G. [done]copy-paste error messages still say "conversationParticipantsIds" /
     "participant id" in deleteMessageValidation (validation.js) - will confuse frontend
H. [done]authController 401->409 for "already has a password" + "same password".
     correct: those are conflicts, not auth failures. see section 8.
I. OPEN - messagesRead response is still large (3 arrays + userId). worth slimming
     to { userId, readMessageIds } once the frontend actually uses it.

=========================================================================================================================
8.RESPONSE FORMAT  (rewritten 2026-09-29 - simplified)
===============================================================
NOTE: this section used to describe a { success, data } envelope plus error
codes (ROUTE_NOT_FOUND, NO_TOKEN, VALIDATION_ERROR...). that was rolled back -
it was too much abstraction for the project and `success` was redundant with
the http status code. what is here now is what the code actually does.

3 helpers in utils/respond.js, no wrapper. the payload IS the body:
  ok(res, data)                 -> res.status(200).json(data)
  created(res, data)            -> res.status(201).json(data)
  throw httpError(code, msg)    -> app.js error handler sends { error: msg }

success responses (what the body looks like):
  getProfile / getUser / deleteUser  -> { user }
  updateUser                         -> { user: newUser }
  createConversation                 -> { conversation }                (DM)
                                    -> { conversation, existingParticipantsIds,
                                         nonExistingParticipantsIds }   (group)
  getUsersConversations              -> { conversations, nextCursor }
  deleteConversation                 -> { conversation }
  add / delete participant           -> { conversationParticipant }
  promote / demote                   -> { conversationParticipant }
  createMessage                      -> { message }
  deleteMessage                      -> { requestedIds, existingIds, deletedIds }
  getConversationMessages            -> { messages, nextCursor }
  messagesRead                       -> { userId, existingMessages,
                                          messagesReadBefore, messagesReadNow }
  health                             -> { status, checks, timestamp }   (200 AND 503)
  signup / login                     -> { userId, authenticated: true }
  checkAuth                          -> { authenticated, user }
  logout / setPassword / resetPassword -> { message }

error responses - ONE shape for every error in the app:
  { error: "no such user!" }
  frontend branches on the HTTP STATUS:
    400 bad input (validation middleware sends { errors: [...] } with details)
    401 not logged in / bad token
    403 logged in but not allowed
    404 doesn't exist
    409 conflict (already exists / duplicate)
    429 rate limited
  if you ever need to branch on WHICH 401, you will have to look at the
  message string. that is the tradeoff we accepted. the fix when it hurts:
  add a `code` field to the error body in utils/respond.js + app.js only.

two things kept from the envelope pass, because they are real fixes and are
independent of the envelope:
  - 500 masking: an error with NO statusCode is an unexpected bug. it gets
    logged in full server-side but the client only sees "Something went wrong",
    so prisma/sql/table names can never leak. errors we threw on purpose keep
    their real message.
  - 401 -> 409 in authController for "this user already has a password" and
    "new password is the same as the old one". those are conflicts, not
    auth failures. 401 means "i don't know who you are".

verified with real http requests: 200 health, 200 getUser, 200 getConversations,
401 no token, 404 unknown route, 400 validation, 500 masked bug.
=====
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
7.1. add the @@index from loose end A
7.2. create separate test database: messaging_app_db_test
7.3. add .env.test to .gitignore (keep .env.example as the template)
7.4. add skip to the makeLimiter factory in middlewares/rateLimiter.js:
         skip: () => process.env.NODE_ENV === 'test'
     (store is in-memory + keyed by ip, so a suite creating 40 messages
      hits the 30/min messageLimiter and later tests get 429. counter never
      resets between tests -> flaky)
7.5. replace the placeholder test script in package.json:
         "test": "node --test --env-file=.env.test tests/**/*.test.js"
7.6. add the 404 handler from loose end B

--- step 2: test harness (one time, reused by everything) ---
7.7. tests/helpers/db.js - truncate between tests:
         TRUNCATE TABLE "MessageRead", "Message", "ConversationParticipant",
                        "Conversation", "User" RESTART IDENTITY CASCADE;
     RESTART IDENTITY matters: pagination is id-cursor based and sequences
     must not carry state between tests.
7.8. tests/helpers/factories.js - createUser(), createConversation(),
     loginAs(user) -> cookie header, addParticipant(conv, user, role)
     without these every test is 30 lines of prisma boilerplate
7.9. skip oauth routes in tests (/auth/google, /auth/github) - they need real
     client ids and make live network calls

--- step 3: test cases, in priority order ---
7.10. auth: no cookie -> 401; soft-deleted user -> 401 (middlewares/auth.js:16)
7.11. deleteMessage role matrix (appController.js:499-507)
      3 requester roles x 3 author roles, table driven. highest value test.
7.12. pagination cursor math (appController.js:575-577)
      assert before/after ordering AND nextCursor. was wrong once already.
7.13. DM uniqueness -> 409, plus soft-delete lifecycle (createDm, line 133)
7.14. validation: POST /conversations {conversationType:"DM"} with no
      targetUserId -> 400. (broken right now, test proves the fix)
7.15. cross-conversation isolation: admin of conv A cannot delete a
      message in conv B (proves why conversationId belongs in the findMany)
7.16. createConversation happy paths: DM, GROUPCHAT, CHANNEL

--- step 4: ci (do last, once step 3 is green locally) ---
7.17. .github/workflows/test.yml
7.18. postgres:16 service container
7.19. set DATABASE_URL and JWT_SECRET as real workflow env vars.
      CI has no .env file, and undefined JWT_SECRET makes jwt.sign throw,
      which fails every auth test.
7.20. npx prisma migrate deploy, then npm test

--- websocket readiness (do BEFORE writing ws code) ---
7.21. move db logic out of controllers into a services/ layer
      (messageService.create(...), conversationService.addParticipant(...)).
      controllers only handle http concerns, ws handlers call the same services.
      this is what makes ws cheap to add + cheap to test.
7.22. keep REST as the sole source of message history. ws only pushes NEW events.
      then the REST tests from 7.10-7.16 double as the regression net for the
      ws migration.
7.23. only then write ws tests (ws client + real server). nothing to test yet,
      so this is deferred not skipped.
