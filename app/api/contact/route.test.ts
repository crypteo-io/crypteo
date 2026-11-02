import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { contactMessage: { create: vi.fn(async () => ({ id: "c1" })) } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), rateLimitScoped: vi.fn(), clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock("@/lib/mailer", () => ({ transporter: { sendMail: vi.fn() } }));
vi.mock("@/lib/notifications", () => ({ notifyAdmins: vi.fn() }));

import { prisma } from "@/lib/db";
import { notifyAdmins } from "@/lib/notifications";
import { rateLimitScoped } from "@/lib/rate-limit";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

function send(fields: Record<string, string>) {
  return POST(
    new NextRequest("https://app.example/api/contact", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.co", message: "ping", turnstileToken: "t", ...fields }),
    }),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/contact", () => {
  it("stores a probe-like message and labels it for admins (2026-10-29)", async () => {
    expect((await send({ name: "{{7*7}}" })).status).toBe(200);
    expect(prisma.contactMessage.create).toHaveBeenCalled();
    expect(notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/^Probe-like \(template injection\)/) }));
  });

  it("labels an ordinary message as a contact", async () => {
    await send({ name: "Jane" });
    expect(notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({ title: "Contact form: Jane" }));
  });

  it("stores nothing once the IP is over its hourly limit", async () => {
    mock(rateLimitScoped).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await send({ name: "Jane" })).status).toBe(429);
    expect(prisma.contactMessage.create).not.toHaveBeenCalled();
  });
});
