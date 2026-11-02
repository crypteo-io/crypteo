"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { LocalDate } from "@/components/ui/LocalDate";
import { apiRequest } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PageHeader } from "./PageHeader";
import {
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export interface BlogPostRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string;
}

export function BlogPostsClient({
  posts: initial,
  siteOrigin,
}: {
  posts: BlogPostRow[];
  /** The public site, since this list is served on the admin host. */
  siteOrigin: string;
}) {
  const [posts, setPosts] = useState(initial);
  const [search, setSearch] = useState("");
  const confirm = useConfirm();

  const query = search.trim().toLowerCase();
  const visible = query
    ? posts.filter(
        (p) => p.title.toLowerCase().includes(query) || p.slug.includes(query),
      )
    : posts;

  const deletePost = async (post: BlogPostRow) => {
    const ok = await confirm({
      title: "Delete this post?",
      description:
        post.status === "published"
          ? `"${post.title}" is live. Deleting it takes it off the blog for good and its link will 404.`
          : `"${post.title}" will be deleted for good.`,
      confirmLabel: "Delete post",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await toast.promise(
        apiRequest(`/api/admin/blog/${post.id}`, { method: "DELETE" }),
        {
          loading: "Deleting post…",
          success: "Post deleted",
          error: "Post not deleted",
        },
      );
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } catch {
      // The toast already says why.
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Blog"
        subtitle={`Posts on crypteo.io/blog. ${posts.length} post${posts.length === 1 ? "" : "s"}.`}
        actions={
          <Link
            href="/blog/new"
            className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-deep"
          >
            <Plus size={16} /> New post
          </Link>
        }
      />

      <div className="frame">
        <div className="frame-inner overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-default-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-sky" aria-hidden />
              <h2 className="font-heading text-[16px] font-semibold text-default-950">
                All posts
              </h2>
            </div>
            <div className="group relative sm:w-72">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-default-400 transition-colors group-focus-within:text-sky"
                size={16}
              />
              <input
                type="text"
                placeholder="Search posts"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search posts"
                className="w-full rounded-xl border border-default-200 bg-white py-2.5 pl-10 pr-4 text-[14px] text-default-900 transition-colors focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left stack-table">
              <thead>
                <tr className="border-b border-default-200 bg-default-50">
                  {["Title", "Status", "Published", "Last edited", ""].map(
                    (h, i) => (
                      <th
                        key={h || i}
                        className={cn(
                          "px-5 py-3 text-[12px] font-medium text-default-500 sm:px-6",
                          i === 4 && "text-right",
                        )}
                      >
                        {h || <span className="sr-only">Actions</span>}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-default-100">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-24 text-center">
                      <div className="flex flex-col items-center">
                        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-default-50">
                          <FileText className="text-default-300" size={32} />
                        </div>
                        <p className="font-medium text-default-500">
                          {posts.length === 0
                            ? "No posts yet. Write the first one."
                            : "No posts match your search."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  visible.map((post) => (
                    <tr
                      key={post.id}
                      className="transition-colors hover:bg-default-50/80"
                    >
                      <td className="px-5 py-5">
                        <Link
                          href={`/blog/${post.id}`}
                          className="block max-w-[420px] truncate text-[14px] font-bold text-default-900 hover:text-brand"
                        >
                          {post.title}
                        </Link>
                        <p className="mt-0.5 max-w-[420px] truncate font-mono text-[12px] text-default-500">
                          /blog/{post.slug}
                        </p>
                      </td>
                      <td data-label="Status" className="px-5 py-5">
                        <StatusBadge status={post.status} />
                      </td>
                      <td data-label="Published" className="whitespace-nowrap px-5 py-5 text-[13px] font-medium text-default-500">
                        {post.publishedAt ? (
                          <LocalDate
                            value={post.publishedAt}
                            options={{
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }}
                          />
                        ) : (
                          "–"
                        )}
                      </td>
                      <td data-label="Last edited" className="whitespace-nowrap px-5 py-5 text-[13px] font-medium text-default-500">
                        <LocalDate value={post.updatedAt} withTime />
                      </td>
                      <td data-actions className="px-5 py-5">
                        <div className="flex items-center justify-end gap-1">
                          {post.status === "published" && (
                            <a
                              href={`${siteOrigin}/blog/${post.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              title="View on the blog"
                              className="rounded-lg p-2 text-default-500 transition-colors hover:bg-default-100 hover:text-default-900"
                            >
                              <ExternalLink size={16} />
                            </a>
                          )}
                          <Link
                            href={`/blog/${post.id}`}
                            title="Edit"
                            className="rounded-lg p-2 text-default-500 transition-colors hover:bg-default-100 hover:text-default-900"
                          >
                            <Pencil size={16} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => deletePost(post)}
                            title="Delete"
                            className="cursor-pointer rounded-lg p-2 text-default-500 transition-colors hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const published = status === "published";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium",
        published
          ? "border-accent-green/20 bg-accent-green/10 text-accent-green"
          : "border-default-200 bg-default-100 text-default-500",
      )}
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}
