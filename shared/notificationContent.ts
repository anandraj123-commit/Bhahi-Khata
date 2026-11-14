export type RichDoc = {
  type: string;
  text?: string;
  attrs?: {
    level?: number;
    href?: string;
    mediaId?: string;
    src?: string;
    alt?: string;
    width?: number;
    height?: number;
    widthPercent?: number;
    align?: "left" | "center" | "right";
    textAlign?: "left" | "center" | "right" | "justify";
  };
  marks?: { type: string; attrs?: { href?: string } }[];
  content?: RichDoc[];
};
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function documentToHtml(
  doc: RichDoc,
  mediaUrl: (id: string) => string = (id) =>
    `/admin/api/notification-media/${id}`,
): string {
  function node(n: RichDoc, depth = 0): string {
    if (depth > 10) return "";
    if (n.type === "text") {
      let s = escape(n.text);
      for (const m of n.marks || []) {
        const tag = { bold: "strong", italic: "em", underline: "u" }[m.type];
        if (tag) s = `<${tag}>${s}</${tag}>`;
        if (m.type === "link" && /^https?:\/\//i.test(m.attrs?.href || ""))
          s = `<a href="${escape(m.attrs!.href)}" rel="noopener noreferrer">${s}</a>`;
      }
      return s;
    }
    if (n.type === "hardBreak") return "<br>";
    if (
      n.type === "image" &&
      (/^[a-f\d]{24}$/i.test(n.attrs?.mediaId || "") ||
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          n.attrs?.src || "",
        ))
    )
      return `<figure class="image" style="width:100%"><img data-width-percent="${Math.min(100, Math.max(10, n.attrs?.widthPercent || 100))}" data-align="${escape(n.attrs?.align || "left")}" src="${escape(n.attrs?.src || mediaUrl(n.attrs!.mediaId!))}" alt="${escape(n.attrs?.alt)}"${n.attrs?.width ? ` width="${Number(n.attrs.width)}"` : ""}${n.attrs?.height ? ` height="${Number(n.attrs.height)}"` : ""}></figure>`;
    const children = (n.content || []).map((c) => node(c, depth + 1)).join("");
    const tag =
      n.type === "heading"
        ? `h${Math.min(3, Math.max(1, n.attrs?.level || 2))}`
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
      ? `<${tag}${["heading", "paragraph"].includes(n.type) && n.attrs?.textAlign ? ` style="text-align:${escape(n.attrs.textAlign)}"` : ""}>${children}</${tag}>`
      : children;
  }
  return node(doc);
}
