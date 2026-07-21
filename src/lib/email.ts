import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "RClipper <noreply@rclipper.com>",
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `Email API request failed (${response.status}): ${detail}`
      );
    }
    return;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "Clipper <noreply@clipper.app>",
    ...options,
  });
}
