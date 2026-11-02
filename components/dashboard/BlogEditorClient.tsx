"use client";

import { MediaGallery } from "@/components/blog/MediaGallery";
import { RichTextEditor } from "@/components/blog/RichTextEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { RelativeTime } from "@/components/dashboard/RelativeTime";
import { apiRequest } from "@/lib/api-client";
import {
  MAX_EXCERPT_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TITLE_LENGTH,
  readingTimeMinutes,
  slugify,
  type BlogStatus,
} from "@/lib/blog/post";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Eye,
  History,
  ImagePlus,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "./BlogPostsClient";

export interface EditablePost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** Always HTML here: a Markdown post is rendered to HTML before it reaches the editor. */
  content: string;
  coverImageUrl: string | null;
  status: string;
  updatedAt: string;
  /** The post was written in Markdown; saving converts it to rich text. */
  fromMarkdown?: boolean;
}

interface VersionRow {
  id: string;
  createdAt: string;
  event: "create" | "save" | "publish" | "unpublish";
  title: string;
  status: string;
  author: string;
}

interface VersionFull {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  format: string;
  coverImageUrl: string | null;
}

const EVENT_LABEL: Record<VersionRow["event"], string> = {
  create: "Created",
  save: "Saved",
  publish: "Published",
  unpublish: "Unpublished",
};

const LABEL = "mb-1.5 block text-[13px] font-medium text-default-700";

type Draft = { title: string; slug: string; excerpt: string; content: string; coverImageUrl: string };

const snapshot = (d: Draft) => JSON.stringify(d);

