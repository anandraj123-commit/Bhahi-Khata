import { policy, validateDataUrl } from "./embeddedImages.js";
import { z } from "zod";
import { htmlToDocument } from "./html.js";
const mark = z.discriminatedUnion("type", [
  ...["bold", "italic", "underline"].map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
  z
    .object({
      type: z.literal("link"),
      attrs: z
        .object({
          href: z
            .string()
            .max(1000)
            .refine((v) => {
              try {
                const u = new URL(v);
                return (
                  ["https:", "http:"].includes(u.protocol) &&
                  !u.username &&
                  !u.password
                );
              } catch {
                return false;
              }
            }),
          target: z.string().optional(),
          rel: z.string().optional(),
          class: z.string().nullable().optional(),
        })
        .strip()
        .transform((a) => ({ href: new URL(a.href).href })),
    })
    .strict(),
]);
export function normalizeContent(value, maxText = 12000) {
  if (typeof value === "string") value = htmlToDocument(value);
  let count = 0,
    chars = 0;
  function visit(n, depth = 0) {
    if (
      depth > 10 ||
      ++count > 1000 ||
      !n ||
      typeof n !== "object" ||
      Array.isArray(n)
    )
      throw Error("Rich text is too complex");
    if (n.type === "image")
      return {
        type: "image",
        attrs: {
          align: z
            .enum(["left", "center", "right"])
            .default("left")
            .parse(n.attrs?.align),
          ...(n.attrs?.src
            ? (validateDataUrl(n.attrs.src), { src: n.attrs.src })
            : {
                mediaId: z
                  .string()
                  .regex(/^[a-f\d]{24}$/i)
                  .parse(n.attrs?.mediaId),
              }),
          ...(n.attrs?.width
            ? { width: z.number().int().min(1).max(4096).parse(n.attrs.width) }
            : {}),
          ...(n.attrs?.height
            ? {
                height: z.number().int().min(1).max(4096).parse(n.attrs.height),
              }
            : {}),
          alt: z.string().max(200).default("").parse(n.attrs?.alt),
          widthPercent: z
            .number()
            .min(10)
            .max(100)
            .default(100)
            .parse(n.attrs?.widthPercent),
        },
      };
    if (n.type === "text") {
      const text = z.string().max(maxText).parse(n.text);
      chars += text.length;
      return {
        type: "text",
        text,
        ...(n.marks ? { marks: z.array(mark).max(4).parse(n.marks) } : {}),
      };
    }
    if (
      ![
        "image",
        "blockquote",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "doc",
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "hardBreak",
      ].includes(n.type)
    )
      throw Error("Unsupported rich-text element");
    const allowedChildren = {
      doc: [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "image",
        "blockquote",
        "table",
      ],
      blockquote: [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "image",
      ],
      table: ["tableRow"],
      tableRow: ["tableCell", "tableHeader"],
      tableCell: ["paragraph", "heading", "bulletList", "orderedList", "image"],
      tableHeader: [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "image",
      ],
      paragraph: ["text", "hardBreak"],
      heading: ["text", "hardBreak"],
      bulletList: ["listItem"],
      orderedList: ["listItem"],
      listItem: ["paragraph", "heading", "bulletList", "orderedList", "image"],
      hardBreak: [],
    };
    if (
      (n.content || []).some((c) => !allowedChildren[n.type].includes(c?.type))
    )
      throw Error("Invalid rich-text structure");
    const attrs =
      n.type === "heading"
        ? { level: z.number().int().min(1).max(3).parse(n.attrs?.level) }
        : n.type === "orderedList"
          ? { start: 1 }
          : undefined;
    return {
      type: n.type,
      ...(["heading", "paragraph"].includes(n.type)
        ? {
            attrs: {
              ...attrs,
              textAlign: z
                .enum(["left", "center", "right", "justify"])
                .default("left")
                .parse(n.attrs?.textAlign),
            },
          }
        : attrs
          ? { attrs }
          : {}),
      ...(n.type === "hardBreak"
        ? {}
        : {
            content: z
              .array(z.unknown())
              .max(500)
              .parse(n.content || [])
              .map((c) => visit(c, depth + 1)),
          }),
    };
  }
  const doc = visit(value);
  if (doc.type !== "doc" || chars > maxText || !plainContent(doc).trim())
    throw Error(
      "Rich text is required and exceeds no more than the documented length",
    );
  if (JSON.stringify(doc).length > policy.documentBytes)
    throw Error("Rich text is too large");
  return doc;
}
export function plainContent(n) {
  return n.type === "text"
    ? n.text
    : (n.content || [])
        .map(plainContent)
        .join(
          ["doc", "bulletList", "orderedList"].includes(n.type) ? "\n" : "",
        );
}
