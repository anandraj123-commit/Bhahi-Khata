import mongoose from "mongoose";
const { Schema } = mongoose;
export const AdminNotification = mongoose.model(
  "AdminNotification",
  new Schema(
    {
      appMode: { type: String, required: true },
      title: { type: String, required: true },
      shortDescription: { type: Schema.Types.Mixed, required: true },
      description: { type: Schema.Types.Mixed, required: true },
      mediaIds: [Schema.Types.ObjectId],
      preview: { type: String, required: true },
      recipientType: {
        type: String,
        enum: ["all", "selected"],
        required: true,
      },
      shopIds: [Schema.Types.ObjectId],
      displayOn: { type: Date, required: true },
      status: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: { type: Schema.Types.ObjectId, required: true },
      updatedBy: Schema.Types.ObjectId,
      revision: { type: Number, default: 1 },
      state: {
        type: String,
        enum: ["scheduled", "processing", "published", "failed"],
        default: "scheduled",
      },
      publishedAt: Date,
      completedAt: Date,
      audienceCutoff: Date,
      cursor: Schema.Types.ObjectId,
      leaseToken: String,
      leaseUntil: Date,
      nextAttemptAt: Date,
      attempts: { type: Number, default: 0 },
      lastError: String,
      publishedCount: { type: Number, default: 0 },
    },
    {
      timestamps: true,
      versionKey: false,
      autoIndex: false,
      autoCreate: false,
    },
  ),
);
AdminNotification.schema.index({
  appMode: 1,
  status: 1,
  state: 1,
  displayOn: 1,
});
AdminNotification.schema.index({ appMode: 1, createdAt: -1, _id: -1 });

AdminNotification.schema.index({ appMode: 1, status: 1, displayOn: -1, _id: -1 });
