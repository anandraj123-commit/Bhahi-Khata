import { z } from "zod";
import { error } from "../utils/http.js";
import { registerPushToken } from "../services/devicesService.js";

export const handle_post_devices_push_token = async (req, res, next) => {
  try {
    const value = z
      .object({
        token: z.string().regex(/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/),
        platform: z.enum(["android", "ios", "web"]),
      })
      .safeParse(req.body);
    if (!value.success) return error(res, 400, "Invalid push token");
    await registerPushToken({
      shopId: req.shopId,
      token: value.data.token,
      platform: value.data.platform,
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};
