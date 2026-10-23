import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
export function configureTestEnvironment() {
  const uri =
    process.env.ADMIN_TEST_MONGO_URI ||
    "mongodb://127.0.0.1:27028/?replicaSet=dkAdminTest";
  if (!/^mongodb:\/\/127\.0\.0\.1:27028\//.test(uri))
    throw new Error(
      "Admin tests require the isolated localhost:27028 database",
    );
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_MODE: "testing",
    MONGODB_URI: uri,
    MONGODB_DB_NAME: "digital_khata_testing",
    JWT_SECRET: randomBytes(32).toString("hex"),
    ADMIN_PROXY_SECRET:
      process.env.ADMIN_TEST_PROXY_SECRET || randomBytes(32).toString("hex"),
    ADMIN_TRUSTED_ORIGINS: "http://127.0.0.1:3100",
    TRUST_PROXY: "false",
    RAZORPAY_CHECKOUT_ENABLED: "false",
  });
}
export async function fixture() {
  if (
    mongoose.connection.name !== "digital_khata_testing" ||
    mongoose.connection.port !== 27028
  )
    throw new Error("Wrong test database");
  const { adminModels, AdminUser, AdminControl } =
    await import("../models/index.js");
  const {
    User,
    Shop,
    Customer,
    ShopSubscription,
    SubscriptionPlan,
    PaymentOrder,
    PaymentTransaction,
    SubscriptionUsage,
  } = await import("../../models.js");
  const { hashPassword } = await import("../utils/security.js");
  for (const model of [
    ...adminModels,
    User,
    Shop,
    Customer,
    ShopSubscription,
    SubscriptionPlan,
    PaymentOrder,
    PaymentTransaction,
    SubscriptionUsage,
  ]) {
    await model.createCollection();
    await model.createIndexes();
  }
  await AdminControl.updateOne(
    { _id: "administrators" },
    { $setOnInsert: { revision: 0 } },
    { upsert: true },
  );
  const run = randomBytes(5).toString("hex");
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  const [superAdmin, support, admin] = await AdminUser.create([
    {
      email: `super-${run}@example.test`,
      name: "Test Super Admin",
      role: "SUPER_ADMIN",
      passwordHash: hash,
      active: true,
    },
    {
      email: `support-${run}@example.test`,
      name: "Test Support",
      role: "SUPPORT",
      passwordHash: hash,
      active: true,
    },
    {
      email: `admin-${run}@example.test`,
      name: "Test Admin",
      role: "ADMIN",
      passwordHash: hash,
      active: true,
    },
  ]);
  const plan = await SubscriptionPlan.create({
    code: `test-${run}`,
    name: "Integration plan",
    monthlyPriceMinor: 10000,
    currency: "INR",
    customerLimit: 50,
    enabled: true,
  });
  const configuredDurations = (monthlyPriceMinor) => [1, 3, 6, 12].map((months) => ({
    months,
    basePriceMinor: monthlyPriceMinor * months,
    discountPercent: 0,
    taxPercent: 0,
    isActive: true,
  }));
  for (const record of [
    { code: "free", name: "Free", description: "Free fallback", monthlyPriceMinor: 0, currency: "INR", customerLimit: 50, unlimitedCustomers: false, enabled: true, displayOrder: 0, features: [], entitlements: {}, durations: [] },
    { code: "pro", name: "Pro", description: "Pro plan", monthlyPriceMinor: 19900, currency: "INR", customerLimit: 500, unlimitedCustomers: false, enabled: true, displayOrder: 1, features: [], entitlements: {}, durations: configuredDurations(19900) },
    { code: "business", name: "Business", description: "Business plan", monthlyPriceMinor: 49900, currency: "INR", customerLimit: null, unlimitedCustomers: true, enabled: true, displayOrder: 2, features: [], entitlements: {}, durations: configuredDurations(49900) },
  ])
    await SubscriptionPlan.updateOne({ code: record.code }, { $set: record }, { upsert: true });
  const standardPlans = await SubscriptionPlan.find({ code: { $in: ["free", "pro", "business"] } }).sort({ displayOrder: 1 }).lean();
  const shops = [];
  for (let i = 0; i < 25; i++) {
    const user = await User.create({ phone: `+910${run}${i}` });
    const shop = await Shop.create({
      ownerId: user._id,
      name: `Admin Test ${run} ${String(i).padStart(2, "0")}`,
      owner: "Synthetic owner",
      phone: user.phone,
    });
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          shopId: shop._id,
          ...(i === 0 ? { disabledAt: new Date() } : {}),
        },
      },
    );
    shops.push(shop);
  }
  const now = Date.now();
  const lifecycleCustomers = await Customer.create([
    { shopId: shops[0]._id, clientId: `active-${run}`, name: `Customer Active ${run}`, nameFolded: `customer active ${run}`, status: true, disabled: false, removed: false },
    { shopId: shops[0]._id, clientId: `disabled-${run}`, name: `Customer Disabled ${run}`, nameFolded: `customer disabled ${run}`, status: false, disabled: true, removed: false },
    { shopId: shops[0]._id, clientId: `removed-${run}`, name: `Customer Removed ${run}`, nameFolded: `customer removed ${run}`, status: false, disabled: false, removed: true },
  ]);
  const legacyCustomer = new mongoose.Types.ObjectId();
  await Customer.collection.insertOne({
    _id: legacyCustomer,
    shopId: shops[0]._id,
    clientId: `legacy-${run}`,
    name: `Customer Legacy ${run}`,
    nameFolded: `customer legacy ${run}`,
    createdAt: new Date(now - 1000),
    updatedAt: new Date(now - 1000),
  });
  await Customer.collection.insertOne({
    shopId: shops[0]._id,
    clientId: `tombstone-${run}`,
    name: `Customer Tombstone ${run}`,
    nameFolded: `customer tombstone ${run}`,
    status: true,
    disabled: false,
    removed: false,
    deletedAt: new Date(),
  });
  await Customer.collection.insertOne({
    shopId: new mongoose.Types.ObjectId(),
    clientId: `orphan-${run}`,
    name: `Customer Orphan ${run}`,
    nameFolded: `customer orphan ${run}`,
    status: true,
    disabled: false,
    removed: false,
  });
  await ShopSubscription.create([
    {
      shopId: shops[0]._id,
      planId: plan._id,
      planCode: plan.code,
      planSnapshot: {},
      status: "active",
      startsAt: new Date(now - 86400000),
      expiresAt: new Date(now + 10 * 86400000),
    },
    {
      shopId: shops[1]._id,
      planId: plan._id,
      planCode: plan.code,
      planSnapshot: {},
      status: "active",
      startsAt: new Date(now - 10 * 86400000),
      expiresAt: new Date(now - 86400000),
    },
    {
      shopId: shops[2]._id,
      planId: plan._id,
      planCode: plan.code,
      planSnapshot: {},
      status: "scheduled",
      startsAt: new Date(now + 86400000),
      expiresAt: new Date(now + 30 * 86400000),
    },
  ]);
  const order = await PaymentOrder.create({
    shopId: shops[0]._id,
    userId: shops[0].ownerId,
    appMode: "testing",
    planId: plan._id,
    planCode: plan.code,
    durationMonths: 1,
    amountMinor: 10000,
    currency: "INR",
    pricingSnapshot: {},
    idempotencyKey: run,
    requestHash: run,
  });
  await PaymentTransaction.create([
    {
      shopId: shops[0]._id,
      orderId: order._id,
      provider: "razorpay",
      gatewayPaymentId: `pay_${run}`,
      gatewayOrderId: `order_${run}`,
      amountMinor: 10000,
      currency: "INR",
      status: "partially_refunded",
      verificationStatus: "verified",
      refundedAmountMinor: 1000,
      verifiedAt: new Date(),
    },
    {
      shopId: shops[0]._id,
      orderId: order._id,
      provider: "razorpay",
      gatewayPaymentId: `pending_${run}`,
      gatewayOrderId: `order_${run}`,
      amountMinor: 999999,
      currency: "INR",
      status: "pending",
      verificationStatus: "unverified",
    },
  ]);
  return {
    run,
    password,
    superAdmin,
    support,
    admin,
    plan,
    standardPlans,
    shops,
    customers: [...lifecycleCustomers, { _id: legacyCustomer }],
  };
}