export function BlogEditorClient({
  post,
  siteOrigin,
}: {
  post?: EditablePost;
  /** The public site: the editor is served on the admin host, where /blog/<x> is this editor. */
  siteOrigin: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const initial: Draft = useMemo(
    () => ({
      title: post?.title ?? "",
      slug: post?.slug ?? "",
      excerpt: post?.excerpt ?? "",
      content: post?.content ?? "",
      coverImageUrl: post?.coverImageUrl ?? "",
    }),
    [post],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(initial));
  const [savedAt, setSavedAt] = useState<string | null>(post?.updatedAt ?? null);
  const [status, setStatus] = useState<BlogStatus>(post?.status === "published" ? "published" : "draft");
  // A new post's slug follows the title until the admin types one; an existing
  // post's slug never moves on its own, since that would break its live URL.
  const [slugTouched, setSlugTouched] = useState(Boolean(post));
  const [saving, setSaving] = useState<BlogStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; html: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [gallery, setGallery] = useState<null | "content" | "cover">(null);
  const galleryResolve = useRef<((image: { url: string; alt: string } | null) => void) | null>(null);
  const [versionsKey, setVersionsKey] = useState(0);

  const dirty = snapshot(draft) !== savedSnapshot;
  const published = status === "published";
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Leaving with unsaved changes asks first (tab close, reload, external nav).
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const save = useCallback(
    async (nextStatus: BlogStatus) => {
      setError(null);
      setSaving(nextStatus);
      const body = { ...draft, format: "html" as const, status: nextStatus };
      try {
        if (post) {
          const { post: updated } = await apiRequest<{ post: { updatedAt: string } }>(`/api/admin/blog/${post.id}`, {
            method: "PATCH",
            body,
          });
          const verb = nextStatus === status ? (published ? "updated" : "saved") : nextStatus === "published" ? "published" : "unpublished";
          setStatus(nextStatus);
          setSavedSnapshot(snapshot(draft));
          setSavedAt(updated.updatedAt);
          setVersionsKey((k) => k + 1);
          toast.success(
            `Post ${verb}`,
            nextStatus === "published" ? "The live page shows this version now." : undefined,
          );
          router.refresh();
        } else {
          const { post: created } = await apiRequest<{ post: { id: string } }>("/api/admin/blog", {
            method: "POST",
            body,
          });
          setSavedSnapshot(snapshot(draft));
          toast.success(nextStatus === "published" ? "Post published" : "Draft saved");
          router.replace(`/blog/${created.id}`);
        }
      } catch (err) {
        const message = errorMessage(err, "The post wasn't saved.");
        setError(message);
        toast.error("Post not saved", message);
      } finally {
        setSaving(null);
      }
    },
    [draft, post, published, router, status],
  );

  // ⌘S / Ctrl+S saves without changing the status.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) void save(status);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, saving, status]);

  const renderPreview = async (content: string, format: string) =>
    (await apiRequest<{ html: string }>("/api/admin/blog/preview", { method: "POST", body: { content, format } })).html;

  const openPreview = async () => {
    setPreviewing(true);
    try {
      setPreview({ title: draft.title || "Untitled post", html: await renderPreview(draft.content, "html") });
    } catch (err) {
      toast.error("Preview failed", errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  };

  const pickImage = (target: "content" | "cover") =>
    new Promise<{ url: string; alt: string } | null>((resolve) => {
      galleryResolve.current = resolve;
      setGallery(target);
    });

  const closeGallery = (image: { url: string; alt: string } | null) => {
    galleryResolve.current?.(image);
    galleryResolve.current = null;
    setGallery(null);
  };

  const restoreVersion = async (v: VersionFull) => {
    const ok = await confirm({
      title: "Restore this version?",
      description:
        "Its title, URL, excerpt, cover and content replace what's in the editor. Nothing is saved until you save, and the current state stays in the history.",
      confirmLabel: "Restore into editor",
    });
    if (!ok) return;
    const content = v.format === "html" ? v.content : await renderPreview(v.content, v.format);
    setDraft({ title: v.title, slug: v.slug, excerpt: v.excerpt, content, coverImageUrl: v.coverImageUrl ?? "" });
    setSlugTouched(true);
    toast.success("Version restored into the editor", "Save to make it current.");
  };

  const deletePost = async () => {
    if (!post) return;
    const ok = await confirm({
      title: "Delete this post?",
      description: published
        ? `"${draft.title}" is live. Deleting it takes it off the blog for good and its link will 404.`
        : `"${draft.title}" and its version history will be deleted for good.`,
      confirmLabel: "Delete post",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await toast.promise(apiRequest(`/api/admin/blog/${post.id}`, { method: "DELETE" }), {
        loading: "Deleting post…",
        success: "Post deleted",
        error: "Post not deleted",
      });
      setSavedSnapshot(snapshot(draft));
      router.push("/blog");
    } catch {
      // The toast already says why.
    }
  };

  const busy = saving !== null;
  const minutes = readingTimeMinutes(draft.content);

  return (
    <div className="-mx-4 -mt-4 pb-16 md:-mx-8 md:-mt-8">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-20 border-b border-default-200 bg-white/90 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <Link
            href="/blog"
            aria-label="Back to posts"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-default-200 bg-white text-default-500 transition-colors hover:bg-default-50 hover:text-default-950"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-[18px] font-semibold text-default-950">{post ? "Edit post" : "New post"}</h1>
              {post && <StatusBadge status={status} />}
            </div>
            <p className="text-[12px] text-default-500" aria-live="polite">
              {busy ? (
                "Saving…"
              ) : dirty ? (
                <span className="font-medium text-accent-orange">Unsaved changes</span>
              ) : savedAt ? (
                <>
                  Saved <RelativeTime value={savedAt} />
                </>
              ) : (
                "Not saved yet"
              )}
              {" · "}
              {minutes} min read
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TopButton onClick={() => void openPreview()} disabled={previewing}>
              {previewing ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} Preview
            </TopButton>
            {post && published && (
              <a
                href={`${siteOrigin}/blog/${post.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-default-200 bg-white px-3.5 text-[13px] font-semibold text-default-800 hover:bg-default-50"
              >
                <ExternalLink size={15} /> View live
              </a>
            )}
            {published ? (
              <>
                <TopButton onClick={() => void save("draft")} disabled={busy}>
                  <Undo2 size={15} /> Unpublish
                </TopButton>
                <PrimaryButton onClick={() => void save("published")} disabled={busy || !dirty} busy={saving === "published"}>
                  <Save size={15} /> Update
                </PrimaryButton>
              </>
            ) : (
              <>
                <TopButton onClick={() => void save("draft")} disabled={busy}>
                  {saving === "draft" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save draft
                </TopButton>
                <PrimaryButton onClick={() => void save("published")} disabled={busy} busy={saving === "published"}>
                  <Send size={15} /> Publish
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-6 md:px-8 md:pt-8">
        {error && (
          <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-xl border border-accent-red/20 bg-accent-red/5 p-3.5 text-[14px] text-accent-red">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}
        {post?.fromMarkdown && (
          <div className="mb-5 rounded-xl border border-sky/20 bg-sky/5 p-3.5 text-[13px] text-default-700">
            This post was written in Markdown. It&apos;s shown here as rich text, and saving stores it that way.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
          {/* ── Writing column ── */}
          <div className="min-w-0 space-y-4">
            <textarea
              value={draft.title}
              onChange={(e) => {
                set("title", e.target.value);
                if (!slugTouched) set("slug", slugify(e.target.value));
              }}
              maxLength={MAX_TITLE_LENGTH}
              rows={1}
              placeholder="Post title"
              aria-label="Title"
              className="field-sizing-content w-full resize-none bg-transparent font-heading text-[30px] font-semibold leading-tight tracking-[-0.02em] text-default-950 placeholder:text-default-300 focus:outline-none md:text-[40px]"
            />
            <RichTextEditor
              value={draft.content}
              onChange={(html) => set("content", html)}
              onRequestImage={() => pickImage("content")}
            />
          </div>

          {/* ── Settings sidebar ── */}
          {/* Scrolls on its own when taller than the window, so the history and
              delete stay reachable while the post is long. */}
          <aside className="space-y-5 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:pb-2">
            <Panel title="Post settings">
              <div>
                <label htmlFor="post-slug" className={LABEL}>
                  URL
                </label>
                <div className="flex h-11 items-center overflow-hidden rounded-xl border border-default-200 bg-white focus-within:border-primary">
                  <span className="shrink-0 pl-3 text-[13px] text-default-400">/blog/</span>
                  <input
                    id="post-slug"
                    value={draft.slug}
                    maxLength={MAX_SLUG_LENGTH}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set("slug", e.target.value.toLowerCase());
                    }}
                    className="h-full min-w-0 flex-1 bg-transparent pr-3 font-mono text-[13px] text-default-900 focus:outline-none"
                  />
                </div>
                {post && published && draft.slug !== post.slug && (
                  <p className="mt-1.5 text-[12px] text-accent-orange">Changing the URL breaks links to the current one.</p>
                )}
              </div>
              <div>
                <label htmlFor="post-excerpt" className={LABEL}>
                  Excerpt
                </label>
                <textarea
                  id="post-excerpt"
                  value={draft.excerpt}
                  onChange={(e) => set("excerpt", e.target.value)}
                  maxLength={MAX_EXCERPT_LENGTH}
                  rows={4}
                  placeholder="One or two sentences shown on the blog list and in search results."
                  className="w-full resize-y rounded-xl border border-default-200 bg-white px-3.5 py-2.5 text-[14px] text-default-900 placeholder:text-default-400 focus:border-primary focus:outline-none"
                />
                <p className="mt-1 text-right text-[11px] text-default-400">
                  {draft.excerpt.length}/{MAX_EXCERPT_LENGTH}
                </p>
              </div>
              <div>
                <p className={LABEL}>Cover image</p>
                {draft.coverImageUrl ? (
                  <div className="overflow-hidden rounded-xl border border-default-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draft.coverImageUrl} alt="" className="aspect-video w-full object-cover" />
                    <div className="flex divide-x divide-default-200 border-t border-default-200">
                      <button
                        type="button"
                        onClick={async () => {
                          const image = await pickImage("cover");
                          if (image) set("coverImageUrl", image.url);
                        }}
                        className="flex-1 py-2 text-[13px] font-medium text-default-700 hover:bg-default-50"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => set("coverImageUrl", "")}
                        className="flex-1 py-2 text-[13px] font-medium text-default-700 hover:bg-red-50 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const image = await pickImage("cover");
                      if (image) set("coverImageUrl", image.url);
                    }}
                    className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-default-300 bg-default-50 text-[13px] font-medium text-default-500 hover:bg-default-100"
                  >
                    <ImagePlus size={20} /> Choose from gallery
                  </button>
                )}
              </div>
            </Panel>

            {post && (
              <VersionsPanel
                key={versionsKey}
                postId={post.id}
                onPreview={async (v) => setPreview({ title: v.title, html: await renderPreview(v.content, v.format) })}
                onRestore={restoreVersion}
              />
            )}

            {post && (
              <button
                type="button"
                onClick={() => void deletePost()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-default-200 bg-white py-2.5 text-[13px] font-semibold text-default-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={15} /> Delete post
              </button>
            )}
          </aside>
        </div>
      </div>

      <MediaGallery
        open={gallery !== null}
        title={gallery === "cover" ? "Choose a cover image" : "Insert an image"}
        selectLabel={gallery === "cover" ? "Use as cover" : "Insert image"}
        onClose={() => closeGallery(null)}
        onSelect={(image) => closeGallery(image)}
      />

      {preview && (
        <Modal title="Preview" subtitle="Rendered by the same sanitiser as the live page." onClose={() => setPreview(null)} className="max-w-3xl">
          <div className="mt-4 max-h-[70dvh] overflow-y-auto rounded-xl border border-default-200 bg-white p-6">
            <h1 className="mb-6 text-[32px] leading-tight">{preview.title}</h1>
            <div className="prose-site" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function VersionsPanel({
  postId,
  onPreview,
  onRestore,
}: {
  postId: string;
  onPreview: (v: VersionFull) => Promise<void>;
  onRestore: (v: VersionFull) => Promise<void>;
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let live = true;
    apiRequest<{ versions: VersionRow[] }>(`/api/admin/blog/${postId}/versions`)
      .then(({ versions }) => live && setRows(versions))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [postId]);

  const withVersion = async (id: string, fn: (v: VersionFull) => Promise<void>) => {
    setBusyId(id);
    try {
      const { version } = await apiRequest<{ version: VersionFull }>(`/api/admin/blog/${postId}/versions/${id}`);
      await fn(version);
    } catch (err) {
      toast.error("Version not loaded", errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const shown = rows ? (showAll ? rows : rows.slice(0, 6)) : [];

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <History size={15} className="text-default-500" /> Version history
        </span>
      }
    >
      {failed && <p className="text-[13px] text-accent-red">The history didn&apos;t load. Reload the page to try again.</p>}
      {!failed && rows === null && <p className="text-[13px] text-default-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-[13px] text-default-500">Each save is kept here.</p>}
      {shown.length > 0 && (
        <ol className="-mx-1 space-y-0.5">
          {shown.map((v, i) => (
            <li key={v.id} className="group flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-default-50">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  v.event === "publish" ? "bg-accent-green" : v.event === "unpublish" ? "bg-accent-orange" : "bg-default-300",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-default-900">
                  {EVENT_LABEL[v.event]}
                  {i === 0 && <span className="ml-1.5 text-[11px] font-normal text-default-500">current</span>}
                </p>
                <p className="truncate text-[11px] text-default-500">
                  <RelativeTime value={v.createdAt} /> · {v.author}
                </p>
              </div>
              {busyId === v.id ? (
                <Loader2 size={14} className="animate-spin text-default-400" />
              ) : (
                <div className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <IconButton label="Preview this version" onClick={() => void withVersion(v.id, onPreview)}>
                    <Eye size={14} />
                  </IconButton>
                  {i > 0 && (
                    <IconButton label="Restore this version" onClick={() => void withVersion(v.id, onRestore)}>
                      <RotateCcw size={14} />
                    </IconButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {rows && rows.length > 6 && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="text-[12px] font-semibold text-sky hover:underline">
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </Panel>
  );
}

function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="frame">
      <div className="frame-inner space-y-4 p-4">
        <h2 className="font-heading text-[15px] font-semibold text-default-950">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function TopButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-default-200 bg-white px-3.5 text-[13px] font-semibold text-default-800 transition-colors hover:bg-default-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-white shadow-aigocy-dark transition-colors hover:bg-primary-deep disabled:opacity-50"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md text-default-500 hover:bg-white hover:text-default-950"
    >
      {children}
    </button>
  );
}

