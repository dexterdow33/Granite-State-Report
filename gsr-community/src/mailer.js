const nodemailer = require('nodemailer');

// Sends plain-text mail through SMTP_URL. Without it (local development), prints to the console.
function createMailer(config) {
  if (!config.smtpUrl) {
    return {
      async send({ to, subject, text }) {
        console.log(`\n[mail] to=${to} subject=${subject}\n${text}\n`);
      },
    };
  }
  const transport = nodemailer.createTransport(config.smtpUrl);
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
    },
  };
}

module.exports = { createMailer };
