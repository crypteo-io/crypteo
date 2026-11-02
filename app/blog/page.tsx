import { BlogPostCard } from "@/components/blog/BlogPostCard";
import { ButtonLink } from "@/components/site/Button";
import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { parseBlogPage } from "@/lib/blog/post";
import { listPublishedPosts } from "@/lib/blog/queries";
import { AlertTriangle, ChevronLeft, ChevronRight, Newspaper } from "lucide-react";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

const DESCRIPTION =
  "Guides on non-custodial crypto payments: self-custody wallets, getting paid without a processor that can block you, and running a store on crypto.";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}): Promise<Metadata> {
  const page = parseBlogPage((await searchParams).page);
  return pageMetadata({
    title: page > 1 ? `Crypto Payments Blog (page ${page})` : "Crypto Payments Blog",
    description: DESCRIPTION,
    path: page > 1 ? `/blog?page=${page}` : "/blog",
  });
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parseBlogPage((await searchParams).page);
  const result = await listPublishedPosts(page);

  return (
    <SiteShell>
      <PageHero
        title="Crypteo blog"
        subtitle="Practical notes on taking crypto payments into a wallet you control."
      />
      <section className="relative z-20 pb-20 md:pb-28">
        <div className="container-site">
          {!result.ok ? (
            <Notice
              icon={<AlertTriangle size={22} />}
              title="We couldn't load the blog"
              body="Something went wrong on our side. Please try again in a moment."
              action={
                <ButtonLink href={page > 1 ? `/blog?page=${page}` : "/blog"} size="sm">
                  Try again
                </ButtonLink>
              }
            />
          ) : result.data.posts.length === 0 ? (
            page > 1 ? (
              <Notice
                icon={<Newspaper size={22} />}
                title="No posts on this page"
                body="This page is past the last post."
                action={
                  <ButtonLink href="/blog" size="sm">
                    Back to the first page
                  </ButtonLink>
                }
              />
            ) : (
              <Notice
                icon={<Newspaper size={22} />}
                title="No posts yet"
                body="The first articles are on their way. In the meantime, the FAQ covers how non-custodial payments work."
                action={
                  <ButtonLink href="/faq" size="sm">
                    Read the FAQ
                  </ButtonLink>
                }
              />
            )
          ) : (
            <>
              <div className="grid gap-7.5 md:grid-cols-2">
                {result.data.posts.map((post) => (
                  <BlogPostCard key={post.slug} post={post} />
                ))}
              </div>
              {result.data.totalPages > 1 && (
                <Pagination page={page} totalPages={result.data.totalPages} />
              )}
            </>
          )}
        </div>
      </section>
    </SiteShell>
  );
}

function Notice({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="frame mx-auto max-w-xl">
      <div className="frame-inner flex flex-col items-center p-8 text-center md:p-12">
        <span className="icon-tile mb-5 size-12">{icon}</span>
        <h2 className="mb-3 text-2xl">{title}</h2>
        <p className="mb-6 text-default-600">{body}</p>
        {action}
      </div>
    </div>
  );
}

function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const link =
    "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-medium text-white transition-colors hover:bg-primary-deep";
  const href = (p: number) => (p === 1 ? "/blog" : `/blog?page=${p}`);
  return (
    <nav aria-label="Blog pages" className="mt-10 grid grid-cols-3 items-center gap-4 lg:mt-12.5">
      <div>
        {page > 1 && (
          <Link href={href(page - 1)} className={link} rel="prev">
            <ChevronLeft size={18} /> Previous
          </Link>
        )}
      </div>
      <p className="text-center text-default-600">
        {Math.min(page, totalPages)} / {totalPages}
      </p>
      <div>
        {page < totalPages && (
          <Link href={href(page + 1)} className={link} rel="next">
            Next <ChevronRight size={18} />
          </Link>
        )}
      </div>
    </nav>
  );
}
