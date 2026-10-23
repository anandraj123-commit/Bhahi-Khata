import mongoose from "mongoose";
const { Schema } = mongoose;
const options = {
  timestamps: true,
  versionKey: false,
  autoIndex: false,
  autoCreate: false,
};
function model(name, fields, indexes = []) {
  const schema = new Schema(fields, options);
  for (const [keys, opts] of indexes) schema.index(keys, opts);
  return mongoose.models[name] || mongoose.model(name, schema);
}
export const AdminUser = model(
  "AdminUser",
  {
    email: { type: String, required: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["SUPER_ADMIN", "ADMIN", "SUPPORT"],
      required: true,
    },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
    sessionVersion: { type: Number, default: 0 },
  },
  [
    [{ email: 1 }, { unique: true }],
    [{ role: 1, active: 1 }, {}],
  ],
);
export const AdminSession = model(
  "AdminSession",
  {
    tokenHash: { type: String, required: true },
    adminId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    reauthenticatedAt: Date,
  },
  [
    [{ tokenHash: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
    [{ adminId: 1 }, {}],
  ],
);
export const AdminPasswordReset = model(
  "AdminPasswordReset",
  {
    tokenHash: { type: String, required: true },
    adminId: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
  },
  [
    [{ tokenHash: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
    [{ adminId: 1 }, {}],
  ],
);
export const AdminAudit = model(
  "AdminAudit",
  {
    adminId: Schema.Types.ObjectId,
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    result: { type: String, enum: ["success", "failure"], required: true },
    correlationId: String,
    metadata: { type: Map, of: String },
  },
  [
    [{ createdAt: -1, _id: -1 }, {}],
    [{ adminId: 1, createdAt: -1 }, {}],
  ],
);
export const AdminControl = model("AdminControl", {
  _id: String,
  revision: { type: Number, default: 0 },
});
export const AdminAttempt = model(
  "AdminAttempt",
  { _id: String, count: Number, expiresAt: Date },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
);
export const adminModels = [
  AdminUser,
  AdminSession,
  AdminPasswordReset,
  AdminAudit,
  AdminControl,
  AdminAttempt,
];
