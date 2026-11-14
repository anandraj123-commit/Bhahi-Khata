"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../shared/ui";
import policy from "../../../../../shared/notificationImagePolicy.json";
export function privateMediaPath(raw: string): string {
  if (raw.startsWith("data:")) {
    if (
      raw.length > policy.imageDataBytes ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)
    )
      throw Error("Invalid or oversized embedded image.");
    return raw;
  }
  const url = new URL(raw, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/admin\/api\/notification-media\/[a-f\d]{24}$/i.test(url.pathname)
  )
    throw Error("Unsupported image reference.");
  return url.pathname.toLowerCase();
}
function sourceDimensions(bytes: Uint8Array, kind: "png" | "jpeg" | "webp") {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (a: number, b: number) =>
    String.fromCharCode(...bytes.slice(a, b));
  if (kind === "png" && bytes.length >= 24)
    return [view.getUint32(16), view.getUint32(20)];
  if (kind === "webp") {
    if (bytes.length >= 30 && text(12, 16) === "VP8X")
      return [
        1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      ];
    if (bytes.length >= 30 && text(12, 16) === "VP8 ")
      return [
        view.getUint16(26, true) & 16383,
        view.getUint16(28, true) & 16383,
      ];
    if (bytes.length >= 25 && text(12, 16) === "VP8L")
      return [
        1 + (bytes[21] | ((bytes[22] & 63) << 8)),
        1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10)),
      ];
  }
  if (kind === "jpeg") {
    let pos = 2;
    while (pos + 4 < bytes.length) {
      if (bytes[pos++] !== 255) break;
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (
        [0xd8, 0x01, ...Array.from({ length: 8 }, (_, i) => 0xd0 + i)].includes(
          marker,
        )
      )
        continue;
      if (marker === 0xd9 || marker === 0xda || pos + 2 > bytes.length) break;
      const size = view.getUint16(pos);
      if (size < 2 || pos + size > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        size >= 7
      )
        return [view.getUint16(pos + 5), view.getUint16(pos + 3)];
      pos += size;
    }
  }
  throw Error(
    "Image dimensions could not be read safely. Choose another image.",
  );
}
async function processImage(file: File): Promise<string> {
  if (!file.size || file.size > policy.sourceBytes)
    throw Error("Choose JPEG, PNG or WebP up to 2 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (!png && !jpeg && !webp)
    throw Error("The file signature is not JPEG, PNG or WebP.");
  const dimensions = sourceDimensions(
    bytes,
    png ? "png" : jpeg ? "jpeg" : "webp",
  );
  if (dimensions.some((n) => !n || n > policy.maxSourceDimension))
    throw Error("Source dimensions must not exceed 4096 × 4096.");
  const blob = new Blob([bytes], {
    type: png ? "image/png" : jpeg ? "image/jpeg" : "image/webp",
  });
  const bitmap = await createImageBitmap(blob);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > policy.maxSourceDimension ||
      bitmap.height > policy.maxSourceDimension
    )
      throw Error("Source dimensions must not exceed 4096 × 4096.");
    const scale = Math.min(
      1,
      policy.maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Image processing is unavailable in this browser.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // WebP retains alpha; unsupported browsers return PNG, never a black JPEG background.
    const result = canvas.toDataURL("image/webp", 0.85);
    if (result.length > policy.imageDataBytes)
      throw Error(
        "Optimized image exceeds 500 KiB. Choose a smaller image; quality was not reduced further.",
      );
    return privateMediaPath(result);
  } finally {
    bitmap.close();
  }
}
export function ImagePicker({
  open,
  close,
  insert,
}: {
  open: boolean;
  close: () => void;
  insert: (url: string, alt: string) => boolean;
}) {
  const [preview, setPreview] = useState(""),
    [alt, setAlt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    if (!open) {
      generation.current++;
      setPreview("");
      setError("");
      setAlt("");
      setBusy(false);
    }
    return () => {
      generation.current++;
    };
  }, [open]);
  async function choose(file?: File) {
    const epoch = ++generation.current;
    setPreview("");
    setError("");
    if (!file) return;
    setBusy(true);
    try {
      const result = await processImage(file);
      if (epoch === generation.current) setPreview(result);
    } catch (e) {
      if (epoch === generation.current)
        setError(
          e instanceof Error ? e.message : "Unable to decode this image.",
        );
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  return (
    <Modal
      title="Insert Image"
      description="Embed an image in this notification. No separate upload is required."
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <div className="a-embedded-image-dialog">
        <label className="a-filter-field">
          Choose Image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p className="a-muted">
          JPEG, PNG or WebP · source up to 2 MiB · resized to fit 1200 × 1200 ·
          encoded image up to 500 KiB. Animated images are inserted as a still
          frame.
        </p>
        {busy && <p role="status">Optimizing image locally…</p>}
        {preview && (
          <img
            className="a-image-preview"
            src={preview}
            alt={alt || "Selected image preview"}
          />
        )}
        <label className="a-filter-field">
          Alternative Text (optional)
          <input
            className="a-input"
            maxLength={200}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="a-error">
            {error}
          </p>
        )}
        <div className="a-notification-actions">
          <button
            type="button"
            className="a-btn"
            disabled={busy || !preview}
            onClick={() => {
              try {
                if (!insert(preview, alt.trim()))
                  throw Error(
                    "Unable to insert here. Choose a text position and retry.",
                  );
                close();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Image insertion failed.",
                );
              }
            }}
          >
            Insert Image
          </button>
          <button type="button" className="a-btn" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
