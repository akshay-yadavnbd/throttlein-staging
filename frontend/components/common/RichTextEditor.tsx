'use client';
import { syncRichTextValue } from '@/lib/richTextState';

/**
 * TipTap-powered rich-text editor.
 *
 * Output format: HTML. Stored as-is on `Product.description` /
 * `BlogPost.body` and rendered by RichTextView (which sanitises with
 * DOMPurify against an allowlist matching the toolbar capabilities).
 *
 * Toolbar (left → right):
 *   - Heading dropdown (Paragraph / H1-H4)
 *   - Bold / Italic / Underline / Strikethrough
 *   - Align left / center / right / justify
 *   - Bullet list / Ordered list
 *   - Blockquote / Code block / Horizontal rule
 *   - Link / Image / Table
 *   - Undo / Redo
 *   - Clear formatting
 *
 * Top-right of the editor:
 *   - Visual / HTML toggle (switches to a raw HTML textarea)
 *   - Fullscreen toggle (expands to viewport)
 *
 * Tables: 3×3 by default, with header row. Once inserted, the user can
 * add/remove rows + columns via keyboard or by clicking inside a cell
 * (Tab and arrow keys behave like a spreadsheet).
 */

import { useEffect, useRef, useState } from 'react';
// Tiptap v3 imports — Underline + Link now ship inside StarterKit
// (configured via StarterKit.configure), Placeholder moved into the
// consolidated `@tiptap/extensions` package, and the table sub-packages
// merged into `@tiptap/extension-table` named exports.
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { api, imageUrl, unwrap } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import { M } from '@/lib/messages';

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** ARIA label for the editor surface. */
  ariaLabel?: string;
  /** Editor min-height (px) — default 160 ≈ ~5 lines. */
  minHeight?: number;
  showFullscreen?: boolean;
};

