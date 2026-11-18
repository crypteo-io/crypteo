import { describe, expect, it } from "vitest";
import {
  adminSuspensionLabel,
  merchantSuspensionLine,
  SUSPENSION_AUTOMATIC,
  SUSPENSION_REASONS,
} from "./suspension-reasons";

describe("suspension reasons", () => {
  it("never tells the merchant which rule tripped", () => {
    for (const r of SUSPENSION_REASONS) {
      expect(r.merchantLine, r.key).not.toMatch(/sql|inject|probe|score|threshold|ip address|signal|email address/i);
    }
  });

  it("gives an automatic suspension and unknown keys the generic line", () => {
    const generic = merchantSuspensionLine("other");
    expect(merchantSuspensionLine(SUSPENSION_AUTOMATIC)).toBe(generic);
    expect(merchantSuspensionLine("nonsense")).toBe(generic);
    expect(merchantSuspensionLine("fraud")).not.toBe(generic);
  });

  it("shows admins the label, and the note for Other", () => {
    expect(adminSuspensionLabel("other", "Chargeback ring")).toBe("Other: Chargeback ring");
    expect(adminSuspensionLabel(SUSPENSION_AUTOMATIC)).toMatch(/automatically/);
    expect(adminSuspensionLabel("fraud")).toBe("Suspected fraud or scam");
  });
});
