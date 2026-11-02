import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  blogPost: { create: vi.fn() },
  adminAuditLog: { create: vi.fn() },
  blogPostVersion: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blogPost: { findMany: vi.fn() },
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
import { GET, POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ADMIN = { id: "cadmin0000000000000000001", email: "admin@x.co" };
const POST_ID = "cpost00000000000000000001";
const BODY = {
  title: "Hello world",
  slug: "hello-world",
  excerpt: "A first post",
  content: "## Hi\n\nBody",
};

function create(body: unknown) {
  return POST(
    new NextRequest("https://app.example/api/admin/blog", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mock(requireAdmin).mockResolvedValue({ admin: ADMIN });
  mock(prisma.$transaction).mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.blogPostVersion.findMany.mockResolvedValue([]);
  tx.blogPost.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: POST_ID,
    ...data,
  }));
});

describe("POST /api/admin/blog", () => {
  it("refuses a non-admin before writing anything", async () => {
    mock(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await create(BODY);
    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates a draft by default, authored by the admin, and audits it", async () => {
    const res = await create(BODY);
    expect(res.status).toBe(201);
    expect(tx.blogPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ...BODY,
          status: "draft",
          publishedAt: null,
          authorId: ADMIN.id,
        }),
      }),
    );
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        adminId: ADMIN.id,
        adminEmail: ADMIN.email,
        merchantId: POST_ID,
        action: "blog.create",
        details: { slug: "hello-world", status: "draft" },
      },
    });
  });

  it("stores rich text by default, records the first version and busts the blog cache", async () => {
    await create(BODY);
    expect(tx.blogPost.create.mock.calls[0][0].data.format).toBe("html");
    expect(tx.blogPostVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ postId: POST_ID, createdBy: ADMIN.id, event: "create", slug: "hello-world" }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).toHaveBeenCalledWith("/blog/hello-world");
    // The sitemap is rendered per request (app/sitemap.ts), so there is nothing to purge.
    expect(revalidatePath).not.toHaveBeenCalledWith("/sitemap.xml");
  });

  it("stamps publishedAt when created already published", async () => {
    await create({ ...BODY, status: "published" });
    const { data } = tx.blogPost.create.mock.calls[0][0];
    expect(data.status).toBe("published");
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it("answers a taken slug with 409 and a clear message", async () => {
    tx.blogPost.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );
    const res = await create(BODY);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/slug already exists/);
  });

  it("never sends a raw database error to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tx.blogPost.create.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const res = await create(BODY);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("ECONNREFUSED");
  });

  it("rejects an invalid slug or a script cover URL", async () => {
    expect((await create({ ...BODY, slug: "Not A Slug" })).status).toBe(400);
    expect((await create({ ...BODY, coverImageUrl: "javascript:alert(1)" })).status).toBe(400);
    expect(tx.blogPost.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/blog", () => {
  it("refuses a non-admin", async () => {
    mock(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(new NextRequest("https://app.example/api/admin/blog"));
    expect(res.status).toBe(401);
    expect(prisma.blogPost.findMany).not.toHaveBeenCalled();
  });

  it("lists drafts too, without bodies, bounded", async () => {
    mock(prisma.blogPost.findMany).mockResolvedValue([]);
    const res = await GET(new NextRequest("https://app.example/api/admin/blog"));
    expect(res.status).toBe(200);
    const args = mock(prisma.blogPost.findMany).mock.calls[0][0];
    expect(args.where).toBeUndefined();
    expect(args.take).toBeGreaterThan(0);
    expect(args.select.content).toBeUndefined();
  });
});