type Mode = 'visual' | 'html';

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  ariaLabel = 'Body',
  minHeight = 160,
  showFullscreen = true,
}: Props) {
  const [mode, setMode] = useState<Mode>('visual');
  const [fullscreen, setFullscreen] = useState(false);
  const [htmlValue, setHtmlValue] = useState(value || '');

  // Keep HTML mode buffer in sync when the parent forces a new value.
  useEffect(() => {
    if (mode === 'html') setHtmlValue(value || '');
  }, [value, mode]);

  const editor = useEditor({
    // SSR-safety in Next 15.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // v3: Link + Underline are built into StarterKit — the link
        // options below used to live on the standalone Link extension.
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            // Why no `nofollow` by default:
            //   The blog editor is admin-only. Anything an admin chooses
            //   to link to is editorially curated and trusted, so we
            //   want PageRank to flow normally. Adding nofollow to every
            //   link — including internal links to other posts/products
            //   on throttlein.com — was causing Semrush to flag the blog
            //   for "internal links contain nofollow", a documented
            //   negative SEO signal. We still emit `noopener noreferrer`
            //   for security on `_blank` links. If an admin wants to
            //   nofollow a specific link (e.g. paid placement), they can
            //   add it manually through the link UI.
            rel: 'noopener noreferrer',
            target: '_blank',
            class: 'text-brand-black underline underline-offset-2',
          },
        },
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'rt-image', loading: 'lazy' },
      }),
      // Text alignment — applied to headings + paragraphs (not lists,
      // which TipTap aligns at the list-item level via different markup).
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: 'rt-table' },
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value || '',
    onUpdate({ editor }) {
      const html = editor.getHTML();
      onChange(editor.isEmpty ? '' : html);
    },
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        class:
          'prose-styles outline-none px-3.5 py-3 text-sm leading-relaxed min-h-[var(--rt-min-h)]',
        style: `--rt-min-h: ${minHeight}px`,
      },
    },
  });

  // Hydrate an empty editor when asynchronous draft imports provide content.
  useEffect(() => {
    if (!editor) return;
    syncRichTextValue(editor, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  // ── Inline image upload ──────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const { url: stored } = unwrap<{ url: string }>(await api.post('/products/upload-inline', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      const url = imageUrl(stored);
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch (err: any) {
      notifyError(err, M.richTextEditor.couldntUploadTheImage);
    } finally {
      setUploading(false);
    }
  }

  // ── Mode switching ───────────────────────────────────────────────────
  function enterHtmlMode() {
    if (!editor) return;
    setHtmlValue(editor.getHTML());
    setMode('html');
  }

  function exitHtmlMode() {
    if (!editor) return;
    editor.commands.setContent(htmlValue || '<p></p>', { emitUpdate: false });
    onChange(htmlValue === '<p></p>' ? '' : htmlValue);
    setMode('visual');
  }

  // ── Fullscreen — `Escape` exits ─────────────────────────────────────
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [fullscreen]);

  return (
    <div
      className={`rounded-lg border-2 border-[#e0e0e0] bg-white focus-within:border-brand-black transition-colors flex flex-col ${
        fullscreen
          ? 'fixed inset-4 md:inset-8 z-50 shadow-2xl overflow-hidden'
          : 'w-full overflow-clip'
      }`}
    >
      {/* Sticky header — keeps mode toggle + fullscreen + toolbar visible
          as the user scrolls past long article bodies. In normal mode it
          sticks to the PAGE viewport (sticky finds the page's scroll
          context); in fullscreen mode the editor's body is the scroll
          container and the header stays pinned at the top of the panel
          (sticky finds the inner scroll context).

          `overflow-clip` on the wrapper (vs. overflow-hidden) clips the
          rounded corners without creating a containing block that would
          break sticky's reach to the page scroll context. */}
      <div
        className={`${
          fullscreen ? '' : 'sticky top-0'
        } z-20 bg-default-50 border-b border-[#eee] shrink-0`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <div className="text-xs font-medium text-muted">
            Body
          </div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex bg-white rounded-md border border-default-200 p-0.5">
              <button
                type="button"
                onClick={() => mode === 'html' && exitHtmlMode()}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  mode === 'visual'
                    ? 'bg-brand-black text-white'
                    : 'text-default-600 hover:text-brand-black'
                }`}
              >
                Visual
              </button>
              <button
                type="button"
                onClick={() => mode === 'visual' && enterHtmlMode()}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  mode === 'html'
                    ? 'bg-brand-black text-white'
                    : 'text-default-600 hover:text-brand-black'
                }`}
              >
                HTML
              </button>
            </div>
            {showFullscreen && <button
              type="button"
              onClick={() => setFullscreen((f) => !f)}
              title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
              className="w-7 h-7 rounded grid place-items-center text-muted hover:bg-default-200/60 hover:text-brand-black transition"
            >
              {fullscreen ? <ShrinkIcon /> : <ExpandIcon />}
            </button>}
          </div>
        </div>

        {mode === 'visual' && (
          <Toolbar
            editor={editor}
            onPickImage={() => fileInputRef.current?.click()}
            uploadingImage={uploading}
          />
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleImagePick}
      />

      {/* Body wrapper.
            - Fullscreen: takes the remaining panel height, scrolls inside.
            - Normal: `resize-y` adds a drag handle at the bottom-right
              corner so the seller can grow / shrink the editor without
              opening fullscreen. `overflow-auto` is required for the
              resize handle to render in every browser. */}
      <div
        className={
          fullscreen
            ? 'flex-1 overflow-y-auto'
            : 'resize-y overflow-auto'
        }
        style={
          fullscreen
            ? undefined
            : { minHeight: `${minHeight}px`, height: `${minHeight}px` }
        }
      >
        {mode === 'visual' ? (
          <EditorContent editor={editor} className="rt-content" />
        ) : (
          <textarea
            value={htmlValue}
            onChange={(e) => {
              setHtmlValue(e.target.value);
              onChange(e.target.value);
            }}
            className="w-full h-full font-mono text-xs leading-relaxed px-3.5 py-3 outline-none resize-none"
            spellCheck={false}
            placeholder="<p>Write raw HTML here…</p>"
          />
        )}
      </div>

      {/* Scoped editor body styles. Re-declared from scratch so we don't
          depend on @tailwindcss/typography. */}
      <style jsx global>{`
        .rt-content .ProseMirror { outline: none; }
        .rt-content .ProseMirror p { margin: 0 0 0.5rem; }
        .rt-content .ProseMirror p:last-child { margin-bottom: 0; }
        .rt-content .ProseMirror h1 { font-size: 1.75rem; font-weight: 700; margin: 1rem 0 0.5rem; }
        .rt-content .ProseMirror h2 { font-size: 1.5rem; font-weight: 700; margin: 0.875rem 0 0.5rem; }
        .rt-content .ProseMirror h3 { font-size: 1.25rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
        .rt-content .ProseMirror h4 { font-size: 1.125rem; font-weight: 600; margin: 0.625rem 0 0.5rem; }
        .rt-content .ProseMirror ul { list-style: disc; padding-left: 1.25rem; margin: 0.5rem 0; }
        .rt-content .ProseMirror ol { list-style: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
        .rt-content .ProseMirror li { margin: 0.125rem 0; }
        .rt-content .ProseMirror li p { margin: 0; }
        .rt-content .ProseMirror strong { font-weight: 700; }
        .rt-content .ProseMirror em { font-style: italic; }
        .rt-content .ProseMirror u { text-decoration: underline; }
        .rt-content .ProseMirror s { text-decoration: line-through; }
        .rt-content .ProseMirror a { color: #141414; text-decoration: underline; }
        .rt-content .ProseMirror blockquote {
          border-left: 3px solid #e0e0e0;
          padding-left: 0.75rem;
          color: #575757;
          margin: 0.5rem 0;
        }
        .rt-content .ProseMirror pre {
          background: #141414;
          color: #f5f5f2;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.8125rem;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin: 0.75rem 0;
        }
        .rt-content .ProseMirror code:not(pre code) {
          background: #f3f4f2;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.85em;
          padding: 0.1em 0.35em;
          border-radius: 0.25rem;
        }
        .rt-content .ProseMirror hr {
          border: 0;
          border-top: 1px solid #e0e0e0;
          margin: 1rem 0;
        }
        .rt-content .ProseMirror .rt-image,
        .rt-content .ProseMirror img {
          display: block;
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 0.75rem 0;
          border: 1px solid #eee;
        }
        .rt-content .ProseMirror .rt-image.ProseMirror-selectednode,
        .rt-content .ProseMirror img.ProseMirror-selectednode {
          outline: 2px solid #141414;
          outline-offset: 2px;
        }
        /* Tables */
        .rt-content .ProseMirror .rt-table,
        .rt-content .ProseMirror table {
          border-collapse: collapse;
          margin: 0.75rem 0;
          overflow: hidden;
          table-layout: fixed;
          width: 100%;
        }
        .rt-content .ProseMirror table td,
        .rt-content .ProseMirror table th {
          border: 1px solid #e0e0e0;
          padding: 0.4rem 0.6rem;
          vertical-align: top;
        }
        .rt-content .ProseMirror table th {
          background: #f5f5f2;
          font-weight: 700;
          text-align: left;
        }
        .rt-content .ProseMirror table .selectedCell {
          background: rgba(20, 20, 20, 0.05);
        }
        /* Placeholder rendering — only on first empty paragraph. */
        .rt-content .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9a9aa1;
          pointer-events: none;
          height: 0;
        }
        /* Text alignment */
        .rt-content .ProseMirror [style*='text-align: center'] { text-align: center; }
        .rt-content .ProseMirror [style*='text-align: right'] { text-align: right; }
        .rt-content .ProseMirror [style*='text-align: justify'] { text-align: justify; }
      `}</style>
    </div>
  );
}

