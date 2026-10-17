import { z } from "zod";
import { env } from "../config/env.js";
import { phoneSchema } from "../validators/schemas.js";
import { error } from "../utils/http.js";
import { sendOtp, verifyOtp } from "../providers.js";
import { issueTokens } from "../services/authService.js";
import { normalizePhone } from "../utils/phone.js";
import {
  findOrCreateAccount,
  hasOwnedShop,
  rotateRefreshSession,
  invalidateUserSessions,
} from "../services/authenticationService.js";

export const handle_post_auth_otp_start = async (req, res, next) => {
  try {
    const parsed = phoneSchema.safeParse(req.body?.phone);
    if (!parsed.success)
      return error(res, 400, "Enter a valid international phone number");
    const result = await sendOtp(normalizePhone(parsed.data));
    return res.status(202).json({
      accepted: true,
      channel: result.channel,
      ...(env.NODE_ENV !== "production" && result.developmentCode
        ? { developmentCode: result.developmentCode }
        : {}),
    });
  } catch (e) {
    next(e);
  }
};

export const handle_post_auth_otp_verify = async (req, res, next) => {
  try {
    const parsed = z
      .object({ phone: phoneSchema, code: z.string().regex(/^\d{4,8}$/) })
      .safeParse(req.body);
    if (!parsed.success) return error(res, 400, "Invalid verification request");
    const phone = normalizePhone(parsed.data.phone);
    if (!(await verifyOtp(phone, parsed.data.code)))
      return error(res, 401, "Incorrect or expired verification code");
    const account = await findOrCreateAccount(phone);
    if (!account) return error(res, 503, "Account could not be created");
    if (account.disabledAt)
      return error(res, 403, "This account is disabled");
    const shopExists = await hasOwnedShop(account);
    res.json({
      ...(await issueTokens(account)),
      isNew: !shopExists,
      accountStatus: shopExists ? "account_registered_with_shop" : "account_registered_no_shop",
    });
  } catch (e) {
    next(e);
  }
};

export const handle_post_auth_refresh = async (req, res, next) => {
  try {
    const value = z.string().min(40).max(200).safeParse(req.body?.refreshToken);
    if (!value.success) return error(res, 401, "Invalid refresh token");
    const result = await rotateRefreshSession(value.data);
    if (!result) return error(res, 401, "Refresh token expired");
    if (result.unavailable) return error(res, 401, "Account unavailable");
    res.json(result);
  } catch (e) {
    next(e);
  }
};

export const handle_post_auth_logout = async (req, res, next) => {
  try {
    await invalidateUserSessions(req.user._id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};
