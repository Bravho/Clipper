import { SignJWT, importPKCS8 } from "jose";

const teamId = process.env.APPLE_TEAM_ID;
const clientId = process.env.APPLE_CLIENT_ID;
const keyId = process.env.APPLE_KEY_ID;

const privateKeyPem = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!teamId || !clientId || !keyId || !privateKeyPem) {
  throw new Error("Missing Apple authentication environment variables");
}

const privateKey = await importPKCS8(privateKeyPem, "ES256");

const now = Math.floor(Date.now() / 1000);

const appleClientSecret = await new SignJWT({})
  .setProtectedHeader({
    alg: "ES256",
    kid: keyId,
  })
  .setIssuer(teamId)
  .setSubject(clientId)
  .setAudience("https://appleid.apple.com")
  .setIssuedAt(now)
  .setExpirationTime(now + 60 * 60 * 24 * 180)
  .sign(privateKey);

console.log(appleClientSecret);