import mongoose from "mongoose";
import sharp from "sharp";
import { fail } from "../admin/utils/security.js";
export const NotificationMedia = mongoose.model(
  "NotificationMedia",
  new mongoose.Schema(
    {
      appMode: { type: String, required: true },
      filename: { type: String, maxlength: 120 },
      createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
      contentType: { type: String, required: true },
      bytes: { type: Buffer, required: true, select: false },
      width: { type: Number, required: true },
      height: { type: Number, required: true },
      size: { type: Number, required: true },
    },
    {
      collection: "notificationmedia",
      timestamps: true,
      autoCreate: false,
      autoIndex: false,
      versionKey: false,
    },
  ),
);
export function mediaIds(node) {
  return [
    ...new Set(
      (function collect(n) {
        return [
          ...(n?.type === "image" && n.attrs?.mediaId ? [n.attrs.mediaId] : []),
          ...(n?.content || []).flatMap(collect),
        ];
      })(node),
    ),
  ];
}
export async function validateMediaContent(doc, session) {
  const ids = mediaIds(doc);
  if (ids.length > 8)
    throw fail(
      400,
      "NOTIFICATION_IMAGE_LIMIT",
      "Maximum eight images per field",
    );
  if (!ids.length) return;
  const rows = await NotificationMedia.find({
    _id: { $in: ids },
    appMode: process.env.APP_MODE,
  })
    .select("_id width height")
    .session(session)
    .lean();
  if (rows.length !== ids.length)
    throw fail(
      400,
      "NOTIFICATION_MEDIA_UNAVAILABLE",
      "An image is unavailable",
    );
  const map = new Map(rows.map((r) => [String(r._id), r]));
  function visit(n) {
    if (n.type === "image" && n.attrs.mediaId) {
      const r = map.get(n.attrs.mediaId);
      n.attrs.width = r.width;
      n.attrs.height = r.height;
    }
    for (const c of n.content || []) visit(c);
  }
  visit(doc);
}
export async function prepareImage(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 2097152)
    throw fail(413, "NOTIFICATION_IMAGE_SIZE", "Image must be at most 2 MiB");
  const formats = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!formats[mime])
    throw fail(415, "NOTIFICATION_IMAGE_TYPE", "Choose JPEG, PNG or WebP");
  try {
    const image = sharp(buffer, {
      limitInputPixels: 16777216,
      animated: false,
      failOn: "warning",
    });
    const meta = await image.metadata();
    if (
      meta.format !== formats[mime] ||
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      (meta.pages || 1) > 1
    )
      throw Error("Invalid image");
    const { data, info } = await image
      .rotate()
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > 2097152) throw Error("Image exceeds stored limit");
    return {
      bytes: data,
      contentType: "image/webp",
      width: info.width,
      height: info.height,
      size: data.length,
    };
  } catch {
    throw fail(
      400,
      "NOTIFICATION_IMAGE_INVALID",
      "Invalid image or dimensions exceed 4096 × 4096",
    );
  }
}
