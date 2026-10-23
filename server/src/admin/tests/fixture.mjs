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
    ShopSubscription,
    SubscriptionPlan,
    PaymentOrder,
    PaymentTransaction,
  } = await import("../../models.js");
  const { hashPassword } = await import("../utils/security.js");
  for (const model of [
    ...adminModels,
    User,
    Shop,
    ShopSubscription,
    SubscriptionPlan,
    PaymentOrder,
    PaymentTransaction,
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
    shops,
  };
}
