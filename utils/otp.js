const crypto = require('crypto');
// NOTE on shape: every function below is declared as a plain local (const /
// function) FIRST and exported at the bottom. The old version did
// `exports.hashCode = ...` and then called bare `hashCode(...)` inside
// codesEqual — but `exports.hashCode = ...` does NOT create a local variable
// called hashCode, so that call threw ReferenceError on every single verify
// attempt (surfaced as a generic 500). Rule of thumb: `exports.x` makes it
// visible OUTSIDE the file; only a declaration makes it usable INSIDE it.

// STEP 1 — make a code. crypto.randomInt is cryptographically secure
// (unlike Math.random). Keep it a STRING so leading zeros survive:
// "004213" is a valid code, the number 4213 would lose a digit.
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// STEP 2 — hash it with the server pepper. The pepper lives only in .env,
// so a stolen database backup alone is not enough to recover live codes.
const hashCode = (code) =>
    crypto.createHmac('sha256', process.env.OTP_PEPPER).update(code).digest();

// STEP 3 — compare in constant time so response speed can't leak HOW MANY
// digits of a guess were right (timing attack). Buffers must be same length.
const codesEqual = (guess, storedHex) => {
    const a = hashCode(guess);
    const b = Buffer.from(storedHex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { newCode, hashCode, codesEqual };
