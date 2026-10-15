import { z } from "zod";
import { idSchema } from "../validators/schemas.js";
import { error } from "../utils/http.js";
import {
  sendCustomerSms,
  sendCustomerWhatsApp,
} from "../services/messagingService.js";

export const handle_post_messages_whatsapp = async (req, res, next) => {
  try {
    const value = z
      .object({
        customerId: idSchema,
        parameters: z.array(z.string().max(1000)).max(10),
      })
      .safeParse(req.body);
    if (!value.success) return error(res, 400, "Invalid message request");
    await sendCustomerWhatsApp({
      shopId: req.shopId,
      customerId: value.data.customerId,
      parameters: value.data.parameters,
    });
    res.status(202).json({ accepted: true });
  } catch (e) {
    if (e.status) return error(res, e.status, e.message);
    next(e);
  }
};

export const handle_post_messages_sms = async (req, res, next) => {
  try {
    const value = z.object({ customerId: idSchema }).safeParse(req.body);
    if (!value.success) return error(res, 400, "Invalid message request");
    await sendCustomerSms({
      shopId: req.shopId,
      customerId: value.data.customerId,
    });
    res.status(202).json({ accepted: true });
  } catch (e) {
    if (e.status) return error(res, e.status, e.message);
    next(e);
  }
};
