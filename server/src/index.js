import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pino from "pino";
import pinoHttp from "pino-http";
import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import {
  Audit,
  Customer,
  Device,
  Entry,
  Idempotency,
  Notification,
  Session,
  Shop,
  User,
  ensureIndexes,
} from "./models.js";
import {
  isSmsConfigured,
  sendOtp,
  verifyOtp,
  sendSms,
  sendWhatsApp,
} from "./providers.js";
import { startReminderWorker } from "./reminders.js";

const env = process.env,
  app = express();
const log = pino({
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "*.phone",
    "*.token",
    "*.address",
    "*.body",
  ],
});
const secret = env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters");
if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required");
const jwtKey = new TextEncoder().encode(secret);
app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY === "true" ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
const origins = (env.APP_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || origins.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    maxAge: 600,
  }),
);
app.use(compression());
app.use(express.json({ limit: "10mb", strict: true }));
app.use(
  pinoHttp({
    logger: log,
    genReqId: (req) =>
      req.headers["x-request-id"]?.toString().slice(0, 80) ||
      randomBytes(12).toString("hex"),
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url.split("?")[0],
      }),
    },
  }),
);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const api = express.Router();
app.use("/api/v1", api);
const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." },
  });
const otpLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip)}:${String(req.body?.phone || "").slice(0, 20)}`,
    message: { error: "Too many OTP requests. Try again later." },
  }),
  authLimit = limiter(15 * 60_000, 20),
  writeLimit = limiter(60_000, 120);
api.use(limiter(60_000, 300));
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/);
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const customerSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    phone: z
      .string()
      .max(20)
      .refine(
        (value) =>
          !value ||
          /^[6-9]\d{9}$/.test(value) ||
          /^\+[1-9]\d{7,14}$/.test(value),
      )
      .default(""),
    address: z.string().max(500).default(""),
    opening: z.number().finite().min(0).max(1e9),
    limit: z.number().finite().min(0).max(1e9),
    reminder: z.boolean(),
  })
  .strict();
const entrySchema = z
  .object({
    id: idSchema,
    customerId: idSchema,
    type: z.enum(["credit", "payment"]),
    amount: z.number().finite().min(0.01).max(1e9),
    date: daySchema,
    note: z.string().max(1000).default(""),
    method: z.string().max(50).default("Cash"),
    due: z.union([z.literal(""), daySchema]).default(""),
  })
  .strict();
const backupSchema = z
  .object({
    shop: z.object({
      name: z.string().max(120),
      owner: z.string().max(120),
      address: z.string().max(500),
      phone: z.string().max(20),
      whatsapp: z.string().max(20),
    }),
    customers: z
      .array(
        customerSchema.extend({ createdAt: z.string().datetime().optional() }),
      )
      .max(5000),
    entries: z.array(entrySchema).max(50000),
    audit: z
      .array(
        z.object({
          id: idSchema,
          action: z.string().max(250),
          date: z.string().datetime().or(daySchema),
          before: entrySchema.optional(),
          after: entrySchema.optional(),
        }),
      )
      .max(10000),
    language: z.string().max(20),
    reminders: z.object({
      enabled: z.boolean(),
      day: z.string().max(30),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      minimum: z.string().regex(/^\d+(\.\d{1,2})?$/),
      whatsapp: z.boolean(),
      sms: z.boolean(),
    }),
    defaultMethod: z.string().max(50),
    read: z.array(idSchema).max(10000),
  })
  .strict();
const shopSchema = z
  .object({
    name: z.string().trim().max(120),
    owner: z.string().trim().max(120),
    address: z.string().max(500),
    phone: phoneSchema,
    whatsapp: z.string().max(20),
    language: z.string().max(20).optional(),
    defaultMethod: z.string().max(50).optional(),
    reminders: z
      .object({
        enabled: z.boolean(),
        day: z.string().max(30),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        minimum: z.string().regex(/^\d+(\.\d{1,2})?$/),
        whatsapp: z.boolean(),
        sms: z.boolean(),
      })
      .optional(),
  })
  .strict();
const digest = (value) => createHash("sha256").update(value).digest("hex");
const paise = (value) => Math.round(value * 100);
const customerOut = (d) => ({
  id: d.clientId,
  createdAt: d.createdAt?.toISOString?.(),
  name: d.name,
  phone: d.phone,
  address: d.address,
  opening: d.openingPaise / 100,
  limit: d.limitPaise / 100,
  reminder: d.reminder,
});
const entryOut = (d) => ({
  id: d.clientId,
  customerId: d.customerClientId,
  type: d.type,
  amount: d.amountPaise / 100,
  date: d.date,
  note: d.note,
  method: d.method,
  due: d.due,
});
const shopOut = (d) => ({
  name: d.name,
  owner: d.owner,
  address: d.address,
  phone: d.phone,
  whatsapp: d.whatsapp,
  language: d.language,
  defaultMethod: d.defaultMethod,
  reminders: d.reminders,
});
const error = (res, status, message) =>
  res.status(status).json({ error: message });
async function signAccess(user) {
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
async function issueTokens(user) {
  const accessToken = await signAccess(user),
    refreshToken = randomBytes(48).toString("base64url");
  await Session.create({
    userId: user._id,
    tokenHash: digest(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 86400_000),
  });
  return { accessToken, refreshToken, expiresIn: 900 };
}
async function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return error(res, 401, "Authentication required");
    const { payload } = await jwtVerify(token, jwtKey, {
      issuer: "digital-khata-api",
      audience: "digital-khata-app",
    });
    const user = await User.findOne({
      _id: payload.sub,
      shopId: payload.sid,
      disabledAt: { $exists: false },
    }).lean();
    if (!user || payload.ver !== (user.sessionVersion || 0))
      return error(res, 401, "Session expired");
    req.user = user;
    req.shopId = user.shopId;
    next();
  } catch {
    return error(res, 401, "Invalid or expired session");
  }
}
api.get("/health", (req, res) =>
  res.json({
    status: mongoose.connection.readyState === 1 ? "ok" : "starting",
  }),
);
api.post("/auth/otp/start", otpLimit, async (req, res, next) => {
  try {
    const parsed = phoneSchema.safeParse(req.body?.phone);
    if (!parsed.success)
      return error(res, 400, "Enter a valid international phone number");
    const result = await sendOtp(parsed.data);
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
});
api.post("/auth/otp/verify", authLimit, async (req, res, next) => {
  try {
    const parsed = z
      .object({ phone: phoneSchema, code: z.string().regex(/^\d{4,8}$/) })
      .safeParse(req.body);
    if (!parsed.success) return error(res, 400, "Invalid verification request");
    if (!(await verifyOtp(parsed.data.phone, parsed.data.code)))
      return error(res, 401, "Incorrect or expired verification code");
    let user = await User.findOne({ phone: parsed.data.phone });
    if (!user) {
      try {
        await mongoose.connection.transaction(async (session) => {
          user = await User.findOne({ phone: parsed.data.phone }).session(
            session,
          );
          if (user) return;
          const userId = new mongoose.Types.ObjectId();
          const shopId = new mongoose.Types.ObjectId();
          const [created] = await User.create(
            [{ _id: userId, phone: parsed.data.phone, shopId }],
            { session },
          );
          await Shop.create(
            [{ _id: shopId, ownerId: userId, phone: parsed.data.phone }],
            { session },
          );
          user = created;
        });
      } catch (e) {
        if (e.code !== 11000) throw e;
        user = await User.findOne({ phone: parsed.data.phone });
      }
    }
    if (!user) return error(res, 503, "Account could not be created");
    if (user.disabledAt) return error(res, 403, "This account is disabled");
    res.json({
      ...(await issueTokens(user)),
      isNew: !Boolean((await Shop.findById(user.shopId).lean())?.name),
    });
  } catch (e) {
    next(e);
  }
});
api.post("/auth/refresh", authLimit, async (req, res, next) => {
  try {
    const value = z.string().min(40).max(200).safeParse(req.body?.refreshToken);
    if (!value.success) return error(res, 401, "Invalid refresh token");
    const session = await Session.findOne({
      tokenHash: digest(value.data),
      expiresAt: { $gt: new Date() },
    });
    if (!session) return error(res, 401, "Refresh token expired");
    const user = await User.findById(session.userId);
    if (!user || user.disabledAt) return error(res, 401, "Account unavailable");
    await session.deleteOne();
    res.json(await issueTokens(user));
  } catch (e) {
    next(e);
  }
});
api.post("/auth/logout", auth, async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { sessionVersion: 1 } });
  await Session.deleteMany({ userId: req.user._id });
  res.status(204).end();
});
api.get("/bootstrap", auth, async (req, res, next) => {
  try {
    const [shop, customers, entries, audits] = await Promise.all([
      Shop.findById(req.shopId).lean(),
      Customer.find({ shopId: req.shopId, deletedAt: { $exists: false } })
        .sort({ nameFolded: 1, _id: 1 })
        .limit(500)
        .lean(),
      Entry.find({ shopId: req.shopId, deletedAt: { $exists: false } })
        .sort({ date: -1, _id: -1 })
        .limit(2000)
        .lean(),
      Audit.find({ shopId: req.shopId })
        .sort({ occurredAt: -1, _id: -1 })
        .limit(500)
        .lean(),
    ]);
    const customerIds = customers.map((c) => c.clientId);
    const totals = await Entry.aggregate([
      {
        $match: {
          shopId: new mongoose.Types.ObjectId(req.shopId),
          customerClientId: { $in: customerIds },
          deletedAt: { $exists: false },
        },
      },
      {
        $group: {
          _id: "$customerClientId",
          total: {
            $sum: {
              $cond: [
                { $eq: ["$type", "credit"] },
                "$amountPaise",
                { $multiply: ["$amountPaise", -1] },
              ],
            },
          },
        },
      },
    ]);
    const creditById = new Map(totals.map((x) => [x._id, x.total]));
    const byId = new Map(
      customers.map((c) => [
        c.clientId,
        (c.openingPaise || 0) + (creditById.get(c.clientId) || 0),
      ]),
    );
    res.json({
      shop: shopOut(shop),
      customers: customers.map(customerOut),
      entries: entries.map(entryOut),
      audit: audits.map((x) => ({
        id: x.clientId,
        action: x.action,
        date: x.occurredAt.toISOString(),
        ...(x.before ? { before: x.before } : {}),
        ...(x.after ? { after: x.after } : {}),
      })),
      signedIn: true,
      language: shop.language || "English",
      reminders: shop.reminders,
      defaultMethod: shop.defaultMethod,
      read: shop.readAuditIds || [],
      summary: {
        customers: customers.length,
        duePaise: [...byId.values()].reduce((s, x) => s + Math.max(x, 0), 0),
        balanceByCustomer: Object.fromEntries(byId),
      },
    });
  } catch (e) {
    next(e);
  }
});
api.get("/activity", auth, async (req, res, next) => {
  try {
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 100),
    );
    const filter = { shopId: req.shopId };
    if (req.query.cursor) {
      const cursor = await Audit.findOne({
        shopId: req.shopId,
        clientId: req.query.cursor,
      })
        .select("_id occurredAt")
        .lean();
      if (cursor)
        filter.$or = [
          { occurredAt: { $lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, _id: { $lt: cursor._id } },
        ];
    }
    const rows = await Audit.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const more = rows.length > limit;
    if (more) rows.pop();
    res.json({
      items: rows.map((x) => ({
        id: x.clientId,
        action: x.action,
        date: x.occurredAt.toISOString(),
        ...(x.before ? { before: x.before } : {}),
        ...(x.after ? { after: x.after } : {}),
      })),
      nextCursor: more ? rows.at(-1).clientId : null,
    });
  } catch (e) {
    next(e);
  }
});
api.get("/shop", auth, async (req, res, next) => {
  try {
    const s = await Shop.findById(req.shopId).lean();
    res.json(shopOut(s));
  } catch (e) {
    next(e);
  }
});
api.patch("/shop", auth, writeLimit, async (req, res, next) => {
  try {
    const parsed = shopSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 400, "Invalid shop profile");
    if (parsed.data.phone !== req.user.phone)
      return error(
        res,
        403,
        "Shop phone cannot be changed without phone verification",
      );
    const s = await Shop.findByIdAndUpdate(req.shopId, parsed.data, {
      new: true,
      runValidators: true,
    }).lean();
    res.json(shopOut(s));
  } catch (e) {
    next(e);
  }
});
api.post("/backup/restore", auth, writeLimit, async (req, res, next) => {
  try {
    const parsed = backupSchema.safeParse(req.body);
    if (!parsed.success) return error(res, 400, "Invalid backup data");
    const d = parsed.data;
    if (
      new Set(d.customers.map((x) => x.id)).size !== d.customers.length ||
      new Set(d.entries.map((x) => x.id)).size !== d.entries.length ||
      d.entries.some((x) => !d.customers.some((c) => c.id === x.customerId))
    )
      return error(
        res,
        400,
        "Backup contains duplicate or missing record references",
      );
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const shop = await Shop.findOne({
          _id: req.shopId,
          ownerId: req.user._id,
        }).session(session);
        if (!shop)
          throw Object.assign(new Error("Shop not found"), { status: 404 });
        if (
          d.shop.phone.replace(/\D/g, "").slice(-10) !==
          req.user.phone.replace(/\D/g, "").slice(-10)
        )
          throw Object.assign(
            new Error("Backup phone does not match this account"),
            { status: 403 },
          );
        await Promise.all([
          Customer.deleteMany({ shopId: req.shopId }, { session }),
          Entry.deleteMany({ shopId: req.shopId }, { session }),
          Audit.deleteMany({ shopId: req.shopId }, { session }),
          Notification.deleteMany({ shopId: req.shopId }, { session }),
          Idempotency.deleteMany({ shopId: req.shopId }, { session }),
        ]);
        shop.name = d.shop.name;
        shop.owner = d.shop.owner;
        shop.address = d.shop.address;
        shop.phone = req.user.phone;
        shop.whatsapp = d.shop.whatsapp;
        shop.language = d.language;
        shop.defaultMethod = d.defaultMethod;
        shop.reminders = d.reminders;
        shop.readAuditIds = d.read;
        await shop.save({ session });
        if (d.customers.length)
          await Customer.insertMany(
            d.customers.map((c) => ({
              shopId: req.shopId,
              clientId: c.id,
              name: c.name,
              nameFolded: c.name.toLocaleLowerCase("en"),
              phone: c.phone,
              address: c.address,
              openingPaise: paise(c.opening),
              limitPaise: paise(c.limit),
              reminder: c.reminder,
              ...(c.createdAt ? { createdAt: new Date(c.createdAt) } : {}),
            })),
            { session, ordered: true },
          );
        if (d.entries.length)
          await Entry.insertMany(
            d.entries.map((e) => ({
              shopId: req.shopId,
              clientId: e.id,
              customerClientId: e.customerId,
              type: e.type,
              amountPaise: paise(e.amount),
              date: e.date,
              note: e.note,
              method: e.method,
              due: e.due,
            })),
            { session, ordered: true },
          );
        if (d.audit.length)
          await Audit.insertMany(
            d.audit.map((a) => ({
              shopId: req.shopId,
              actorId: req.user._id,
              clientId: a.id,
              action: a.action,
              occurredAt: new Date(a.date),
              ...(a.before ? { before: a.before } : {}),
              ...(a.after ? { after: a.after } : {}),
            })),
            { session, ordered: true },
          );
      });
    } finally {
      await session.endSession();
    }
    res.status(204).end();
  } catch (e) {
    if (e.status) return error(res, e.status, e.message);
    next(e);
  }
});
api.get("/customers", auth, async (req, res, next) => {
  try {
    const query = z
      .string()
      .trim()
      .max(80)
      .safeParse(req.query.q || "");
    if (!query.success) return error(res, 400, "Search query is too long");
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 30),
    );
    const filter = { shopId: req.shopId, deletedAt: { $exists: false } };
    if (query.data)
      filter.nameFolded = {
        $regex: `^${query.data.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      };
    if (req.query.cursor) {
      const cursor = await Customer.findOne({
        shopId: req.shopId,
        clientId: req.query.cursor,
      })
        .select("_id nameFolded")
        .lean();
      if (cursor)
        filter.$or = [
          { nameFolded: { $gt: cursor.nameFolded } },
          { nameFolded: cursor.nameFolded, _id: { $gt: cursor._id } },
        ];
    }
    const rows = await Customer.find(filter)
      .sort({ nameFolded: 1, _id: 1 })
      .limit(limit + 1)
      .lean();
    const more = rows.length > limit;
    if (more) rows.pop();
    res.json({
      items: rows.map(customerOut),
      nextCursor: more ? rows.at(-1).clientId : null,
    });
  } catch (e) {
    next(e);
  }
});
api.post("/customers", auth, writeLimit, async (req, res, next) => {
  try {
    const { audit, ...input } = req.body || {};
    const parsed = customerSchema.safeParse(input);
    if (!parsed.success) return error(res, 400, "Invalid customer");
    const c = parsed.data;
    const session = await mongoose.startSession();
    let doc;
    try {
      await session.withTransaction(async () => {
        doc = await Customer.findOneAndUpdate(
          { shopId: req.shopId, clientId: c.id },
          {
            $set: {
              shopId: req.shopId,
              clientId: c.id,
              name: c.name,
              nameFolded: c.name.toLocaleLowerCase("en"),
              phone: c.phone,
              address: c.address,
              openingPaise: paise(c.opening),
              limitPaise: paise(c.limit),
              reminder: c.reminder,
            },
            $unset: { deletedAt: 1 },
          },
          { upsert: true, new: true, runValidators: true, session },
        );
        if (audit) await saveAudit({ ...req, session }, audit);
      });
    } finally {
      await session.endSession();
    }
    res.status(201).json(customerOut(doc));
  } catch (e) {
    next(e);
  }
});
api.patch("/customers/:id", auth, writeLimit, async (req, res, next) => {
  try {
    const { audit, ...input } = req.body || {};
    const parsed = customerSchema.safeParse(input);
    if (!parsed.success || parsed.data.id !== req.params.id)
      return error(res, 400, "Invalid customer");
    const c = parsed.data;
    const session = await mongoose.startSession();
    let doc;
    try {
      await session.withTransaction(async () => {
        doc = await Customer.findOneAndUpdate(
          { shopId: req.shopId, clientId: c.id, deletedAt: { $exists: false } },
          {
            name: c.name,
            nameFolded: c.name.toLocaleLowerCase("en"),
            phone: c.phone,
            address: c.address,
            openingPaise: paise(c.opening),
            limitPaise: paise(c.limit),
            reminder: c.reminder,
          },
          { new: true, runValidators: true, session },
        );
        if (!doc)
          throw Object.assign(new Error("Customer not found"), { status: 404 });
        if (audit) await saveAudit({ ...req, session }, audit);
      });
    } finally {
      await session.endSession();
    }
    res.json(customerOut(doc));
  } catch (e) {
    if (e.status === 404) return error(res, 404, e.message);
    next(e);
  }
});
api.delete("/customers/:id", auth, writeLimit, async (req, res, next) => {
  try {
    const c = await Customer.findOneAndUpdate(
      {
        shopId: req.shopId,
        clientId: req.params.id,
        deletedAt: { $exists: false },
      },
      { deletedAt: new Date() },
    );
    if (!c) return error(res, 404, "Customer not found");
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
api.get("/ledger", auth, async (req, res, next) => {
  try {
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 50),
    );
    const filter = { shopId: req.shopId, deletedAt: { $exists: false } };
    if (req.query.customerId)
      filter.customerClientId = String(req.query.customerId).slice(0, 80);
    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
      filter.date = {
        $gte: `${req.query.month}-01`,
        $lt: `${req.query.month}-32`,
      };
    }
    if (req.query.cursor) {
      const cursor = await Entry.findOne({
        shopId: req.shopId,
        clientId: req.query.cursor,
      })
        .select("_id date")
        .lean();
      if (cursor)
        filter.$or = [
          { date: { $lt: cursor.date } },
          { date: cursor.date, _id: { $lt: cursor._id } },
        ];
    }
    const rows = await Entry.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const more = rows.length > limit;
    if (more) rows.pop();
    res.json({
      items: rows.map(entryOut),
      nextCursor: more ? rows.at(-1).clientId : null,
    });
  } catch (e) {
    next(e);
  }
});
async function saveAudit(req, a) {
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
      { shopId: req.shopId, clientId: parsed.data.id },
      {
        $setOnInsert: {
          shopId: req.shopId,
          actorId: req.user._id,
          clientId: parsed.data.id,
          action: parsed.data.action,
          occurredAt: new Date(parsed.data.date),
          ...(parsed.data.before ? { before: parsed.data.before } : {}),
          ...(parsed.data.after ? { after: parsed.data.after } : {}),
        },
      },
      { upsert: true, ...(req.session ? { session: req.session } : {}) },
    );
}
api.post("/ledger", auth, writeLimit, async (req, res, next) => {
  try {
    const { audit, ...input } = req.body || {};
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) return error(res, 400, "Invalid transaction");
    const e = parsed.data;
    const c = await Customer.findOne({
      shopId: req.shopId,
      clientId: e.customerId,
      deletedAt: { $exists: false },
    }).lean();
    if (!c) return error(res, 404, "Customer not found");
    const key = req.get("Idempotency-Key");
    if (key) {
      if (key.length > 128) return error(res, 400, "Invalid idempotency key");
      const existing = await Idempotency.findOne({
        shopId: req.shopId,
        key,
      }).lean();
      if (existing) return res.status(200).json(existing.response);
    }
    const session = await mongoose.startSession();
    let response;
    try {
      await session.withTransaction(async () => {
        const doc = await Entry.findOneAndUpdate(
          { shopId: req.shopId, clientId: e.id },
          {
            $set: {
              shopId: req.shopId,
              clientId: e.id,
              customerClientId: e.customerId,
              type: e.type,
              amountPaise: paise(e.amount),
              date: e.date,
              note: e.note,
              method: e.method,
              due: e.due,
            },
            $unset: { deletedAt: 1 },
          },
          { upsert: true, new: true, runValidators: true, session },
        );
        if (audit) await saveAudit({ ...req, session }, audit);
        response = entryOut(doc);
        if (key)
          await Idempotency.create([{ shopId: req.shopId, key, response }], {
            session,
          });
      });
    } finally {
      await session.endSession();
    }
    res.status(201).json(response);
  } catch (e) {
    if (e.code === 11000 && req.get("Idempotency-Key")) {
      const found = await Idempotency.findOne({
        shopId: req.shopId,
        key: req.get("Idempotency-Key"),
      }).lean();
      if (found) return res.json(found.response);
    }
    next(e);
  }
});
api.delete("/ledger/:id", auth, writeLimit, async (req, res, next) => {
  try {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const e = await Entry.findOneAndUpdate(
          {
            shopId: req.shopId,
            clientId: req.params.id,
            deletedAt: { $exists: false },
          },
          { deletedAt: new Date() },
          { session },
        );
        if (!e)
          throw Object.assign(new Error("Transaction not found"), {
            status: 404,
          });
        if (req.body?.audit)
          await saveAudit({ ...req, session }, req.body.audit);
      });
    } finally {
      await session.endSession();
    }
    res.status(204).end();
  } catch (e) {
    if (e.status === 404) return error(res, 404, e.message);
    next(e);
  }
});
api.patch("/ledger/:id", auth, writeLimit, async (req, res, next) => {
  try {
    const { audit, ...input } = req.body || {};
    const parsed = entrySchema.safeParse({ ...input, id: req.params.id });
    if (!parsed.success) return error(res, 400, "Invalid transaction");
    const e = parsed.data;
    const c = await Customer.findOne({
      shopId: req.shopId,
      clientId: e.customerId,
      deletedAt: { $exists: false },
    }).lean();
    if (!c) return error(res, 404, "Customer not found");
    const session = await mongoose.startSession();
    let response;
    try {
      await session.withTransaction(async () => {
        const doc = await Entry.findOneAndUpdate(
          { shopId: req.shopId, clientId: e.id, deletedAt: { $exists: false } },
          {
            customerClientId: e.customerId,
            type: e.type,
            amountPaise: paise(e.amount),
            date: e.date,
            note: e.note,
            method: e.method,
            due: e.due,
          },
          { new: true, runValidators: true, session },
        );
        if (!doc)
          throw Object.assign(new Error("Transaction not found"), {
            status: 404,
          });
        if (audit) await saveAudit({ ...req, session }, audit);
        response = entryOut(doc);
      });
    } finally {
      await session.endSession();
    }
    res.json(response);
  } catch (e) {
    if (e.status === 404) return error(res, 404, e.message);
    next(e);
  }
});
api.get("/notifications", auth, async (req, res, next) => {
  try {
    const rows = await Notification.find({ shopId: req.shopId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean();
    res.json({
      items: rows.map((n) => ({
        id: String(n._id),
        title: n.title,
        body: n.body,
        read: n.read,
        date: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    next(e);
  }
});
api.patch("/notifications/read", auth, writeLimit, async (req, res, next) => {
  try {
    const ids = z.array(z.string().max(40)).max(100).safeParse(req.body?.ids);
    if (!ids.success) return error(res, 400, "Invalid notification IDs");
    await Notification.updateMany(
      {
        shopId: req.shopId,
        ...(ids.data.length ? { _id: { $in: ids.data } } : {}),
      },
      { $set: { read: true } },
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
api.patch("/activity/read", auth, writeLimit, async (req, res, next) => {
  try {
    const ids = z.array(idSchema).max(100).safeParse(req.body?.ids);
    if (!ids.success) return error(res, 400, "Invalid activity IDs");
    await Shop.updateOne(
      { _id: req.shopId },
      { $addToSet: { readAuditIds: { $each: ids.data } } },
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
api.post("/devices/push-token", auth, writeLimit, async (req, res, next) => {
  try {
    const v = z
      .object({
        token: z.string().regex(/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/),
        platform: z.enum(["android", "ios", "web"]),
      })
      .safeParse(req.body);
    if (!v.success) return error(res, 400, "Invalid push token");
    await Device.updateOne(
      { shopId: req.shopId, token: v.data.token },
      { $set: { platform: v.data.platform, updatedAt: new Date() } },
      { upsert: true },
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
api.post("/messages/whatsapp", auth, writeLimit, async (req, res, next) => {
  try {
    const v = z
      .object({
        customerId: idSchema,
        parameters: z.array(z.string().max(1000)).max(10),
      })
      .safeParse(req.body);
    if (!v.success) return error(res, 400, "Invalid message request");
    if (
      !env.WHATSAPP_TEMPLATE_NAME ||
      !env.WHATSAPP_PHONE_NUMBER_ID ||
      !env.WHATSAPP_ACCESS_TOKEN
    )
      return error(res, 503, "WhatsApp messaging is not configured");
    const customer = await Customer.findOne({
      shopId: req.shopId,
      clientId: v.data.customerId,
      deletedAt: { $exists: false },
    }).lean();
    if (!customer) return error(res, 404, "Customer not found");
    if (!customer.reminder)
      return error(res, 403, "Customer has opted out of reminders");
    const number = customer.phone.replace(/\D/g, "");
    if (number.length < 10)
      return error(res, 400, "Customer phone number is missing");
    await sendWhatsApp(
      number.startsWith("91") ? `+${number}` : `+91${number}`,
      env.WHATSAPP_TEMPLATE_NAME,
      v.data.parameters,
    );
    res.status(202).json({ accepted: true });
  } catch (e) {
    next(e);
  }
});
api.post("/messages/sms", auth, writeLimit, async (req, res, next) => {
  try {
    const v = z.object({ customerId: idSchema }).safeParse(req.body);
    if (!v.success) return error(res, 400, "Invalid message request");
    const customer = await Customer.findOne({
      shopId: req.shopId,
      clientId: v.data.customerId,
      deletedAt: { $exists: false },
    }).lean();
    if (!customer) return error(res, 404, "Customer not found");
    if (!customer.reminder)
      return error(res, 403, "Customer has opted out of reminders");
    if (!isSmsConfigured())
      return error(res, 503, "SMS messaging is not configured");
    const phone = customer.phone.replace(/\D/g, "");
    if (phone.length < 10)
      return error(res, 400, "Customer phone number is missing");
    const shop = await Shop.findById(req.shopId).select("name").lean();
    const [{ total = 0 } = {}] = await Entry.aggregate([
      {
        $match: {
          shopId: new mongoose.Types.ObjectId(req.shopId),
          customerClientId: customer.clientId,
          deletedAt: { $exists: false },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [
                { $eq: ["$type", "credit"] },
                "$amountPaise",
                { $multiply: ["$amountPaise", -1] },
              ],
            },
          },
        },
      },
    ]);
    const due = Math.max(0, (customer.openingPaise || 0) + total) / 100;
    await sendSms(
      phone.length === 10 ? `+91${phone}` : `+${phone}`,
      { customer: customer.name, shop: shop.name, amount: due },
    );
    res.status(202).json({ accepted: true });
  } catch (e) {
    next(e);
  }
});
api.post("/account/delete", auth, async (req, res, next) => {
  try {
    const confirm = z.literal("DELETE").safeParse(req.body?.confirm);
    if (!confirm.success) return error(res, 400, "Confirmation required");
    await mongoose.connection.transaction(async (session) => {
      await Promise.all([
        Session.deleteMany({ userId: req.user._id }, { session }),
        Customer.deleteMany({ shopId: req.shopId }, { session }),
        Entry.deleteMany({ shopId: req.shopId }, { session }),
        Audit.deleteMany({ shopId: req.shopId }, { session }),
        Notification.deleteMany({ shopId: req.shopId }, { session }),
        Device.deleteMany({ shopId: req.shopId }, { session }),
        Shop.deleteOne({ _id: req.shopId }, { session }),
        User.deleteOne({ _id: req.user._id }, { session }),
      ]);
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

api.use((req, res) => error(res, 404, "API route not found"));
app.use((err, req, res, next) => {
  req.log?.error({ err }, "request failed");
  if (res.headersSent) return next(err);
  if (err?.name === "ValidationError" || err?.name === "ZodError")
    return error(res, 400, "Invalid request");
  if (err?.code === 11000) return error(res, 409, "Record already exists");
  if (err?.message === "Origin not allowed")
    return error(res, 403, "Origin not allowed");
  if (env.NODE_ENV === "production")
    return error(res, 500, "Request could not be completed");
  return error(res, 500, err.message || "Request could not be completed");
});

await mongoose.connect(env.MONGODB_URI, {
  autoIndex: false,
  maxPoolSize: Number(env.MONGO_POOL_SIZE) || 20,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
});
if (process.argv.includes("--indexes")) {
  await ensureIndexes();
  log.info("MongoDB indexes ensured");
  await mongoose.disconnect();
  process.exit(0);
}
if (env.NODE_ENV !== "production" && env.DEV_OTP_ENABLED !== "true")
  log.warn("Development OTP disabled; configure Twilio Verify");
const port = Number(env.PORT) || 4000;
const server = app.listen(port, "0.0.0.0", () =>
  log.info({ port }, "Digital Khata API listening"),
);
startReminderWorker(log);
async function shutdown(signal) {
  log.info({ signal }, "shutting down");
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
