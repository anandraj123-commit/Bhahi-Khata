import mongoose from "mongoose";

const { Schema } = mongoose;
const base = { timestamps: true, versionKey: false, autoIndex: false };
export const User = mongoose.model(
  "User",
  new Schema(
    {
      phone: { type: String, required: true, unique: true, index: true },
      shopId: { type: Schema.Types.ObjectId, required: true, index: true },
      disabledAt: Date,
      sessionVersion: { type: Number, default: 0 },
    },
    base,
  ),
);
export const Shop = mongoose.model(
  "Shop",
  new Schema(
    {
      ownerId: { type: Schema.Types.ObjectId, required: true, unique: true },
      name: { type: String, default: "", maxlength: 120 },
      owner: { type: String, default: "", maxlength: 120 },
      address: { type: String, default: "", maxlength: 500 },
      phone: { type: String, required: true },
      whatsapp: { type: String, default: "" },
      language: { type: String, default: "English" },
      defaultMethod: { type: String, default: "Cash" },
      readAuditIds: { type: [String], default: [] },
      reminders: {
        enabled: { type: Boolean, default: true },
        day: { type: String, default: "Last day" },
        time: { type: String, default: "10:00" },
        minimum: { type: String, default: "100" },
        whatsapp: { type: Boolean, default: true },
        sms: { type: Boolean, default: false },
      },
    },
    base,
  ),
);
export const Customer = mongoose.model(
  "Customer",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      clientId: { type: String, required: true },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      nameFolded: { type: String, required: true },
      phone: { type: String, default: "", maxlength: 20 },
      address: { type: String, default: "", maxlength: 500 },
      openingPaise: { type: Number, min: 0, max: 100000000000 },
      limitPaise: { type: Number, min: 0, max: 100000000000 },
      reminder: { type: Boolean, default: true },
      deletedAt: Date,
    },
    base,
  ),
);
Customer.schema.index({ shopId: 1, clientId: 1 }, { unique: true });
Customer.schema.index({ shopId: 1, nameFolded: 1, _id: 1 });
Customer.schema.index({ shopId: 1, phone: 1 });
export const Entry = mongoose.model(
  "LedgerEntry",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      clientId: { type: String, required: true },
      customerClientId: { type: String, required: true },
      type: { type: String, enum: ["credit", "payment"], required: true },
      amountPaise: { type: Number, required: true, min: 1, max: 100000000000 },
      date: { type: String, required: true },
      note: { type: String, default: "", maxlength: 1000 },
      method: { type: String, default: "Cash", maxlength: 50 },
      due: { type: String, default: "" },
      serverVersion: { type: Number, required: true, default: 1, min: 1 },
      deletedAt: Date,
    },
    base,
  ),
);
Entry.schema.index({ shopId: 1, clientId: 1 }, { unique: true });
Entry.schema.index({ shopId: 1, customerClientId: 1, date: -1, _id: -1 });
Entry.schema.index({ shopId: 1, date: -1, _id: -1 });
export const Audit = mongoose.model(
  "AuditEvent",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      actorId: Schema.Types.ObjectId,
      clientId: { type: String, required: true },
      action: { type: String, required: true, maxlength: 250 },
      before: Schema.Types.Mixed,
      after: Schema.Types.Mixed,
      occurredAt: { type: Date, required: true },
    },
    { ...base, immutable: true },
  ),
);
Audit.schema.index({ shopId: 1, occurredAt: -1, _id: -1 });
Audit.schema.index({ shopId: 1, clientId: 1 }, { unique: true });
export const FinancialResolution = mongoose.model(
  "FinancialResolution",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      transactionId: { type: String, required: true },
      customerName: { type: String, default: "", maxlength: 120 },
      resolutionId: { type: String, required: true },
      conflictId: { type: String },
      requestHash: { type: String, required: true },
      actorId: { type: Schema.Types.ObjectId, required: true },
      previous: { type: Schema.Types.Mixed, required: true },
      proposed: { type: Schema.Types.Mixed, required: true },
      selected: Schema.Types.Mixed,
      previousVersion: { type: Number, required: true },
      resultingVersion: { type: Number, required: true },
      localAt: Date,
      action: { type: String, enum: ["keep_local", "keep_server"], required: true },
      status: { type: String, enum: ["resolved"], required: true },
      serverAt: { type: Date, required: true },
    },
    base,
  ),
);
FinancialResolution.schema.index({ shopId: 1, resolutionId: 1 }, { unique: true });
FinancialResolution.schema.index(
  { shopId: 1, conflictId: 1 },
  {
    unique: true,
    partialFilterExpression: { conflictId: { $type: "string" } },
  },
);
FinancialResolution.schema.index({ shopId: 1, serverAt: -1, _id: -1 });
export const Notification = mongoose.model(
  "Notification",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      clientId: String,
      title: String,
      body: String,
      read: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now },
    },
    base,
  ),
);
Notification.schema.index({ shopId: 1, createdAt: -1, _id: -1 });
export const Device = mongoose.model(
  "Device",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      token: { type: String, required: true },
      platform: String,
      updatedAt: { type: Date, default: Date.now },
    },
    base,
  ),
);
Device.schema.index({ shopId: 1, token: 1 }, { unique: true });
export const Session = mongoose.model(
  "Session",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, required: true },
      tokenHash: { type: String, required: true, unique: true },
      expiresAt: { type: Date, required: true },
      createdAt: { type: Date, default: Date.now },
    },
    base,
  ),
);
Session.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Idempotency = mongoose.model(
  "IdempotencyKey",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      key: { type: String, required: true },
      requestHash: { type: String },
      response: Schema.Types.Mixed,
      createdAt: { type: Date, default: Date.now, expires: 86400 },
    },
    base,
  ),
);
Idempotency.schema.index({ shopId: 1, key: 1 }, { unique: true });
export const ReminderDelivery = mongoose.model(
  "ReminderDelivery",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      customerId: { type: Schema.Types.ObjectId, required: true },
      month: { type: String, required: true },
      channel: { type: String, required: true },
      status: { type: String, enum: ["pending", "sent"], default: "pending" },
      sentAt: { type: Date, default: Date.now },
    },
    base,
  ),
);
ReminderDelivery.schema.index(
  { shopId: 1, customerId: 1, month: 1, channel: 1 },
  { unique: true },
);

export async function ensureIndexes() {
  for (const model of [
    User,
    Shop,
    Customer,
    Entry,
    Audit,
    FinancialResolution,
    Notification,
    Device,
    Session,
    Idempotency,
    ReminderDelivery,
  ])
    await model.createIndexes();
}
