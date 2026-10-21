require('@dotenvx/dotenvx').config();
// Register the OAuth strategies EAGERLY, at boot, instead of lazily on the
// first /auth/google (or /auth/github) request. A missing client id or a config
// typo in config/passport.js then throws here, at deploy time, where you can
// still catch it - not at 2am under a real user's login.
// MUST run after dotenvx: the strategies read process.env.*_CLIENT_ID and
// passport-oauth2 throws "requires a clientID option" if it is undefined.
require('./config/passport');
const app = require('./app');
const { anonymizeExpiredUsers } = require('./utils/accountLifecycle');

// Daily tombstone sweep (todo.md item O). Expiry ALSO happens lazily, wherever
// a tombstone blocks something (signup / OAuth), so correctness never depends
// on this running. This sweep is what expires tombstones nothing ever touches.
// Best-effort on purpose: a failed run is logged and the server keeps serving.
function sweepTombstones() {
    anonymizeExpiredUsers()
        .then((count) => {
            if (count > 0) console.log(`[lifecycle] anonymized ${count} expired account(s)`);
        })
        .catch((err) => console.error('[lifecycle] sweep failed', err));
}
setTimeout(sweepTombstones, 60 * 1000).unref();      // once shortly after boot
setInterval(sweepTombstones, 24 * 60 * 60 * 1000)    // then daily
    .unref();                                        // never keeps the process alive

const PORT = process.env.PORT || 3000;
app.listen(PORT, (error) => {
    if (error) {
        throw error;
    }
    console.log(`messaging app - listening on port ${PORT}!`);
});
