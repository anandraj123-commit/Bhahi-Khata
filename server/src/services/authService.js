import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { Session } from "../models.js";
import { jwtKey } from "../config/env.js";
import { digest } from "../utils/hashing.js";

export async function signAccess(user) {
  return new SignJWT({ ver: user.sessionVersion || 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuer("digital-khata-api")
    .setAudience("digital-khata-app")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtKey);
}
export async function issueTokens(user, session) {
  const accessToken = await signAccess(user),
    refreshToken = randomBytes(48).toString("base64url");
  const refreshSession = {
    userId: user._id,
    tokenHash: digest(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 86400_000),
  };
  if (session)
    await Session.create([refreshSession], { session });
  else await Session.create(refreshSession);
  return { accessToken, refreshToken, expiresIn: 900 };
}
