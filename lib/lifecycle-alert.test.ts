import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSync } = vi.hoisted(() => ({ existsSync: vi.fn() }));
vi.mock("fs", async (orig) => ({ ...(await orig<typeof import("fs")>()), existsSync }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

import { sendLifecycleAlert } from "./admin-alerts";
import { sendEmail } from "./mailer";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAILS = "ops@example.com";
});

describe("sendLifecycleAlert", () => {
  it("stays quiet while deploy.sh's planned-restart marker exists", async () => {
    existsSync.mockReturnValue(true);
    expect(await sendLifecycleAlert("Worker Shutting Down", "<p>x</p>")).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(existsSync.mock.calls[0][0]).toMatch(/\.deploy-state[\\/]planned$/);
  });

  it("emails admins about any other restart", async () => {
    existsSync.mockReturnValue(false);
    expect(await sendLifecycleAlert("Worker Shutting Down", "<p>x</p>")).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ops@example.com" }));
  });
});
