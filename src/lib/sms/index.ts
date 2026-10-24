/**
 * SMS delivery for the creator phone OTP — the same shape as iTravy's
 * (travel_advisor backend/src/services/referral/sms/index.js):
 *
 *   SMS_PROVIDER unset  development: "console" (the code is printed in the
 *                       server log). production: NO provider — the OTP step
 *                       is skipped and the creator is marked unverified, so
 *                       shops keep working (logged once).
 *   SMS_PROVIDER=console  log only (dev / staging).
 *
 * To add a real provider (ThaiBulkSMS, Twilio, …) add an entry to PROVIDERS
 * with `send({ to, text })` that throws on failure; `to` is E.164. Use the
 * same provider on iTravy so both halves can actually send codes.
 */
export interface SmsProvider {
  name: string;
  send(message: { to: string; text: string }): Promise<void>;
}

const consoleProvider: SmsProvider = {
  name: "console",
  async send({ to, text }) {
    console.log(`[campaign][sms:console] to=${to} text="${text}"`);
  },
};

const PROVIDERS: Record<string, SmsProvider> = {
  console: consoleProvider,
};

let warned = false;

export function getSmsProvider(): SmsProvider | null {
  const configured = (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  if (configured) {
    const provider = PROVIDERS[configured];
    if (!provider) throw new Error(`[campaign] Unknown SMS_PROVIDER "${configured}"`);
    return provider;
  }
  if (process.env.NODE_ENV === "production") {
    if (!warned) {
      console.warn("[campaign] SMS_PROVIDER is not set — creator phone OTP is skipped");
      warned = true;
    }
    return null;
  }
  return consoleProvider;
}

/** Can a code actually be delivered right now? */
export function smsAvailable(): boolean {
  return getSmsProvider() !== null;
}
