require('@dotenvx/dotenvx').config();
// Register the OAuth strategies EAGERLY, at boot, instead of lazily on the
// first /auth/google (or /auth/github) request. A missing client id or a config
// typo in config/passport.js then throws here, at deploy time, where you can
// still catch it - not at 2am under a real user's login.
// MUST run after dotenvx: the strategies read process.env.*_CLIENT_ID and
// passport-oauth2 throws "requires a clientID option" if it is undefined.
require('./config/passport');
const app = require('./app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, (error) => {
    if (error) {
        throw error;
    }
    console.log(`messaging app - listening on port ${PORT}!`);
});
