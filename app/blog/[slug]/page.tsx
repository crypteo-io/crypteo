import { BlogCover, BlogPostCard } from "@/components/blog/BlogPostCard";
import { ButtonLink } from "@/components/site/Button";
import { JsonLd } from "@/components/site/JsonLd";
import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { renderPost } from "@/lib/blog/markdown";
import { isValidSlug } from "@/lib/blog/post";
import { formatPostDate, getPublishedPost, recentPublishedPosts } from "@/lib/blog/queries";
import { AlertTriangle, ArrowLeft, ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import { blogPostingJsonLd, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";

const RECENT_POSTS = 2;

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  return isValidSlug(slug) ? getPublishedPost(slug) : ({ ok: true, data: null } as const);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await load(slug);
  if (!result.ok) return { title: "Blog", robots: { index: false } };
  const post = result.data;
  if (!post) notFound();
  const base = pageMetadata({ title: post.title, description: post.excerpt, path: `/blog/${post.slug}` });
  // The share image is the post's generated card (opengraph-image.tsx):
  // cover images are WebP, which not every preview renders.
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: "article",
      publishedTime: post.publishedAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const result = await load(slug);

  if (!result.ok) {
    return (
      <SiteShell>
        <PageHero title="We couldn't load this post" subtitle="Something went wrong on our side. Please try again in a moment.">
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <ButtonLink href={`/blog/${slug}`} size="sm" icon={<AlertTriangle size={16} />}>
              Try again
            </ButtonLink>
            <ButtonLink href="/blog" variant="white" size="sm">
              Back to the blog
            </ButtonLink>
          </div>
        </PageHero>
      </SiteShell>
    );
  }
  const post = result.data;
  if (!post) notFound();

  const html = renderPost(post);
  const recent = await recentPublishedPosts(post.slug, RECENT_POSTS);

  return (
    <SiteShell>
      <JsonLd
        data={[
          blogPostingJsonLd(post),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
        ]}
      />
      <PageHero
        title={post.title}
        subtitle={post.excerpt}
        eyebrow={
          <div className="inline-flex flex-wrap items-center justify-center gap-3 text-default-700">
            <time dateTime={post.publishedAt.toISOString()}>{formatPostDate(post.publishedAt)}</time>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-default-200 bg-linear-to-b from-default-100 to-transparent px-2.5 py-1 text-sm">
              <Clock size={14} /> {post.readingMinutes} min read
            </span>
          </div>
        }
      />

      <article className="relative pb-20">
        <div className="container-site max-w-245!">
          <Link
            href="/blog"
            className="mb-8 inline-flex items-center gap-2 font-medium text-default-700 hover:text-sky"
          >
            <ArrowLeft size={18} /> Back to blog
          </Link>
          {post.coverImageUrl && (
            <div className="mb-12.5 aspect-video overflow-hidden rounded-2xl border border-default-200">
              <BlogCover post={post} />
            </div>
          )}
          <div className="prose-site" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </article>

      <section className="pb-20">
        <div className="container-site max-w-245!">
          <div className="frame">
            <div className="frame-inner flex flex-col items-start gap-6 p-7 md:flex-row md:items-center md:justify-between md:p-10">
              <div>
                <h2 className="mb-2 text-[28px] leading-tight md:text-[32px]">Get paid straight to your own wallet</h2>
                <p className="text-default-600">
                  Non-custodial crypto payments with no processor in the middle. Set up in minutes.
                </p>
              </div>
              <ButtonLink href="/register" className="shrink-0" icon={<ArrowRight size={18} />}>
                Create your account
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="pb-20 md:pb-28">
          <div className="container-site">
            <h2 className="mb-8 text-center text-4xl md:mb-12 lg:text-[44px]">Keep reading</h2>
            <div className="grid gap-7.5 md:grid-cols-2">
              {recent.map((p) => (
                <BlogPostCard key={p.slug} post={p} />
              ))}
            </div>
          </div>
        </section>
      )}
    </SiteShell>
  );
}
