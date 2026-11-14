import {
  policy,
  validateEmbeddedImages,
  storedHtml,
} from "../../notifications/embeddedImages.js";
import express, { Router } from "express";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import { permit } from "../middleware/security.js";
import { id, parse } from "../validators/index.js";
import { fail } from "../utils/security.js";
import { audit } from "../services/audit.js";
import { AdminNotification } from "../../notifications/models.js";
import { normalizeContent, plainContent } from "../../notifications/content.js";
import {
  NotificationMedia,
  prepareImage,
  validateMediaContent,
  mediaIds,
} from "../../notifications/media.js";
import { Shop, User, Notification } from "../../models.js";
const router = Router(),
  mode = () => ({ appMode: process.env.APP_MODE });
const rich = (max) =>
  z.unknown().transform((v, ctx) => {
    try {
      return normalizeContent(v, max);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid or oversized rich content",
      });
      return z.NEVER;
    }
  });
const body = z
  .object({
    createKey: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    shortDescription: rich(1000),
    description: rich(12000),
    recipientType: z.enum(["all", "selected"]),
    shopIds: z.array(id).max(500).default([]),
    displayOn: z.string().datetime({ offset: true }),
    status: z.boolean().default(true),
    revision: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((v) => v.recipientType !== "selected" || v.shopIds.length > 0);
const filters = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce
      .number()
      .int()
      .refine((v) => [20, 50, 100].includes(v))
      .default(20),
    q: z.string().trim().max(100).default(""),
    recipientType: z.enum(["", "all", "selected"]).default(""),
    status: z.enum(["", "true", "false"]).default(""),
    state: z
      .enum(["", "scheduled", "processing", "published", "failed"])
      .default(""),
    deliveryState: z
      .enum([
        "",
        "pending",
        "claimed",
        "ticket_accepted",
        "failed",
        "unknown",
        "skipped",
      ])
      .default(""),
    shopId: id.optional(),
    createdBy: id.optional(),
    dateField: z
      .enum(["displayOn", "createdAt", "updatedAt"])
      .default("displayOn"),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    sort: z
      .enum(["createdAt", "updatedAt", "displayOn", "title"])
      .default("createdAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to);
const projection =
  "title shortDescription description preview recipientType shopIds displayOn status deletedAt createdBy updatedBy revision state publishedAt completedAt publishedCount attempts lastError nextAttemptAt createdAt updatedAt";
const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
router.get(
  "/notification-media",
  permit("notifications:read"),
  async (req, res) => {
    const f = parse(
      z
        .object({
          q: z.string().trim().max(80).default(""),
          page: z.coerce.number().int().min(1).max(500).default(1),
          limit: z.coerce
            .number()
            .int()
            .refine((v) => [20, 50, 100].includes(v))
            .default(20),
        })
        .strict(),
      req.query,
    );
    const exists = await NotificationMedia.db.db
      .listCollections(
        { name: NotificationMedia.collection.name },
        { nameOnly: true },
      )
      .hasNext();
    if (!exists)
      throw fail(
        503,
        "NOTIFICATION_MEDIA_NOT_PROVISIONED",
        "Notification media storage requires provisioning",
      );
    const match = { ...mode() };
    if (f.q)
      match.$or = [
        { filename: { $regex: escape(f.q), $options: "i" } },
        ...(/^[a-f\d]{24}$/i.test(f.q)
          ? [{ _id: new mongoose.Types.ObjectId(f.q) }]
          : []),
      ];
    const [data, total] = await Promise.all([
      NotificationMedia.find(match)
        .select("_id filename width height size createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip((f.page - 1) * f.limit)
        .limit(f.limit)
        .maxTimeMS(10000)
        .lean(),
      NotificationMedia.countDocuments(match).maxTimeMS(10000),
    ]);
    res.json({
      data: data.map((r) => ({
        ...r,
        url: `/admin/api/notification-media/${r._id}`,
      })),
      pagination: { page: f.page, limit: f.limit, total },
    });
  },
);
router.post(
  "/notification-media",
  permit("notifications:manage"),
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "2mb",
  }),
  async (req, res) => {
    const exists = await NotificationMedia.db.db
      .listCollections(
        { name: NotificationMedia.collection.name },
        { nameOnly: true },
      )
      .hasNext();
    if (!exists)
      throw fail(
        503,
        "NOTIFICATION_MEDIA_NOT_PROVISIONED",
        "Notification media storage requires provisioning",
      );
    const image = await prepareImage(
      req.body,
      req.get("content-type")?.split(";")[0],
    );
    let decodedName;
    try {
      decodedName = decodeURIComponent(
        req.get("x-notification-filename") || "Image",
      );
    } catch {
      throw fail(400, "INVALID_IMAGE_NAME", "Invalid image name");
    }
    const filename = parse(
      z
        .string()
        .max(120)
        .regex(/^[^\u0000-\u001f\u007f]*$/),
      decodedName,
    );
    let row;
    await mongoose.connection.transaction(async (session) => {
      [row] = await NotificationMedia.create(
        [{ ...image, filename, ...mode(), createdBy: req.admin._id }],
        { session },
      );
      await audit(
        req,
        "notification.media_upload",
        "notification_media",
        row._id,
        { size: image.size },
        session,
      );
    });
    res.status(201).json({
      data: {
        id: String(row._id),
        url: `/admin/api/notification-media/${row._id}`,
        width: row.width,
        height: row.height,
      },
    });
  },
);
router.get(
  "/notification-media/:id",
  permit("notifications:read"),
  async (req, res) => {
    const { metadata } = parse(
      z.object({ metadata: z.literal("1").optional() }).strict(),
      req.query,
    );
    const row = await NotificationMedia.findOne({
      _id: parse(id, req.params.id),
      ...mode(),
    }).select(metadata ? "_id width height" : "+bytes");
    if (!row)
      throw fail(404, "NOTIFICATION_MEDIA_NOT_FOUND", "Image unavailable");
    if (metadata)
      return res.json({
        data: {
          id: String(row._id),
          url: `/admin/api/notification-media/${row._id}`,
          width: row.width,
          height: row.height,
        },
      });
    res
      .set({
        "Content-Type": row.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(row.bytes);
  },
);
router.get("/notifications", permit("notifications:read"), async (req, res) => {
  const f = parse(filters, req.query),
    match = { ...mode() };
  if (f.q)
    match.$or = [
      { title: { $regex: escape(f.q), $options: "i" } },
      { preview: { $regex: escape(f.q), $options: "i" } },
      ...(/^[a-f\d]{24}$/i.test(f.q)
        ? [{ _id: new mongoose.Types.ObjectId(f.q) }]
        : []),
    ];
  for (const key of ["recipientType", "state"]) if (f[key]) match[key] = f[key];
  if (f.status) match.status = f.status === "true";
  if (f.createdBy) match.createdBy = new mongoose.Types.ObjectId(f.createdBy);
  if (f.shopId)
    match.$and = [
      {
        $or: [
          { recipientType: "all" },
          { shopIds: new mongoose.Types.ObjectId(f.shopId) },
        ],
      },
    ];
  if (f.from || f.to)
    match[f.dateField] = {
      ...(f.from ? { $gte: new Date(f.from) } : {}),
      ...(f.to ? { $lte: new Date(f.to) } : {}),
    };
  const stages = [{ $match: match }];
  if (f.deliveryState)
    stages.push(
      {
        $lookup: {
          from: Notification.collection.name,
          localField: "_id",
          foreignField: "campaignId",
          pipeline: [
            {
              $match: {
                campaignMode: process.env.APP_MODE,
                pushState: f.deliveryState,
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: "matchingDelivery",
        },
      },
      { $match: { "matchingDelivery.0": { $exists: true } } },
    );
  const [result] = await AdminNotification.aggregate([
    ...stages,
    {
      $facet: {
        data: [
          {
            $sort: {
              [f.sort]: f.direction === "asc" ? 1 : -1,
              _id: f.direction === "asc" ? 1 : -1,
            },
          },
          { $skip: (f.page - 1) * f.limit },
          { $limit: f.limit },
          {
            $project: Object.fromEntries(
              projection
                .split(" ")
                .filter((k) => !["shortDescription", "description"].includes(k))
                .map((k) => [k, 1]),
            ),
          },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]).option({ maxTimeMS: 10000 });
  const evidence = await Notification.aggregate([
    {
      $match: {
        campaignId: { $in: result.data.map((r) => r._id) },
        campaignMode: process.env.APP_MODE,
      },
    },
    {
      $group: {
        _id: { campaign: "$campaignId", state: "$pushState" },
        count: { $sum: 1 },
      },
    },
  ]).option({ maxTimeMS: 10000 });
  const data = result.data.map((r) => ({
    ...r,
    deliverySummary: evidence
      .filter((e) => String(e._id.campaign) === String(r._id))
      .map((e) => ({ state: e._id.state || "unavailable", count: e.count })),
  }));
  res.json({
    data,
    pagination: {
      page: f.page,
      limit: f.limit,
      total: result.total[0]?.count || 0,
    },
  });
});
router.get(
  "/notifications/recipients",
  permit("notifications:manage"),
  async (req, res) => {
    const f = parse(
      z
        .object({
          q: z.string().trim().max(100).default(""),
          page: z.coerce.number().int().min(1).max(1000).default(1),
        })
        .strict(),
      req.query,
    );
    const match = f.q
      ? {
          $or: [
            ...["name", "owner", "phone"].map((k) => ({
              [k]: { $regex: escape(f.q), $options: "i" },
            })),
            ...(/^[a-f\d]{24}$/i.test(f.q)
              ? [{ _id: new mongoose.Types.ObjectId(f.q) }]
              : []),
          ],
        }
      : {};
    const [r] = await Shop.aggregate([
      { $match: match },
      {
        $lookup: {
          from: User.collection.name,
          let: { owner: "$ownerId", shop: "$_id" },
          pipeline: [
            {
              $match: {
                disabledAt: { $exists: false },
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$owner"] },
                    { $eq: ["$shopId", "$$shop"] },
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
          ],
          as: "eligible",
        },
      },
      { $match: { "eligible.0": { $exists: true } } },
      {
        $facet: {
          count: [{ $count: "total" }],
          data: [
            { $sort: { name: 1, _id: 1 } },
            { $skip: (f.page - 1) * 20 },
            { $limit: 20 },
            { $project: { name: 1, owner: 1, phone: 1 } },
          ],
        },
      },
    ]).option({ maxTimeMS: 10000 });
    res.json({
      data: r.data,
      pagination: { page: f.page, limit: 20, total: r.count[0]?.total || 0 },
    });
  },
);
router.get(
  "/notifications/:id",
  permit("notifications:read"),
  async (req, res) => {
    const row = await AdminNotification.findOne({
      _id: parse(id, req.params.id),
      ...mode(),
    })
      .select(projection)
      .lean();
    if (!row)
      throw fail(404, "ADMIN_NOTIFICATION_NOT_FOUND", "Notification not found");
    const stats = await Notification.aggregate([
      { $match: { campaignId: row._id } },
      {
        $group: {
          _id: "$pushState",
          count: { $sum: 1 },
          read: { $sum: { $cond: ["$read", 1, 0] } },
          accepted: { $sum: { $ifNull: ["$pushAccepted", 0] } },
          rejected: { $sum: { $ifNull: ["$pushRejected", 0] } },
        },
      },
    ]).option({ maxTimeMS: 10000 });
    res.json({
      data: {
        ...row,
        delivery: stats,
        receipts: await Notification.aggregate([
          {
            $match: { campaignId: row._id, campaignMode: process.env.APP_MODE },
          },
          { $unwind: "$pushTickets" },
          { $group: { _id: "$pushTickets.status", count: { $sum: 1 } } },
        ]).option({ maxTimeMS: 10000 }),
        recipients:
          row.recipientType === "selected"
            ? await Shop.find({ _id: { $in: row.shopIds } })
                .select("name phone")
                .limit(500)
                .lean()
            : [],
      },
    });
  },
);
async function save(req, res, soft = false) {
  const target = req.params.id ? parse(id, req.params.id) : null;
  const input = soft
    ? parse(z.object({ revision: z.number().int().min(1) }).strict(), req.body)
    : parse(body, req.body);
  if (!soft && Buffer.byteLength(JSON.stringify(input)) > policy.documentBytes)
    throw fail(
      400,
      "ADMIN_CONTENT_TOO_LARGE",
      "Notification content is too large",
    );
  if (!soft) {
    try {
      await validateEmbeddedImages(input.shortDescription, input.description);
    } catch (e) {
      throw fail(400, "NOTIFICATION_IMAGE_INVALID", e.message);
    }
  }
  if (!target && !input.createKey)
    throw fail(
      400,
      "ADMIN_CREATION_KEY_REQUIRED",
      "Reload the creation form before saving",
    );
  const creationId = !target
    ? new mongoose.Types.ObjectId(
        createHash("sha256")
          .update(`${process.env.APP_MODE}:${req.admin._id}:${input.createKey}`)
          .digest("hex")
          .slice(0, 24),
      )
    : null;
  const session = await mongoose.startSession();
  let saved;
  try {
    await session.withTransaction(async () => {
      if (creationId) {
        const existing = await AdminNotification.findOne({
          _id: creationId,
          createdBy: req.admin._id,
          ...mode(),
        })
          .select(projection)
          .session(session)
          .lean();
        if (existing) {
          saved = existing;
          return;
        }
      }
      const old = target
        ? await AdminNotification.findOne({ _id: target, ...mode() }).session(
            session,
          )
        : null;
      if (target && !old)
        throw fail(
          404,
          "ADMIN_NOTIFICATION_NOT_FOUND",
          "Notification not found",
        );
      if (old && (old.deletedAt || input.revision !== old.revision))
        throw fail(
          409,
          "ADMIN_NOTIFICATION_CONFLICT",
          "Notification changed or was deleted; reload before saving",
        );
      if (old?.leaseToken && (!old.leaseUntil || old.leaseUntil > new Date()))
        throw fail(
          409,
          "ADMIN_NOTIFICATION_BUSY",
          "Publication is in progress; retry after it completes",
        );
      if (!soft) {
        input.shopIds = [...new Set(input.shopIds)].sort();
        if (input.recipientType === "all") input.shopIds = [];
        if (
          (old?.publishedAt || (old?.status && old.displayOn <= new Date())) &&
          (old.recipientType !== input.recipientType ||
            old.displayOn.getTime() !== Date.parse(input.displayOn) ||
            JSON.stringify(old.shopIds.map(String).sort()) !==
              JSON.stringify(input.shopIds))
        )
          throw fail(
            409,
            "ADMIN_NOTIFICATION_TARGET_LOCKED",
            "Published recipients and schedule cannot change",
          );
        if (
          !(old?.publishedAt || (old?.status && old.displayOn <= new Date())) &&
          input.shopIds.length
        ) {
          const shops = await Shop.find({ _id: { $in: input.shopIds } })
            .select("_id ownerId")
            .session(session)
            .lean();
          if (shops.length !== input.shopIds.length)
            throw fail(
              400,
              "ADMIN_RECIPIENT_UNAVAILABLE",
              "One or more shops are unavailable",
            );
          const users = await User.find({
            _id: { $in: shops.map((s) => s.ownerId) },
            disabledAt: { $exists: false },
          })
            .select("_id shopId")
            .session(session)
            .lean();
          if (
            shops.some(
              (s) =>
                !users.some(
                  (u) =>
                    String(u._id) === String(s.ownerId) &&
                    String(u.shopId) === String(s._id),
                ),
            )
          )
            throw fail(
              400,
              "ADMIN_RECIPIENT_UNAVAILABLE",
              "One or more shopkeepers are inactive",
            );
        }
      }
      if (!soft) {
        await validateMediaContent(input.shortDescription, session);
        await validateMediaContent(input.description, session);
      }
      const changes = soft
        ? { status: false, deletedAt: new Date() }
        : {
            title: input.title,
            shortDescription: storedHtml(input.shortDescription),
            description: storedHtml(input.description),
            preview: plainContent(input.shortDescription),
            mediaIds: [
              ...new Set([
                ...mediaIds(input.shortDescription),
                ...mediaIds(input.description),
              ]),
            ],
            recipientType: input.recipientType,
            shopIds: input.shopIds,
            displayOn: new Date(input.displayOn),
            status: input.status,
          };
      if (old) {
        saved = await AdminNotification.findOneAndUpdate(
          {
            _id: old._id,
            revision: input.revision,
            $or: [
              { leaseToken: { $exists: false } },
              { leaseUntil: { $lte: new Date() } },
            ],
          },
          {
            $set: { ...changes, updatedBy: req.admin._id },
            $unset: { leaseToken: 1, leaseUntil: 1 },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
          .select(projection)
          .lean();
        if (!saved)
          throw fail(
            409,
            "ADMIN_NOTIFICATION_CONFLICT",
            "Notification changed; reload",
          );
      } else {
        const [row] = await AdminNotification.create(
          [
            {
              _id: creationId,
              ...changes,
              ...mode(),
              status: true,
              createdBy: req.admin._id,
            },
          ],
          { session },
        );
        saved = row.toObject();
      }
      await audit(
        req,
        soft
          ? "notification.soft_delete"
          : old
            ? "notification.update"
            : "notification.create",
        "notification",
        saved._id,
        { recipientType: saved.recipientType },
        session,
      );
    });
  } finally {
    await session.endSession();
  }
  res.status(target ? 200 : 201).json({ data: saved });
}
router.post("/notifications", permit("notifications:manage"), (req, res) =>
  save(req, res),
);
router.patch("/notifications/:id", permit("notifications:manage"), (req, res) =>
  save(req, res),
);
router.post(
  "/notifications/:id/soft-delete",
  permit("notifications:manage"),
  (req, res) => save(req, res, true),
);
export default router;
