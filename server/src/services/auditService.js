import { z } from "zod";
import { Audit } from "../models.js";
import { idSchema, daySchema, entrySchema } from "../validators/schemas.js";

export async function saveAudit({ shopId, actorId, session }, a) {
  const parsed = z
    .object({
      id: idSchema,
      action: z.string().max(250),
      date: z.string().datetime().or(daySchema),
      before: entrySchema.optional(),
      after: entrySchema.optional(),
    })
    .safeParse(a);
  if (parsed.success)
    await Audit.updateOne(
      { shopId, clientId: parsed.data.id },
      {
        $setOnInsert: {
          shopId,
          actorId,
          clientId: parsed.data.id,
          action: parsed.data.action,
          occurredAt: new Date(parsed.data.date),
          ...(parsed.data.before ? { before: parsed.data.before } : {}),
          ...(parsed.data.after ? { after: parsed.data.after } : {}),
        },
      },
      { upsert: true, ...(session ? { session } : {}) },
    );
}
