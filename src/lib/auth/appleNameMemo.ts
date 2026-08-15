/**
 * A short-lived note of the display name Apple hands over on Android.
 *
 * Apple returns the user's name exactly **once** — on the very first
 * authorization for a given client — and never in the identity token. On iOS the
 * native sheet gives it to the client, which forwards it to `apple-native` as a
 * credential. On Android it arrives instead as a `user` form field on the
 * `form_post` callback, and `@capgo/capacitor-social-login` drops it: its Android
 * provider builds the profile by decoding the identity token, where
 * `givenName`/`familyName` are hard-coded to null.
 *
 * So the callback route parks the name here, keyed by Apple's `sub`, and
 * `verifyAppleIdToken` collects it moments later when the app exchanges the
 * token for a session. Without this, every Android Apple signup would be created
 * with the email address as its display name, and Apple will not send the name
 * again — the user would have to fix it by hand.
 *
 * Deliberately in-memory and best-effort:
 *
 *  - the two requests are seconds apart, by the same user, and the web app runs
 *    as a single `pm2` process, so a Map is enough;
 *  - a miss costs a display name, not a sign-in, so it is not worth a migration;
 *  - and nothing here is authorisation state — the identity token is verified
 *    against Apple's JWKS regardless of what this file says.
 *
 * If the web app is ever scaled past one process, this degrades to "sometimes
 * the name is missed", never to a security problem.
 */

/** Apple's callback and the token exchange are seconds apart; minutes is generous. */
const TTL_MS = 10 * 60 * 1000;

/** Bounds the map if entries are never collected (a user who abandons sign-in). */
const MAX_ENTRIES = 500;

const MAX_NAME_LENGTH = 120;

interface Entry {
  name: string;
  expiresAt: number;
}

/**
 * `globalThis` singleton, following the repository convention: Next's dev server
 * re-evaluates modules on hot reload, and a plain module-level Map would be
 * discarded between the callback and the exchange.
 */
const store: Map<string, Entry> = ((
  globalThis as typeof globalThis & { __appleNameMemo?: Map<string, Entry> }
).__appleNameMemo ??= new Map());

/**
 * Names come from Apple's callback body, which is attacker-shaped input — the
 * `user` field is supplied by the client, not signed. Strip control characters
 * and cap the length, exactly as `oidcVerify` does for the iOS path.
 */
function sanitise(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME_LENGTH)
  );
}

function evictExpired(now: number): void {
  for (const [sub, entry] of store) {
    if (entry.expiresAt <= now) store.delete(sub);
  }
}

/** Park a name for `sub`. No-ops on a blank name so it never clears a good one. */
export function rememberAppleName(sub: string, name: string | undefined): void {
  if (!sub || !name) return;

  const cleaned = sanitise(name);
  if (!cleaned) return;

  const now = Date.now();
  evictExpired(now);

  if (store.size >= MAX_ENTRIES) {
    // Oldest insertion first — Map preserves insertion order.
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }

  store.set(sub, { name: cleaned, expiresAt: now + TTL_MS });
}

/**
 * Collect and remove the name parked for `sub`.
 *
 * Consuming rather than reading keeps the map self-cleaning, and there is only
 * ever one exchange per callback.
 */
export function takeAppleName(sub: string): string | undefined {
  if (!sub) return undefined;

  const entry = store.get(sub);
  if (!entry) return undefined;

  store.delete(sub);
  return entry.expiresAt > Date.now() ? entry.name : undefined;
}

/** Test seam. */
export function clearAppleNameMemo(): void {
  store.clear();
}
