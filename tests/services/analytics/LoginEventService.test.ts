import {
  LoginEventService,
  hashIp,
  surfaceFromUserAgent,
} from "@/services/analytics/LoginEventService";

/**
 * Login-event recording (migration 028, `user_login_events`).
 *
 * The table exists because NextAuth runs JWT-only with no adapter and no
 * sessions table, so a sign-in left no trace in the database at all. What is
 * worth pinning down here is therefore not "does an INSERT happen" but the three
 * things a mistake would silently ruin:
 *
 *   - the raw IP NEVER reaches the database (only a salted digest, or NULL),
 *   - a Capacitor sign-in is filed under its native platform, not as mobile web,
 *   - a failing INSERT is swallowed, because throwing here would turn a valid
 *     sign-in into a failed one.
 *
 * The service takes its pool by constructor injection (the ManagementAuditService
 * pattern), so a stub is enough — no live Postgres.
 */

/** Minimal stand-in for the shared pg pool: records what would have been sent. */
function stubDb() {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return { rows: [] };
    }),
  };
}

const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret";
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
});

describe("surfaceFromUserAgent", () => {
  it("files the native shells under their platform, not as mobile web", () => {
    // The Capacitor UA also contains "iPhone"/"Android"; the RClipperNative
    // suffix has to win or every native sign-in would be counted as web.
    expect(
      surfaceFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) RClipperNative/ios"
      )
    ).toBe("ios");
    expect(
      surfaceFromUserAgent("Mozilla/5.0 (Linux; Android 14) RClipperNative/android")
    ).toBe("android");
  });

  it("treats an ordinary browser as web and a missing UA as unknown", () => {
    expect(surfaceFromUserAgent("Mozilla/5.0 (Macintosh) Chrome/120")).toBe("web");
    expect(surfaceFromUserAgent(null)).toBe("unknown");
    expect(surfaceFromUserAgent("")).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("is stable, salted, and never reversible to the address", () => {
    const digest = hashIp("203.0.113.7");
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain("203.0.113.7");
    expect(hashIp("203.0.113.7")).toBe(digest);
    expect(hashIp("203.0.113.8")).not.toBe(digest);

    // A different deployment secret must produce different digests, so a leaked
    // table cannot be cross-referenced against another environment's.
    process.env.NEXTAUTH_SECRET = "other-secret";
    expect(hashIp("203.0.113.7")).not.toBe(digest);
  });

  it("returns null for an absent IP rather than hashing the empty string", () => {
    // Hashing "" would give every IP-less sign-in the SAME non-null digest,
    // which reads as "these all came from one address".
    expect(hashIp(null)).toBeNull();
    expect(hashIp(undefined)).toBeNull();
    expect(hashIp("   ")).toBeNull();
  });
});

describe("LoginEventService.recordLogin", () => {
  it("stores the hashed IP and never the raw one", async () => {
    const db = stubDb();
    await new LoginEventService(db).recordLogin({
      userId: "user-1",
      provider: "google",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    const { text, values } = db.calls[0];
    expect(text).toContain("INSERT INTO user_login_events");
    expect(values).not.toContain("203.0.113.7");
    expect(values[4]).toBe(hashIp("203.0.113.7"));
    expect(JSON.stringify(values)).not.toContain("203.0.113.7");
  });

  it("derives the surface from the UA and defaults isNewUser to false", async () => {
    const db = stubDb();
    await new LoginEventService(db).recordLogin({
      userId: "user-2",
      provider: "apple-native",
      ip: null,
      userAgent: "Mozilla/5.0 (iPhone) RClipperNative/ios",
    });

    const { values } = db.calls[0];
    expect(values[1]).toBe("apple-native");
    expect(values[2]).toBe("ios");
    expect(values[3]).toBe(false);
    expect(values[4]).toBeNull();
  });

  it("prefers an explicitly supplied surface over UA derivation", async () => {
    // `pwa` is not derivable from a UA — an installed PWA sends the browser's —
    // so a caller that knows must be able to say so.
    const db = stubDb();
    await new LoginEventService(db).recordLogin({
      userId: "user-3",
      provider: "credentials",
      surface: "pwa",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
    });

    expect(db.calls[0].values[2]).toBe("pwa");
  });

  it("records the account-creating sign-in as new", async () => {
    const db = stubDb();
    await new LoginEventService(db).recordLogin({
      userId: "user-4",
      provider: "google",
      isNewUser: true,
    });

    expect(db.calls[0].values[3]).toBe(true);
  });

  it("swallows a database failure so a sign-in is never blocked", async () => {
    const db = {
      query: jest.fn(async () => {
        throw new Error("relation \"user_login_events\" does not exist");
      }),
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      new LoginEventService(db).recordLogin({
        userId: "user-5",
        provider: "credentials",
      })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
