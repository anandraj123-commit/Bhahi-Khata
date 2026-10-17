import mongoose from "mongoose";

const { Schema } = mongoose;
const base = { timestamps: true, versionKey: false, autoIndex: false };
export const User = mongoose.model(
  "User",
  new Schema(
    {
      phone: { type: String, required: true, unique: true, index: true },
      // An account is created after OTP verification; shop registration is a
      // separate explicit operation, so incomplete accounts have no shopId.
      shopId: { type: Schema.Types.ObjectId, index: true },
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
      phone: { type: String, required: true, unique: true, index: true },
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
      serverVersion: { type: Number, required: true, default: 1, min: 1 },
      resolutionVersion: { type: Number, required: true, default: 1, min: 1 },
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
      serverVersion: { type: Number, required: true, default: 1, min: 1 },
      resolutionVersion: { type: Number, required: true, default: 1, min: 1 },
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
      resolutionVersion: { type: Number, required: true, default: 1, min: 1 },
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
      resolutionId: String,
      requestHash: String,
      resolutionResponse: Schema.Types.Mixed,
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
      previousResolutionVersion: { type: Number, default: 1 },
      resultingResolutionVersion: { type: Number, default: 1 },
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

// Subscription prices and entitlements are server-owned. Money is stored in
// minor currency units (paise for INR) so payment amounts never use floats.
export const SubscriptionPlan = mongoose.model(
  "SubscriptionPlan",
  new Schema(
    {
      code: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      description: { type: String, default: "" },
      monthlyPriceMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
      currency: { type: String, required: true, default: "INR" },
      customerLimit: { type: Number, min: 0, default: null, validate: { validator: (value) => value == null || Number.isSafeInteger(value) } },
      unlimitedCustomers: { type: Boolean, default: false },
      entitlements: { type: Schema.Types.Mixed, default: {} },
      enabled: { type: Boolean, default: true },
      displayOrder: { type: Number, default: 0 },
      durations: {
        type: [
          new Schema(
            {
              months: { type: Number, required: true, validate: Number.isSafeInteger },
              discountPercent: { type: Number, required: true, min: 0, max: 100, validate: Number.isInteger },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      configurationVersion: { type: Number, default: 1 },
    },
    base,
  ),
);
SubscriptionPlan.schema.index({ enabled: 1, displayOrder: 1 });

export const ShopSubscription = mongoose.model(
  "ShopSubscription",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      planId: { type: Schema.Types.ObjectId, required: true },
      planCode: { type: String, required: true },
      planSnapshot: { type: Schema.Types.Mixed, required: true },
      status: { type: String, enum: ["active", "scheduled", "expired", "cancelled"], required: true },
      startsAt: { type: Date, required: true },
      expiresAt: Date,
      durationMonths: { type: Number, default: 0 },
      amountPaidMinor: { type: Number, min: 0 },
      sourcePaymentId: { type: Schema.Types.ObjectId },
      scheduledStartAt: Date,
      renewalOf: { type: Schema.Types.ObjectId },
      activatedAt: Date,
    },
    base,
  ),
);
ShopSubscription.schema.index({ shopId: 1, startsAt: -1, _id: -1 });
ShopSubscription.schema.index({ shopId: 1, status: 1, startsAt: 1, expiresAt: 1 });
ShopSubscription.schema.index({ sourcePaymentId: 1 }, { unique: true, sparse: true });

export const PaymentOrder = mongoose.model(
  "PaymentOrder",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      userId: { type: Schema.Types.ObjectId, required: true },
      appMode: { type: String, required: true },
      planId: { type: Schema.Types.ObjectId, required: true },
      planCode: { type: String, required: true },
      durationMonths: { type: Number, required: true },
      amountMinor: { type: Number, required: true, min: 0 },
      currency: { type: String, required: true },
      pricingSnapshot: { type: Schema.Types.Mixed, required: true },
      gatewayOrderId: String,
      idempotencyKey: { type: String, required: true },
      requestHash: { type: String, required: true },
      status: { type: String, enum: ["created", "pending", "paid", "failed", "refunded", "partially_refunded"], default: "created" },
      scheduledStartAt: Date,
      checkoutActive: { type: Boolean, default: false },
      checkoutExpiresAt: Date,
      verifiedAt: Date,
    },
    base,
  ),
);
PaymentOrder.schema.index({ shopId: 1, idempotencyKey: 1 }, { unique: true });
PaymentOrder.schema.index(
  { shopId: 1, checkoutActive: 1 },
  { unique: true, partialFilterExpression: { checkoutActive: true } },
);
PaymentOrder.schema.index({ shopId: 1, createdAt: -1, _id: -1 });
PaymentOrder.schema.index({ gatewayOrderId: 1 }, { unique: true, sparse: true });

export const PaymentTransaction = mongoose.model(
  "PaymentTransaction",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      orderId: { type: Schema.Types.ObjectId, required: true },
      provider: { type: String, enum: ["razorpay"], required: true },
      gatewayPaymentId: { type: String, required: true },
      gatewayOrderId: { type: String, required: true },
      amountMinor: { type: Number, required: true },
      currency: { type: String, required: true },
      method: String,
      status: { type: String, enum: ["captured", "failed", "refunded", "partially_refunded", "pending"], required: true },
      verificationStatus: { type: String, enum: ["verified", "unverified"], required: true },
      refundedAmountMinor: { type: Number, min: 0, default: 0 },
      refundReferences: { type: [String], default: [] },
      gatewayCreatedAt: Date,
      verifiedAt: Date,
    },
    base,
  ),
);
PaymentTransaction.schema.index({ gatewayPaymentId: 1 }, { unique: true });
PaymentTransaction.schema.index({ shopId: 1, createdAt: -1, _id: -1 });

export const SubscriptionAuditLog = mongoose.model(
  "SubscriptionAuditLog",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      previousPlan: Schema.Types.Mixed,
      newPlan: Schema.Types.Mixed,
      eventType: { type: String, required: true },
      referenceId: String,
      actorType: { type: String, enum: ["shopkeeper", "system", "gateway"], required: true },
      actorId: Schema.Types.ObjectId,
      occurredAt: { type: Date, required: true },
      metadata: Schema.Types.Mixed,
    },
    { ...base, immutable: true },
  ),
);
SubscriptionAuditLog.schema.index({ shopId: 1, occurredAt: -1, _id: -1 });
SubscriptionAuditLog.schema.index({ referenceId: 1, eventType: 1 }, { unique: true, sparse: true });

