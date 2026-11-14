import sharp from "sharp";
import policy from "../../../shared/notificationImagePolicy.json" with { type: "json" };
export { policy };
export function validateDataUrl(src) {
  if (typeof src !== "string" || src.length > policy.imageDataBytes)
    throw Error("Embedded image exceeds 500 KiB");
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || match[2].length % 4 !== 0)
    throw Error("Invalid embedded image data URL");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.toString("base64") !== match[2])
    throw Error("Invalid image Base64");
  return { bytes, format: match[1] };
}
export async function validateEmbeddedImages(...docs) {
  let total = 0;
  for (const doc of docs) {
    let count = 0;
    async function visit(n) {
      if (n.type === "image") {
        if (++count > policy.imagesPerField)
          throw Error("Maximum eight images per field");
        if (n.attrs.src) {
          total += n.attrs.src.length;
          if (total > policy.totalImageDataBytes)
            throw Error("Combined embedded images exceed 3 MiB");
          const { bytes, format } = validateDataUrl(n.attrs.src);
          const image = sharp(bytes, {
            limitInputPixels: policy.maxDimension ** 2,
            failOn: "warning",
            animated: true,
          });
          const meta = await image.metadata();
          if (
            meta.format !== format ||
            !meta.width ||
            !meta.height ||
            meta.width > policy.maxDimension ||
            meta.height > policy.maxDimension ||
            (meta.pages || 1) > 1
          )
            throw Error(
              "Invalid image type or dimensions; maximum 1200 × 1200, single frame",
            );
          // Force full decoding: metadata alone does not validate truncated image bytes.
          await image.raw().toBuffer();
          n.attrs.width = meta.width;
          n.attrs.height = meta.height;
        }
      }
      for (const child of n.content || []) await visit(child);
    }
    await visit(doc);
  }
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// Serialize only validated nodes, not arbitrary incoming HTML or attributes.
export function storedHtml(n) {
  if (n.type === "text") {
    let text = esc(n.text);
    for (const mark of n.marks || []) {
      const tag = { bold: "strong", italic: "em", underline: "u" }[mark.type];
      if (tag) text = `<${tag}>${text}</${tag}>`;
      if (mark.type === "link")
        text = `<a href="${esc(mark.attrs.href)}" rel="noopener noreferrer">${text}</a>`;
    }
    return text;
  }
  if (n.type === "hardBreak") return "<br>";
  if (n.type === "image") {
    const a = n.attrs;
    return `<img src="${esc(a.src || `/admin/api/notification-media/${a.mediaId}`)}" alt="${esc(a.alt)}" data-width-percent="${a.widthPercent}" data-align="${a.align}" width="${a.width}" height="${a.height}">`;
  }
  const children = (n.content || []).map(storedHtml).join("");
  const tag =
    n.type === "heading"
      ? `h${n.attrs.level}`
      : {
          paragraph: "p",
          bulletList: "ul",
          orderedList: "ol",
          listItem: "li",
          blockquote: "blockquote",
          table: "table",
          tableRow: "tr",
          tableCell: "td",
          tableHeader: "th",
        }[n.type];
  return tag
    ? `<${tag}${n.attrs?.textAlign ? ` style="text-align:${n.attrs.textAlign}"` : ""}>${children}</${tag}>`
    : children;
}
