"use client";
import React from "react";
import dynamic from "next/dynamic";
import type { RichDoc } from "../../../../../shared/notificationContent";
export type { RichDoc } from "../../../../../shared/notificationContent";
const Editor = dynamic(() => import("./tiptap-client"), {
  ssr: false,
  loading: () => <p>Loading rich-text editor…</p>,
});
export const emptyDocument: RichDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
export function RichEditor(props: {
  value: RichDoc | string;
  onChange: (v: RichDoc | string) => void;
  label: string;
  onValidityChange?: (valid: boolean) => void;
}) {
  return (
    <div className="a-notification-editor">
      <Editor {...props} />
    </div>
  );
}
const LegacyView = dynamic(
  () => import("./tiptap-client").then((m) => m.LegacyRichView),
  { ssr: false },
);
export function RichContent({ value }: { value?: RichDoc | string }) {
  if (typeof value === "string") return <LegacyView value={value} />;
  function node(n: RichDoc, i: number, depth = 0): React.ReactNode {
    if (depth > 10) return null;
    if (n.type === "text") {
      let out: React.ReactNode = n.text;
      for (const m of n.marks || []) {
        if (m.type === "bold") out = <strong>{out}</strong>;
        if (m.type === "italic") out = <em>{out}</em>;
        if (m.type === "underline") out = <u>{out}</u>;
        if (m.type === "link" && /^https?:\/\//i.test(m.attrs?.href || ""))
          out = (
            <a href={m.attrs!.href} target="_blank" rel="noopener noreferrer">
              {out}
            </a>
          );
      }
      return <React.Fragment key={i}>{out}</React.Fragment>;
    }
    const children = n.content?.map((c, k) => node(c, k, depth + 1));
    if (n.type === "image")
      return (
        <figure
          key={i}
          style={{
            maxWidth: `${n.attrs?.widthPercent || 100}%`,
            marginLeft: (n.attrs?.align || "left") === "left" ? 0 : "auto",
            marginRight: n.attrs?.align === "right" ? 0 : "auto",
          }}
        >
          <img
            src={
              n.attrs?.src ||
              `/admin/api/notification-media/${n.attrs?.mediaId}`
            }
            alt={n.attrs?.alt || "Notification image"}
            style={{ maxWidth: "100%", height: "auto" }}
          />
        </figure>
      );
    if (n.type === "blockquote")
      return <blockquote key={i}>{children}</blockquote>;
    if (n.type === "table")
      return (
        <div key={i} style={{ overflowX: "auto" }}>
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      );
    if (n.type === "tableRow") return <tr key={i}>{children}</tr>;
    if (n.type === "tableCell") return <td key={i}>{children}</td>;
    if (n.type === "tableHeader") return <th key={i}>{children}</th>;
    if (n.type === "hardBreak") return <br key={i} />;
    if (n.type === "heading")
      return React.createElement(
        `h${Math.min(3, Math.max(1, n.attrs?.level || 2))}`,
        { key: i, style: { textAlign: n.attrs?.textAlign } },
        children,
      );
    if (n.type === "paragraph")
      return (
        <p key={i} style={{ textAlign: n.attrs?.textAlign }}>
          {children}
        </p>
      );
    if (n.type === "bulletList") return <ul key={i}>{children}</ul>;
    if (n.type === "orderedList") return <ol key={i}>{children}</ol>;
    if (n.type === "listItem") return <li key={i}>{children}</li>;
    return <div key={i}>{children}</div>;
  }
  return (
    <div className="a-rich-content">
      {value ? node(value, 0) : "Unavailable"}
    </div>
  );
}
