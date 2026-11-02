"use client";

import { cn } from "@/lib/utils";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

// Toolbar state before the editor reports any: useEditorState only computes
// after the first transaction, and gating the render on it left a fresh page
// stuck on the placeholder.
const IDLE_STATE = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  h2: false,
  h3: false,
  paragraph: true,
  bullet: false,
  ordered: false,
  quote: false,
  link: false,
  canUndo: false,
  canRedo: false,
};

// Links an admin may set. Anything else (javascript:, data:, relative app
// paths) is refused here, and again by the server sanitiser on every render.
const LINK_RE = /^(https?:\/\/|mailto:)\S+$/i;

/**
 * The blog's rich-text editor (Tiptap). It produces HTML; what readers see is
 * always that HTML run through the server allow-list (lib/blog/markdown.ts
 * renderHtml), never this editor's output as-is.
 */
export function RichTextEditor({
  value,
  onChange,
  onRequestImage,
  placeholder = "Write your post…",
}: {
  value: string;
  onChange: (html: string) => void;
  /** Opens the gallery; resolves with the image to insert, or null. */
  onRequestImage: () => Promise<{ url: string; alt: string } | null>;
  placeholder?: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
          isAllowedUri: (url) => LINK_RE.test(url),
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
        },
      }),
      // Pasted or dropped images would arrive as data: URIs; only gallery
      // images (inserted through onRequestImage) are allowed.
      Image.configure({ allowBase64: false, inline: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "prose-site min-h-[420px] px-5 py-5 sm:px-8 sm:py-7 focus:outline-none",
        "aria-label": "Post content",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });

  // A restored version replaces the whole document.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  const reported = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            code: e.isActive("codeBlock"),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            paragraph: e.isActive("paragraph"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            link: e.isActive("link"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });
  const state = reported ?? IDLE_STATE;

  const openLink = () => {
    if (!editor) return;
    setLinkUrl(editor.getAttributes("link").href ?? "");
    setLinkError(null);
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const href = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
    if (!LINK_RE.test(href)) {
      setLinkError("Use a web address (https://…) or an email (mailto:…).");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  };

  const insertImage = async (e: Editor) => {
    const image = await onRequestImage();
    if (image) e.chain().focus().setImage({ src: image.url, alt: image.alt }).run();
  };

  if (!editor) {
    return <div className="min-h-[480px] animate-pulse rounded-2xl border border-default-200 bg-default-50" />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-default-200 bg-white focus-within:border-default-300">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-default-200 bg-white/95 px-2 py-1.5 backdrop-blur"
      >
        <Tool label="Paragraph" active={state.paragraph} onClick={() => editor.chain().focus().setParagraph().run()}>
          <Pilcrow size={16} />
        </Tool>
        <Tool label="Heading" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={16} />
        </Tool>
        <Tool label="Subheading" active={state.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 size={16} />
        </Tool>
        <Divider />
        <Tool label="Bold" shortcut="⌘B" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </Tool>
        <Tool label="Italic" shortcut="⌘I" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </Tool>
        <Tool label="Underline" shortcut="⌘U" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <Underline size={16} />
        </Tool>
        <Tool label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={16} />
        </Tool>
        <Divider />
        <Tool label="Bulleted list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </Tool>
        <Tool label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </Tool>
        <Tool label="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={16} />
        </Tool>
        <Tool label="Code block" active={state.code} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <Code2 size={16} />
        </Tool>
        <Tool label="Divider line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus size={16} />
        </Tool>
        <Divider />
        <Tool label="Link" shortcut="⌘K" active={state.link} onClick={openLink}>
          <Link2 size={16} />
        </Tool>
        {state.link && (
          <Tool label="Remove link" onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}>
            <Unlink size={16} />
          </Tool>
        )}
        <Tool label="Image from gallery" onClick={() => void insertImage(editor)}>
          <ImagePlus size={16} />
        </Tool>
        <div className="ml-auto flex items-center gap-0.5">
          <Tool label="Undo" shortcut="⌘Z" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 size={16} />
          </Tool>
          <Tool label="Redo" shortcut="⇧⌘Z" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 size={16} />
          </Tool>
        </div>
      </div>

      {linkOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
          className="flex flex-wrap items-center gap-2 border-b border-default-200 bg-default-50 px-3 py-2"
        >
          <label htmlFor="editor-link" className="text-[12px] font-medium text-default-600">
            Link to
          </label>
          <input
            // Focused on mount, so keystrokes never land in the editor and
            // overwrite the selection the link is for.
            autoFocus
            id="editor-link"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://example.com"
            className="h-9 min-w-0 flex-1 rounded-lg border border-default-200 bg-white px-3 text-[13px] text-default-900 focus:border-primary focus:outline-none"
          />
          <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white hover:bg-primary-deep">
            Apply
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="h-9 rounded-lg px-3 text-[13px] font-medium text-default-600 hover:bg-default-100"
          >
            Cancel
          </button>
          {linkError && <p className="w-full text-[12px] text-accent-red">{linkError}</p>}
        </form>
      )}

      <EditorContent
        editor={editor}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            openLink();
          }
        }}
      />
    </div>
  );
}

function Tool({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg transition-colors disabled:opacity-35",
        active ? "bg-primary text-white" : "text-default-600 hover:bg-default-100 hover:text-default-950",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-default-200" />;
}
