/**
 * set-google-ios-client-id.js — wire a Google **iOS** OAuth client into the app.
 *
 * Usage (from the project root):
 *   node scripts/set-google-ios-client-id.js 815687220043-abc123.apps.googleusercontent.com
 *
 * What it does:
 *   1. Validates the ID looks like an OAuth client ID.
 *   2. Computes the *reversed* form and writes it into ios/App/App/Info.plist
 *      (CFBundleURLTypes → the entry named "Google").
 *   3. Prints the two .env.local lines to add on the droplet.
 *
 * Why this exists: the reversed client ID is hand-derived by swapping two
 * dot-separated halves, and a single wrong character makes GoogleSignIn open a
 * sheet that dead-ends — with no useful error. Deriving it in code removes the
 * most common way this setup fails.
 *
 * Read docs/NATIVE_SIGN_IN.md → "Enabling native Google on iOS" before running.
 * In particular: do NOT set the env vars on the server until a build carrying
 * the scheme this writes is the build people are running.
 */
const fs = require("fs");
const path = require("path");

const PLACEHOLDER = "com.googleusercontent.apps.REPLACE_WITH_REVERSED_IOS_CLIENT_ID";
const SUFFIX = ".apps.googleusercontent.com";

const clientId = (process.argv[2] || "").trim();

if (!clientId) {
  console.error("Usage: node scripts/set-google-ios-client-id.js <ios-client-id>");
  console.error("  e.g. node scripts/set-google-ios-client-id.js 815687220043-abc123" + SUFFIX);
  process.exit(1);
}

if (!clientId.endsWith(SUFFIX)) {
  console.error(`Not a Google client ID — expected it to end in "${SUFFIX}".`);
  process.exit(1);
}

const stem = clientId.slice(0, -SUFFIX.length);
if (!/^[0-9]+-[a-z0-9]+$/i.test(stem)) {
  console.error(`Unexpected client ID shape: "${stem}". Expected <digits>-<hash>.`);
  process.exit(1);
}

// Reversed form: com.googleusercontent.apps.<stem>
const reversed = `com.googleusercontent.apps.${stem}`;

const plistPath = path.join(__dirname, "..", "ios", "App", "App", "Info.plist");
const plist = fs.readFileSync(plistPath, "utf8");

// Replace the placeholder, or a previously written scheme, so re-running is safe.
const existing = plist.match(/<string>(com\.googleusercontent\.apps\.[^<]*)<\/string>/);
if (!existing) {
  console.error(
    "No Google URL scheme found in Info.plist. Expected a CFBundleURLTypes entry " +
      `containing "${PLACEHOLDER}". Has the file been edited by hand?`
  );
  process.exit(1);
}

if (existing[1] === reversed) {
  console.log(`Info.plist already has ${reversed} — nothing to change.`);
} else {
  fs.writeFileSync(plistPath, plist.replace(existing[1], reversed), "utf8");
  console.log(`Info.plist: ${existing[1]}\n          -> ${reversed}`);
}

console.log("\nAdd these to .env.local ON THE DROPLET (not before build 10 ships):\n");
console.log(`NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID=${clientId}`);
console.log(`GOOGLE_IOS_CLIENT_ID=${clientId}`);
console.log("\nThen: npx cap sync ios && (cd ios/App && pod install)");
console.log("Open ios/App/App.xcworkspace — the workspace, not the project — and archive.");
