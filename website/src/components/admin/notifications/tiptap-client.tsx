"use client";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ImagePlus,
  Table2,
  Undo2,
  Redo2,
  RemoveFormatting,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import {
  documentToHtml,
  type RichDoc,
} from "../../../../../shared/notificationContent";
import { ImagePicker, privateMediaPath } from "./image-picker";
const PrivateImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPercent: {
        default: 100,
        parseHTML: (el) => Number(el.getAttribute("data-width-percent") || 100),
        renderHTML: (attrs) => ({ "data-width-percent": attrs.widthPercent }),
      },
      align: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-align") || "left",
        renderHTML: (attrs) => ({ "data-align": attrs.align }),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "img",
      {
        ...HTMLAttributes,
        style: `width:${Math.min(100, Math.max(10, Number(node.attrs.widthPercent) || 100))}%;max-width:100%;height:auto;display:block;margin-left:${node.attrs.align === "left" ? "0" : "auto"};margin-right:${node.attrs.align === "right" ? "0" : "auto"}`,
      },
    ];
  },
});
// Only import the representation supported by the existing storage and native renderer.
// Unknown structures stop editing rather than disappearing during editor initialization.
function prepare(value: RichDoc | string): string {
  if (typeof value !== "string") {
    const types = new Set([
      "doc",
      "text",
      "paragraph",
      "heading",
      "hardBreak",
      "bulletList",
      "orderedList",
      "listItem",
      "blockquote",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
      "image",
    ]);
    function check(n: RichDoc) {
      if (
        !types.has(n.type) ||
        (n.marks || []).some(
          (m) => !["bold", "italic", "underline", "link"].includes(m.type),
        )
      )
        throw Error(
          "This document contains unsupported formatting. Original content has been retained; review it before editing.",
        );
      n.content?.forEach(check);
    }
    check(value);
  }
  const doc = new DOMParser().parseFromString(
    typeof value === "string" ? value : documentToHtml(value),
    "text/html",
  );
  if (doc.head.querySelector("style,script"))
    throw Error(
      "Embedded styles/scripts are unsupported; original content is preserved.",
    );
  const allowed = new Set([
    "P",
    "BR",
    "H1",
    "H2",
    "H3",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "UL",
    "OL",
    "LI",
    "A",
    "BLOCKQUOTE",
    "FIGURE",
    "FIGCAPTION",
    "IMG",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "COLGROUP",
    "COL",
  ]);
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    if (el.tagName === "OL" && Number(el.getAttribute("start") || 1) !== 1)
      throw Error("Non-default list numbering requires review before editing.");
    if (el.tagName === "COL" && el.getAttribute("style"))
      throw Error("Custom table column widths require review before editing.");
    if (
      !allowed.has(el.tagName) ||
      Array.from(el.attributes).some((a) => /^on/i.test(a.name))
    )
      throw Error(
        "Unsupported HTML formatting detected. Original content has not been changed.",
      );
    if (
      ["TD", "TH"].includes(el.tagName) &&
      ["colspan", "rowspan"].some((k) => Number(el.getAttribute(k) || 1) !== 1)
    )
      throw Error(
        "Merged cells require review; this editor does not silently remove them.",
      );
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href) {
        const u = new URL(href);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw Error("Unsupported link URL.");
      }
    }
    if (el.tagName === "IMG")
      el.setAttribute("src", privateMediaPath(el.getAttribute("src") || ""));
    const style = (el as HTMLElement).style;
    if (
      el.tagName === "IMG" &&
      style.width &&
      !el.hasAttribute("data-width-percent")
    ) {
      if (!/^\d{1,3}%$/.test(style.width))
        throw Error("Pixel-sized images require review before editing.");
      el.setAttribute("data-width-percent", style.width.slice(0, -1));
    }
    for (const property of Array.from(style))
      if (
        ![
          "width",
          "height",
          "max-width",
          "display",
          "margin-left",
          "margin-right",
          "text-align",
        ].includes(property)
      )
        throw Error(
          `Unsupported style ${property}; original content is preserved.`,
        );
  }
  for (const figure of Array.from(doc.body.querySelectorAll("figure"))) {
    const img = figure.querySelector("img");
    if (img) {
      if (figure.className.includes("align-right"))
        img.setAttribute("data-align", "right");
      else if (figure.className.includes("align-center"))
        img.setAttribute("data-align", "center");
      const w = (figure as HTMLElement).style.width;
      if (w.endsWith("%") && !img.hasAttribute("data-width-percent"))
        img.setAttribute("data-width-percent", w.slice(0, -1));
    }
    for (const caption of Array.from(figure.querySelectorAll("figcaption"))) {
      const p = doc.createElement("p");
      p.append(...Array.from(caption.childNodes));
      caption.replaceWith(p);
    }
    figure.replaceWith(...Array.from(figure.childNodes));
  }
  doc.querySelectorAll("colgroup").forEach((el) => el.remove());
  return doc.body.innerHTML;
}
export default function NotificationEditor({
  value,
  onChange,
  label,
  onValidityChange,
}: {
  value: RichDoc | string;
  onChange: (v: RichDoc | string) => void;
  label: string;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [initial] = useState(() => {
    try {
      return { html: prepare(value), error: "" };
    } catch (e) {
      return {
        html: "",
        error: e instanceof Error ? e.message : "Unable to import content",
      };
    }
  });
  const [error, setError] = useState(initial.error),
    [images, setImages] = useState(false),
    [link, setLink] = useState<string | null>(null),
    [alt, setAlt] = useState("");
  const cursor = useRef({ from: 1, to: 1 });
  const editor = useEditor({
    immediatelyRender: false,
    editable: !initial.error,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: false,
          protocols: ["http", "https"],
        },
      }),
      PrivateImage.configure({ allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initial.html,
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
      },
      handlePaste: (_, event) => {
        if (event.clipboardData?.files.length) {
          setError("Use Insert Image to validate and upload clipboard images.");
          return true;
        }
        const html = event.clipboardData?.getData("text/html");
        if (html) {
          try {
            const safe = prepare(html);
            editor?.commands.insertContent(safe);
            return true;
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Unsupported pasted content",
            );
            return true;
          }
        }
        return false;
      },
      handleDrop: (_, event, _slice, moved) => {
        if (!moved && event.dataTransfer?.getData("text/html")) {
          setError(
            "Paste formatted content or use Insert Image so it can be validated.",
          );
          return true;
        }
        if (event.dataTransfer?.files.length) {
          setError("Use Insert Image to validate and upload images.");
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setError("");
      onChange(editor.getHTML());
    },
  });
  useEditorState({ editor, selector: (ctx) => ctx.editor?.state });
  useEffect(() => {
    onValidityChange?.(!initial.error);
  }, [initial.error, onValidityChange]);
  useEffect(() => {
    if (editor?.isActive("image"))
      setAlt(String(editor.getAttributes("image").alt || ""));
  }, [editor?.state.selection, editor]);
  if (!editor) return <p role="status">Loading rich-text editor…</p>;
  const icons: Record<string, LucideIcon> = {
    Bold,
    Italic,
    Underline,
    "Bulleted list": List,
    "Numbered list": ListOrdered,
    Quote,
    Link,
    "Align left": AlignLeft,
    "Align center": AlignCenter,
    "Align right": AlignRight,
    "Align justify": AlignJustify,
    "Upload Image": ImagePlus,
    "Insert table": Table2,
    Undo: Undo2,
    Redo: Redo2,
    "Remove formatting": RemoveFormatting,
  };
  const action = (
    name: string,
    run: () => void,
    active = false,
    disabled = false,
  ) => {
    const Icon = icons[name];
    return (
      <button
        type="button"
        title={name}
        aria-label={name}
        aria-pressed={active}
        disabled={!!initial.error || disabled}
        onClick={run}
      >
        {Icon && <Icon size={17} aria-hidden="true" />}
        <span>{name}</span>
      </button>
    );
  };
  const imageActive = editor.isActive("image");
  function insert(src: string, description: string) {
    if (!editor || editor.isDestroyed || !editor.isEditable) return false;
    // Update the document without fighting the image dialog's focus trap.
    return editor
      .chain()
      .setTextSelection({
        from: Math.min(cursor.current.from, editor.state.doc.content.size),
        to: Math.min(cursor.current.to, editor.state.doc.content.size),
      })
      .setImage({ src: privateMediaPath(src), alt: description })
      .run();
  }
  return (
    <div>
      <div
        className="a-editor-toolbar"
        role="toolbar"
        aria-label={`${label} formatting`}
      >
        {action(
          "Bold",
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive("bold"),
        )}
        {action(
          "Italic",
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive("italic"),
        )}
        {action(
          "Underline",
          () => editor.chain().focus().toggleUnderline().run(),
          editor.isActive("underline"),
        )}
        <select
          aria-label="Paragraph style"
          value={
            editor.isActive("heading")
              ? String(editor.getAttributes("heading").level)
              : "0"
          }
          disabled={!!initial.error}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n)
              editor
                .chain()
                .focus()
                .toggleHeading({ level: n as 1 | 2 | 3 })
                .run();
            else editor.chain().focus().setParagraph().run();
          }}
        >
          <option value="0">Paragraph</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              Heading {n}
            </option>
          ))}
        </select>
        {action(
          "Bulleted list",
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
        )}
        {action(
          "Numbered list",
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
        )}
        {action(
          "Quote",
          () => editor.chain().focus().toggleBlockquote().run(),
          editor.isActive("blockquote"),
        )}
        {action(
          "Link",
          () => setLink(String(editor.getAttributes("link").href || "")),
          editor.isActive("link"),
        )}
        {(["left", "center", "right", "justify"] as const).map((a) => (
          <span key={a}>
            {action(
              `Align ${a}`,
              () =>
                imageActive
                  ? editor
                      .chain()
                      .focus()
                      .updateAttributes("image", { align: a })
                      .run()
                  : editor.chain().focus().setTextAlign(a).run(),
              imageActive
                ? editor.getAttributes("image").align === a
                : editor.isActive({ textAlign: a }),
              imageActive && a === "justify",
            )}
          </span>
        ))}
        {action("Upload Image", () => {
          cursor.current = {
            from: editor.state.selection.from,
            to: editor.state.selection.to,
          };
          setImages(true);
        })}
        {action("Insert table", () =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
        )}
        {action(
          "Undo",
          () => editor.chain().focus().undo().run(),
          false,
          !editor.can().undo(),
        )}
        {action(
          "Redo",
          () => editor.chain().focus().redo().run(),
          false,
          !editor.can().redo(),
        )}
        {action("Remove formatting", () =>
          editor
            .chain()
            .focus()
            .unsetAllMarks()
            .clearNodes()
            .unsetTextAlign()
            .run(),
        )}
      </div>
      {link !== null && (
        <div className="a-notification-toolbar">
          <input
            aria-label="Link URL"
            className="a-input"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…"
          />
          <button
            type="button"
            onClick={() => {
              try {
                const u = new URL(link);
                if (
                  !["https:", "http:"].includes(u.protocol) ||
                  u.username ||
                  u.password
                )
                  throw Error();
                editor.chain().focus().setLink({ href: u.href }).run();
                setLink(null);
              } catch {
                setError("Enter an HTTP or HTTPS URL without credentials.");
              }
            }}
          >
            Apply link
          </button>
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setLink(null);
            }}
          >
            Remove link
          </button>
          <button type="button" onClick={() => setLink(null)}>
            Cancel
          </button>
        </div>
      )}
      {editor.isActive("table") && (
        <div className="a-editor-toolbar">
          {action("Add row", () => editor.chain().focus().addRowAfter().run())}
          {action("Add column", () =>
            editor.chain().focus().addColumnAfter().run(),
          )}
          {action("Delete row", () => editor.chain().focus().deleteRow().run())}
          {action("Delete column", () =>
            editor.chain().focus().deleteColumn().run(),
          )}
          {action("Delete table", () =>
            editor.chain().focus().deleteTable().run(),
          )}
        </div>
      )}
      {imageActive && (
        <div className="a-editor-toolbar">
          <label>
            Image width
            <select
              aria-label="Image width"
              value={editor.getAttributes("image").widthPercent || 100}
              onChange={(e) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("image", {
                    widthPercent: Number(e.target.value),
                  })
                  .run()
              }
            >
              {[
                ...new Set([
                  10,
                  25,
                  50,
                  75,
                  100,
                  Number(editor.getAttributes("image").widthPercent) || 100,
                ]),
              ]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option value={n} key={n}>
                    {n}%
                  </option>
                ))}
            </select>
          </label>
          <label>
            Alternative text
            <input
              value={alt}
              maxLength={200}
              onChange={(e) => {
                setAlt(e.target.value);
                editor.commands.updateAttributes("image", {
                  alt: e.target.value,
                });
              }}
            />
          </label>
          {action("Delete image", () =>
            editor.chain().focus().deleteSelection().run(),
          )}
        </div>
      )}
      <EditorContent editor={editor} />
      <p className="a-muted">
        {editor.getText().length.toLocaleString("en-IN")} characters · Images
        remain private. Select an image to resize or align it.
      </p>
      {error && <p role="alert">{error}</p>}
      <ImagePicker
        open={images}
        close={() => setImages(false)}
        insert={insert}
      />
    </div>
  );
}

// Legacy stored HTML is parsed by the same restricted schema, never injected as HTML.
export function LegacyRichView({ value }: { value: string }) {
  const [content] = useState(() => {
    try {
      return { html: prepare(value), error: "" };
    } catch (e) {
      return {
        html: "",
        error: e instanceof Error ? e.message : "Unsupported legacy formatting",
      };
    }
  });
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        link: {
          openOnClick: true,
          autolink: false,
          protocols: ["http", "https"],
        },
      }),
      PrivateImage.configure({ allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: content.html,
  });
  return content.error ? (
    <p role="alert">{content.error}</p>
  ) : (
    <EditorContent editor={editor} />
  );
}