/* ──────────────────── Toolbar ──────────────────── */

function Toolbar({
  editor,
  onPickImage,
  uploadingImage,
}: {
  editor: Editor | null;
  onPickImage: () => void;
  uploadingImage: boolean;
}) {
  if (!editor) {
    return <div className="h-10 border-b border-[#eee] bg-default-50" />;
  }
  // Re-alias so the type narrowing survives into nested function
  // declarations like `setHeading` below — TypeScript's control-flow
  // analysis stops at function boundaries, so `editor` inside
  // setHeading would otherwise widen back to `Editor | null`.
  const ed: Editor = editor;

  // Active heading level for the dropdown's label
  const headingLevel =
    [1, 2, 3, 4].find((lvl) => ed.isActive('heading', { level: lvl })) || 0;
  const headingLabel = headingLevel === 0 ? 'Paragraph' : `Heading ${headingLevel}`;

  function setHeading(lvl: number) {
    if (lvl === 0) ed.chain().focus().setParagraph().run();
    else ed.chain().focus().toggleHeading({ level: lvl as 1 | 2 | 3 | 4 }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-[#eee] bg-default-50">
      {/* Heading dropdown */}
      <HeadingDropdown level={headingLevel} label={headingLabel} onPick={setHeading} />

      <Divider />

      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
        label="B"
        className="font-bold"
      />
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
        label="I"
        className="italic"
      />
      <ToolbarButton
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl+U)"
        label="U"
        className="underline"
      />
      <ToolbarButton
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
        label="S"
        className="line-through"
      />

      <Divider />

      {/* Text alignment */}
      <ToolbarButton
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        title="Align left"
        icon={<AlignLeftIcon />}
      />
      <ToolbarButton
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        title="Align center"
        icon={<AlignCenterIcon />}
      />
      <ToolbarButton
        active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        title="Align right"
        icon={<AlignRightIcon />}
      />
      <ToolbarButton
        active={editor.isActive({ textAlign: 'justify' })}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        title="Justify"
        icon={<AlignJustifyIcon />}
      />

      <Divider />

      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
        icon={<BulletIcon />}
      />
      <ToolbarButton
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
        icon={<OrderedIcon />}
      />

      <Divider />

      <ToolbarButton
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Quote"
        icon={<QuoteIcon />}
      />
      <ToolbarButton
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="Code block"
        icon={<CodeIcon />}
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
        icon={<HrIcon />}
      />

      <Divider />

      <ToolbarButton
        active={editor.isActive('link')}
        onClick={() => addOrEditLink(editor)}
        title="Add link"
        icon={<LinkIcon />}
      />
      <ToolbarButton
        onClick={onPickImage}
        title={uploadingImage ? 'Uploading…' : 'Insert image'}
        icon={uploadingImage ? <SpinnerIcon /> : <ImageIcon />}
        disabled={uploadingImage}
      />
      <TableButton editor={editor} />

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo"
        icon={<UndoIcon />}
        disabled={!editor.can().undo()}
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo"
        icon={<RedoIcon />}
        disabled={!editor.can().redo()}
      />

      <div className="ml-auto">
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          title="Clear formatting"
          icon={<EraserIcon />}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  active = false,
  onClick,
  title,
  label,
  icon,
  className = '',
  disabled = false,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  label?: string;
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={`inline-flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded text-sm transition ${
        active
          ? 'bg-brand-black text-white'
          : 'text-[#3a3a3a] hover:bg-default-200/60'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
    >
      {icon ?? label}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-default-200 mx-1" aria-hidden />;
}

/** Heading dropdown — pops a small menu with Paragraph / H1-H4.
 *  Closes on outside click and on Escape. */
function HeadingDropdown({
  level,
  label,
  onPick,
}: {
  level: number;
  label: string;
  onPick: (lvl: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const options: { lvl: number; label: string; className: string }[] = [
    { lvl: 0, label: 'Paragraph', className: 'text-sm' },
    { lvl: 1, label: 'Heading 1', className: 'text-lg font-bold' },
    { lvl: 2, label: 'Heading 2', className: 'text-base font-bold' },
    { lvl: 3, label: 'Heading 3', className: 'text-sm font-semibold' },
    { lvl: 4, label: 'Heading 4', className: 'text-sm font-semibold' },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 h-7 px-2 rounded text-[12px] font-semibold text-[#3a3a3a] bg-white border border-default-200 hover:border-default-400 transition"
      >
        {label}
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 min-w-[140px] bg-white border border-default-200 rounded-md shadow-lg z-30 py-1">
          {options.map((opt) => (
            <button
              key={opt.lvl}
              type="button"
              onClick={() => {
                onPick(opt.lvl);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 hover:bg-default-100 transition ${opt.className} ${
                opt.lvl === level ? 'bg-default-100 text-brand-black' : 'text-[#3a3a3a]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TableButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const inTable = editor.isActive('table');

  return (
    <div ref={ref} className="relative">
      <ToolbarButton
        active={inTable}
        onClick={() => setOpen((o) => !o)}
        title="Table"
        icon={<TableIcon />}
      />
      {open && (
        <div className="absolute left-0 top-full mt-1 min-w-[180px] bg-white border border-default-200 rounded-md shadow-lg z-30 py-1 text-[12px]">
          {!inTable ? (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-default-100 text-[#3a3a3a]"
            >
              Insert 3×3 table
            </button>
          ) : (
            <>
              <TableMenuItem label="Add row above" onClick={() => editor.chain().focus().addRowBefore().run()} />
              <TableMenuItem label="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()} />
              <TableMenuItem label="Add column left" onClick={() => editor.chain().focus().addColumnBefore().run()} />
              <TableMenuItem label="Add column right" onClick={() => editor.chain().focus().addColumnAfter().run()} />
              <div className="border-t border-default-100 my-1" />
              <TableMenuItem label="Delete row" onClick={() => editor.chain().focus().deleteRow().run()} />
              <TableMenuItem label="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()} />
              <TableMenuItem label="Toggle header row" onClick={() => editor.chain().focus().toggleHeaderRow().run()} />
              <div className="border-t border-default-100 my-1" />
              <TableMenuItem label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()} danger />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TableMenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-default-100 ${
        danger ? 'text-rose-600' : 'text-[#3a3a3a]'
      }`}
    >
      {label}
    </button>
  );
}

function addOrEditLink(editor: Editor) {
  const previous = editor.getAttributes('link').href as string | undefined;
  const next = window.prompt('Link URL (leave empty to remove)', previous || 'https://');
  if (next === null) return;
  if (next.trim() === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  const url = /^https?:\/\//i.test(next) ? next : `https://${next}`;
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

/* ────────── Inline SVG icons ────────── */

function BulletIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>; }
function OrderedIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></svg>; }
function LinkIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>; }
function QuoteIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3-.5 5-2.5 5-7v-7H3v7h3" /><path d="M14 21c3-.5 5-2.5 5-7v-7h-5v7h3" /></svg>; }
function UndoIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>; }
function RedoIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M21 13a9 9 0 1 1-3-7.7L21 8" /></svg>; }
function ImageIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>; }
function SpinnerIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.563" strokeLinecap="round" /></svg>; }
function AlignLeftIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></svg>; }
function AlignCenterIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="18" y1="18" x2="6" y2="18" /></svg>; }
function AlignRightIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>; }
function AlignJustifyIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="21" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="3" y2="18" /></svg>; }
function CodeIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>; }
function HrIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="4" y1="12" x2="20" y2="12" /></svg>; }
function TableIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="1" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>; }
function EraserIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16a2 2 0 0 1 0-2.83l9.17-9.17a2 2 0 0 1 2.83 0l5 5a2 2 0 0 1 0 2.83L11.17 20" /><line x1="22" y1="20" x2="14" y2="12" /></svg>; }
function ExpandIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>; }
function ShrinkIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>; }
function ChevronDownIcon({ className = 'w-3 h-3' }: { className?: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><polyline points="6 9 12 15 18 9" /></svg>; }
