import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { Session } from "../models.js";
import { jwtKey } from "../config/env.js";
import { digest } from "../utils/hashing.js";

export async function signAccess(user) {
  return new SignJWT({
    sid: String(user.shopId),
    ver: user.sessionVersion || 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuer("digital-khata-api")
    .setAudience("digital-khata-app")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtKey);
}
export async function issueTokens(user) {
  const accessToken = await signAccess(user),
    refreshToken = randomBytes(48).toString("base64url");
  await Session.create({
    userId: user._id,
    tokenHash: digest(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 86400_000),
  });
  return { accessToken, refreshToken, expiresIn: 900 };
}
