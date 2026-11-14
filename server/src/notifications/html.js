import { policy, validateDataUrl } from "./embeddedImages.js";
import sanitizeHtml from "sanitize-html";
import { parseDocument } from "htmlparser2";
// Convert editor HTML into the same bounded structured representation as legacy content.
export function htmlToDocument(html) {
  if (
    typeof html !== "string" ||
    Buffer.byteLength(html) > policy.documentBytes
  )
    throw Error("HTML exceeds size limit");
  const clean = sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "figure",
      "figcaption",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
    ],
    allowedAttributes: {
      a: ["href"],
      img: [
        "src",
        "alt",
        "data-width-percent",
        "data-align",
        "width",
        "height",
      ],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      figure: ["class", "style"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedStyles: {
      figure: { width: [/^\d{1,3}%$/] },
      "*": { "text-align": [/^(left|center|right|justify)$/] },
    },
    allowedSchemesByTag: { img: ["data", "https", "http"] },
    allowedSchemes: ["https", "http"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });
  function children(n, marks = []) {
    return (n.children || []).flatMap((c) => convert(c, marks));
  }
  function convert(n, marks = []) {
    if (n.type === "text")
      return [
        { type: "text", text: n.data, ...(marks.length ? { marks } : {}) },
      ];
    if (n.type !== "tag") return [];
    if (
      ["td", "th"].includes(n.name) &&
      ["colspan", "rowspan"].some((k) => Number(n.attribs[k] || 1) !== 1)
    )
      throw Error("Merged table cells are not supported");
    const m = {
      strong: "bold",
      b: "bold",
      em: "italic",
      i: "italic",
      u: "underline",
    }[n.name];
    if (m) return children(n, [...marks, { type: m }]);
    if (n.name === "a")
      return children(
        n,
        n.attribs.href
          ? [...marks, { type: "link", attrs: { href: n.attribs.href } }]
          : marks,
      );
    if (n.name === "img") {
      const id = /^\/admin\/api\/notification-media\/([a-f\d]{24})$/i.exec(
        n.attribs.src || "",
      )?.[1];
      const src = n.attribs.src || "";
      if (!id) validateDataUrl(src);
      return [
        {
          type: "image",
          attrs: {
            ...(id ? { mediaId: id } : { src }),
            width: Number(n.attribs.width) || undefined,
            height: Number(n.attribs.height) || undefined,
            alt: (n.attribs.alt || "").slice(0, 200),
            widthPercent: Number(n.attribs["data-width-percent"] || 100),
            align: n.attribs["data-align"] || "left",
          },
        },
      ];
    }
    if (n.name === "figure") {
      const out = children(n, marks);
      const width = /width\s*:\s*(\d+)%/.exec(n.attribs.style || "")?.[1];
      for (const c of out)
        if (c.type === "image" && width)
          c.attrs.widthPercent = Math.max(10, Math.min(100, Number(width)));
      return out;
    }
    if (["thead", "tbody"].includes(n.name))
      return children(n, marks).filter((c) => c.type === "tableRow");
    const type = {
      p: "paragraph",
      br: "hardBreak",
      ul: "bulletList",
      ol: "orderedList",
      li: "listItem",
      blockquote: "blockquote",
      table: "table",
      tr: "tableRow",
      td: "tableCell",
      th: "tableHeader",
      figcaption: "paragraph",
      h1: "heading",
      h2: "heading",
      h3: "heading",
    }[n.name];
    if (!type) return [];
    let content = children(n, marks);
    if (
      ["table", "tableRow", "bulletList", "orderedList", "blockquote"].includes(
        type,
      )
    )
      content = content.filter((c) => c.type !== "text" || c.text.trim());
    if (["tableCell", "tableHeader", "listItem"].includes(type)) {
      const inline = content.filter((c) =>
        ["text", "hardBreak"].includes(c.type),
      );
      if (inline.length)
        content = [
          { type: "paragraph", content: inline },
          ...content.filter((c) => !inline.includes(c)),
        ];
    }
    return [
      {
        type,
        ...(["heading", "paragraph"].includes(type)
          ? {
              attrs: {
                ...(type === "heading" ? { level: Number(n.name[1]) } : {}),
                textAlign:
                  /text-align\s*:\s*(left|center|right|justify)/.exec(
                    n.attribs.style || "",
                  )?.[1] || "left",
              },
            }
          : {}),
        ...(type === "hardBreak" ? {} : { content }),
      },
    ];
  }
  const content = children(parseDocument(clean)).filter(
    (n) => n.type !== "text" || n.text.trim(),
  );
  return { type: "doc", content };
}
