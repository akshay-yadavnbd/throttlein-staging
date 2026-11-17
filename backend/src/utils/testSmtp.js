/**
 * Stand-alone SMTP verification.
 *
 *   npm run test:smtp                    # sends to your own SMTP user
 *   npm run test:smtp -- you@example.com # sends to a specific address
 *
 * Reads SMTP_* env vars (or HOST/EMAIL/PASS aliases) the same way the
 * forgot-password handler does.
 */
require('../config/loadEnv');

const nodemailer = require('nodemailer');
const { readConfig } = require('../config/mail');

(async () => {
  const { host, port, user, pass, secure, from } = readConfig();
  const to = (process.argv[2] || user || '').trim();

  console.log('SMTP config:');
  console.log('  host:   ', host);
  console.log('  port:   ', port);
  console.log('  secure: ', secure);
  console.log('  user:   ', user);
  console.log('  pass:   ', pass ? `(set, ${pass.length} chars)` : '(MISSING)');
  console.log('  from:   ', from);
  console.log('  to:     ', to);
  console.log('');

  if (!host || !user || !pass) {
    console.error('Missing required SMTP env. Set SMTP_HOST/SMTP_USER/SMTP_PASS (or HOST/EMAIL/PASS).');
    process.exit(1);
  }
  if (!to) {
    console.error('No recipient. Pass an address as arg or set SMTP_USER / EMAIL.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  try {
    console.log('1/2 verifying transport…');
    await transporter.verify();
    console.log('     ok ✓ — server accepted credentials and is ready');

    console.log('2/2 sending test mail…');
    const info = await transporter.sendMail({
      from,
      to,
      subject: 'THROTTLEIN — SMTP test ✓',
      text:
        'If you can read this, your SMTP config works.\n\n' +
        'You can now use the forgot-password flow on the frontend.',
      html:
        '<div style="font-family:sans-serif;padding:24px;background:#141414;color:#FFFFFF">' +
        '<h2 style="margin:0">THROT<span style="color:#BDFF00">●</span>TLEIN — SMTP works ✓</h2>' +
        '<p style="color:#EFF1EA">You can now use the forgot-password flow on the frontend.</p>' +
        '</div>',
    });
    console.log('     sent ✓');
    console.log('     messageId:', info.messageId);
    console.log('     response:', info.response);
    process.exit(0);
  } catch (err) {
    console.error('');
    console.error('SMTP test failed ✗');
    console.error('  code:        ', err.code);
    console.error('  command:     ', err.command);
    console.error('  response:    ', err.response);
    console.error('  responseCode:', err.responseCode);
    console.error('  message:     ', err.message);
    console.error('');
    console.error('Common fixes:');
    console.error('  • EAUTH        — wrong username or password');
    console.error('  • ENOTFOUND    — wrong host (typo or DNS issue)');
    console.error('  • ETIMEDOUT    — firewall blocking outbound 587/465');
    console.error('  • ECONNREFUSED — wrong port or SSL/TLS mismatch (try 465 with SECURE=true)');
    process.exit(1);
  }
})();
