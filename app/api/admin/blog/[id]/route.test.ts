import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  blogPost: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  adminAuditLog: { create: vi.fn() },
  blogPostVersion: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blogPost: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin")>()),
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { DELETE, GET, PATCH } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ID = "cpost00000000000000000001";
const ADMIN = { id: "cadmin0000000000000000001", email: "admin@x.co" };
const FIRST_PUBLISHED = new Date("2026-01-01T00:00:00Z");

function patch(body: unknown, id = ID) {
  return PATCH(
    new NextRequest(`https://app.example/api/admin/blog/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function del(id = ID) {
  return DELETE(new NextRequest(`https://app.example/api/admin/blog/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mock(requireAdmin).mockResolvedValue({ admin: ADMIN });
  mock(prisma.$transaction).mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.blogPostVersion.findMany.mockResolvedValue([]);
  tx.blogPost.findUnique.mockResolvedValue({ status: "draft", publishedAt: null, slug: "hello", title: "Hello" });
  tx.blogPost.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: ID,
    slug: "hello",
    ...data,
  }));
});

describe("PATCH /api/admin/blog/[id]", () => {
  it("refuses a non-admin before reading anything", async () => {
    mock(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await patch({ status: "published" });
    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("stamps publishedAt the first time a post is published, and audits it", async () => {
    const res = await patch({ status: "published" });
    expect(res.status).toBe(200);
    const { data } = tx.blogPost.update.mock.calls[0][0];
    expect(data.status).toBe("published");
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: ID,
        action: "blog.update",
        details: { slug: "hello", fields: ["status"], status: "published" },
      }),
    });
  });

  it("records a publish version and busts both the old and new URL on a rename", async () => {
    tx.blogPost.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: ID,
      slug: "renamed",
      title: "Hello",
      excerpt: "x",
      content: "<p>x</p>",
      format: "html",
      coverImageUrl: null,
      ...data,
    }));
    const res = await patch({ status: "published", slug: "renamed" });
    expect(res.status).toBe(200);
    expect(tx.blogPostVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ postId: ID, event: "publish", slug: "renamed", createdBy: ADMIN.id }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/blog/hello");
    expect(revalidatePath).toHaveBeenCalledWith("/blog/renamed");
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
  });

  it("trims versions past the cap in the same transaction", async () => {
    tx.blogPostVersion.findMany.mockResolvedValue([{ id: "old1" }, { id: "old2" }]);
    await patch({ title: "New title" });
    expect(tx.blogPostVersion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old1", "old2"] } } });
  });

  it("keeps the original publishedAt when unpublishing and re-publishing", async () => {
    tx.blogPost.findUnique.mockResolvedValue({ status: "published", publishedAt: FIRST_PUBLISHED });
    await patch({ status: "draft" });
    expect(tx.blogPost.update.mock.calls[0][0].data.publishedAt).toBe(FIRST_PUBLISHED);

    tx.blogPost.findUnique.mockResolvedValue({ status: "draft", publishedAt: FIRST_PUBLISHED });
    await patch({ status: "published" });
    expect(tx.blogPost.update.mock.calls[1][0].data.publishedAt).toBe(FIRST_PUBLISHED);
  });

  it("an edit to a draft doesn't publish it", async () => {
    await patch({ title: "New title" });
    const { data } = tx.blogPost.update.mock.calls[0][0];
    expect(data).toEqual({ title: "New title", publishedAt: null });
  });

  it("answers a taken slug with 409", async () => {
    tx.blogPost.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );
    const res = await patch({ slug: "taken" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/slug already exists/);
  });

  it("404s an unknown post without writing an audit row", async () => {
    tx.blogPost.findUnique.mockResolvedValue(null);
    expect((await patch({ title: "x" })).status).toBe(404);
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed id and an empty update", async () => {
    expect((await patch({ title: "x" }, "../etc")).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });
});

describe("GET /api/admin/blog/[id]", () => {
  it("refuses a non-admin", async () => {
    mock(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET(new NextRequest(`https://app.example/api/admin/blog/${ID}`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(403);
    expect(prisma.blogPost.findUnique).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/blog/[id]", () => {
  it("refuses a non-admin", async () => {
    mock(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    expect((await del()).status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the post and audits it in the same transaction", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(tx.blogPost.delete).toHaveBeenCalledWith({ where: { id: ID } });
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: ID,
        action: "blog.delete",
        details: { slug: "hello", title: "Hello" },
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/blog/hello");
  });

  it("404s an unknown post", async () => {
    tx.blogPost.findUnique.mockResolvedValue(null);
    expect((await del()).status).toBe(404);
    expect(tx.blogPost.delete).not.toHaveBeenCalled();
  });
});
