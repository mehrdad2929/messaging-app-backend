const nodemailer = require('nodemailer');

// A function (not a const) so it reads NODE_ENV at call time, even if
// dotenv loads after this file is required.
const isProd = () => process.env.NODE_ENV === 'production';

async function createTransporter() {
    // Real SMTP provider
    if (process.env.SMTP_HOST) {
        const port = Number(process.env.SMTP_PORT || 587);
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465, // 465 = TLS from the start, 587 upgrades after connecting
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
        });
        await transporter.verify(); // fail early if host/credentials are wrong
        return transporter;
    }

    // No SMTP configured: fine in dev, a misconfiguration in production
    if (isProd()) throw new Error('SMTP_HOST is not set');

    const account = await nodemailer.createTestAccount(); // Ethereal
    return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass },
    });
}

// CACHE: build the transporter once and reuse it. We store the PROMISE so
// two simultaneous first calls share one build instead of creating two.
let transporterPromise = null;

function getTransporter() {
    if (!transporterPromise) {
        transporterPromise = buildTransporter(); // stored immediately, before it resolves
    }
    return transporterPromise;
}

// Runs once per build attempt (not once per caller), so the reset below
// can never wipe out a newer, in-flight build.
async function buildTransporter() {
    try {
        return await createTransporter();
    } catch (err) {
        transporterPromise = null; // don't cache a failure, retry next time
        throw err;
    }
}

async function sendOtpEmail(to, code) {
    // Dev convenience: read the code from the terminal. Never in production.
    if (!isProd()) console.log(`[mailer] code for ${to}: ${code}`);

    let transporter;
    try {
        transporter = await getTransporter();
    } catch (err) {
        if (isProd()) throw err; // production must fail loudly, not pretend it sent
        console.warn('[mailer] no transporter, console only:', err.message);
        return;
    }

    const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Messaging App" <no-reply@example.com>',
        to,
        subject: 'Your verification code',
        // plain-text version too: some mail clients only show this
        text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't ask for this, ignore this email.`,
        html: `<p>Your verification code is <b style="font-size:24px;letter-spacing:4px">${code}</b></p>
           <p>It expires in 10 minutes. If you didn't ask for this, ignore this email.</p>`,
    });

    // Ethereal only: URL to view the email in a browser
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log('[mailer] preview:', preview);
}

module.exports = { sendOtpEmail };
