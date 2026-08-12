import nodemailer from "nodemailer";

/**
 * Outbound email.
 *
 * WHY THERE ARE THREE TRANSPORTS, AND WHY SMTP IS LAST.
 *
 * DigitalOcean Droplets block outbound TCP on ports 25, 465 and 587 by default.
 * A blocked port does not refuse the connection — the SYN is dropped — so an
 * SMTP send does not fail, it *hangs*. Nodemailer's own defaults then keep the
 * socket open for two minutes (connectionTimeout) or ten (socketTimeout), and
 * because every mail send is awaited inside a route handler, the HTTP request
 * hangs with it. That is what left "สร้างบัญชี" and "Resend verification code"
 * spinning forever while the account had in fact already been created.
 *
 * The fix has two halves and both matter:
 *
 *   1. Prefer an HTTPS email API (port 443, never blocked). Brevo — the account
 *      the SMTP credentials already belong to — exposes one at
 *      https://api.brevo.com/v3/smtp/email, so BREVO_API_KEY needs no new vendor.
 *   2. Bound *every* transport with an explicit deadline, so a hung network path
 *      surfaces as a fast, catchable error instead of a spinner. Callers already
 *      handle a throw (registration keeps the account and reports
 *      `verificationEmailSent: false`); what they could not handle was waiting.
 *
 * SMTP remains for local development and for hosts that do allow outbound SMTP.
 */

/**
 * Hard ceiling on a single send attempt. Chosen to stay well inside the
 * platform's own request timeout so the route can always answer the browser.
 */
const SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS ?? "12000");

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly transport: "brevo" | "resend" | "smtp",
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** `RClipper <noreply@rclipper.com>` -> `{ name, email }`, tolerating a bare address. */
function parseSender(raw: string): { name?: string; email: string } {
  const angled = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (angled) {
    const name = angled[1].replace(/^"|"$/g, "").trim();
    return { email: angled[2].trim(), ...(name ? { name } : {}) };
  }
  return { email: raw.trim() };
}

function senderHeader(): string {
  return process.env.EMAIL_FROM ?? "RClipper <noreply@rclipper.com>";
}

/**
 * Reject once `ms` has elapsed. `AbortController` covers the fetch transports;
 * this covers nodemailer, which has no abort signal, and acts as a backstop for
 * any promise that ignores its own timeout.
 */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- Transport 1: Brevo HTTPS API ----------------------------------------

async function sendViaBrevo(
  apiKey: string,
  options: EmailOptions
): Promise<void> {
  const sender = parseSender(senderHeader());

  const response = await withDeadline(
    (signal) =>
      fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        signal,
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender,
          to: [{ email: options.to }],
          subject: options.subject,
          htmlContent: options.html,
          textContent: options.text,
        }),
      }),
    SEND_TIMEOUT_MS,
    "Brevo API request"
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    // 400 with "sender not valid" means EMAIL_FROM is not a verified sender in
    // Brevo. Free webmail addresses (gmail.com etc.) can never be verified —
    // use an address on a domain authenticated in the Brevo dashboard.
    throw new EmailDeliveryError(
      `Brevo API request failed (${response.status}): ${detail}`,
      "brevo"
    );
  }
}

// ---- Transport 2: Resend HTTPS API ---------------------------------------

async function sendViaResend(
  apiKey: string,
  options: EmailOptions
): Promise<void> {
  const response = await withDeadline(
    (signal) =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: senderHeader(),
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      }),
    SEND_TIMEOUT_MS,
    "Resend API request"
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new EmailDeliveryError(
      `Resend API request failed (${response.status}): ${detail}`,
      "resend"
    );
  }
}

// ---- Transport 3: SMTP ----------------------------------------------------

/**
 * Built lazily so that a deployment using an HTTPS API never constructs a
 * transport for credentials it does not have.
 *
 * The three timeouts are the whole point: nodemailer's defaults (2 min connect,
 * 10 min socket) are far longer than any HTTP request should live.
 */
let smtpTransporter: nodemailer.Transporter | undefined;

function getSmtpTransporter(): nodemailer.Transporter {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    });
  }
  return smtpTransporter;
}

async function sendViaSmtp(options: EmailOptions): Promise<void> {
  if (!process.env.SMTP_HOST) {
    throw new EmailDeliveryError(
      "No email transport configured. Set BREVO_API_KEY (recommended on DigitalOcean, which blocks outbound SMTP), RESEND_API_KEY, or SMTP_HOST.",
      "smtp"
    );
  }

  try {
    await withDeadline(
      () =>
        getSmtpTransporter().sendMail({
          from: senderHeader(),
          ...options,
        }),
      // Slightly beyond the socket timeout so nodemailer's own error — which
      // names the failing stage — wins the race when it is working correctly.
      SEND_TIMEOUT_MS + 2_000,
      "SMTP send"
    );
  } catch (error) {
    throw new EmailDeliveryError(
      `SMTP send failed via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? "587"}. ` +
        "If this host is a DigitalOcean Droplet, outbound ports 25/465/587 are blocked — " +
        "set BREVO_API_KEY to send over HTTPS instead. " +
        (error instanceof Error ? error.message : String(error)),
      "smtp",
      error
    );
  }
}

// ---- Public API -----------------------------------------------------------

/** Which transport a send would use. Exposed for the email diagnostics route. */
export function activeEmailTransport(): "brevo" | "resend" | "smtp" | "none" {
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST) return "smtp";
  return "none";
}

/**
 * Send one email. Always settles within roughly SEND_TIMEOUT_MS — it never
 * leaves a request handler waiting on a dropped packet.
 *
 * @throws EmailDeliveryError with the transport and provider detail attached.
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  const brevoApiKey = process.env.BREVO_API_KEY;
  if (brevoApiKey) {
    await sendViaBrevo(brevoApiKey, options);
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    await sendViaResend(resendApiKey, options);
    return;
  }

  await sendViaSmtp(options);
}
