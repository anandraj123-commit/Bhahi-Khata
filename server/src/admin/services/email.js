import nodemailer from "nodemailer";

function smtpConfig() {
  const host = process.env.ADMIN_SMTP_HOST;
  const port = Number(process.env.ADMIN_SMTP_PORT);
  const user = process.env.ADMIN_SMTP_USER;
  const password = process.env.ADMIN_SMTP_PASSWORD;
  const from = process.env.ADMIN_EMAIL_FROM;
  if (
    !host ||
    ![465, 587].includes(port) ||
    !user ||
    !password ||
    !from ||
    /[\r\n]/.test(from)
  )
    throw new Error("Admin email delivery is not configured");
  return {
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass: password.replaceAll(" ", "") },
    from,
  };
}

export async function sendAdminPasswordReset(email, token) {
  const config = smtpConfig();
  const origins = (process.env.ADMIN_TRUSTED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const origin = process.env.ADMIN_PASSWORD_RESET_ORIGIN || origins[0];
  if (!origin || !origins.includes(origin))
    throw new Error("Admin password reset origin is not trusted");
  const url = new URL("/admin/reset-password", origin);
  // Keep the bearer token in the URL fragment so it is not sent to server logs.
  url.hash = `token=${token}`;
  const transporter = nodemailer.createTransport(config);
  try {
    await transporter.sendMail({
      from: config.from,
      to: email,
      subject: "Reset your Digital Khata admin password",
      text: `A password reset was requested for your Digital Khata administrator account. Use this one-time link within 30 minutes:\n\n${url}\n\nIf you did not request this, ignore this email.`,
      html: `<p>A password reset was requested for your Digital Khata administrator account.</p><p><a href="${url}">Reset your password</a></p><p>This one-time link expires in 30 minutes. If you did not request this, ignore this email.</p>`,
    });
  } finally {
    transporter.close();
  }
}