export const SubscriptionNotificationLog = mongoose.model(
  "SubscriptionNotificationLog",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      userId: Schema.Types.ObjectId,
      subscriptionId: Schema.Types.ObjectId,
      notificationType: { type: String, required: true },
      scheduledAt: Date,
      status: { type: String, enum: ["scheduled", "sent", "failed", "delivered"], default: "scheduled" },
      deduplicationKey: { type: String, required: true },
      sentAt: Date,
    },
    base,
  ),
);
SubscriptionNotificationLog.schema.index({ shopId: 1, deduplicationKey: 1 }, { unique: true });

export const SubscriptionNotificationPreference = mongoose.model(
  "SubscriptionNotificationPreference",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true },
      userId: Schema.Types.ObjectId,
      deviceId: String,
      expiryReminders: { type: Boolean, default: true },
      paymentUpdates: { type: Boolean, default: true },
    },
    base,
  ),
);
SubscriptionNotificationPreference.schema.index(
  { shopId: 1, deviceId: 1 },
  { unique: true, partialFilterExpression: { deviceId: { $type: "string" } } },
);

export const PaymentWebhookEvent = mongoose.model(
  "PaymentWebhookEvent",
  new Schema(
    {
      eventId: { type: String, required: true, unique: true },
      eventType: { type: String, required: true },
      processedAt: Date,
      status: { type: String, enum: ["received", "processed", "failed"], default: "received" },
    },
    base,
  ),
);

export const SubscriptionUsage = mongoose.model(
  "SubscriptionUsage",
  new Schema(
    {
      shopId: { type: Schema.Types.ObjectId, required: true, unique: true },
      activeCustomers: { type: Number, required: true, min: 0, default: 0 },
    },
    base,
  ),
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
    SubscriptionPlan,
    ShopSubscription,
    PaymentOrder,
    PaymentTransaction,
    SubscriptionAuditLog,
    SubscriptionNotificationLog,
    SubscriptionNotificationPreference,
    PaymentWebhookEvent,
    SubscriptionUsage,
  ])
    await model.createIndexes();
}
