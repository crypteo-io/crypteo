import { describe, expect, it } from "vitest";
import { credentialField } from "./auth.config";

describe("credentialField", () => {
  it("keeps a real value", () => {
    expect(credentialField("123456")).toBe("123456");
    expect(credentialField(" 123456 ")).toBe("123456");
  });

  it("treats what next-auth sends for a missing option as absent", () => {
    // signIn() posts options as form fields: undefined arrives as "undefined".
    for (const v of ["undefined", "null", "", "  ", undefined, null, 42]) expect(credentialField(v)).toBeUndefined();
  });
});
