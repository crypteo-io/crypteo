import { describe, expect, it } from "vitest";
import { MAX_TITLE, parseCommand, parsePayArgs } from "./commands";

describe("parseCommand", () => {
  it("reads a command and its arguments", () => {
    expect(parseCommand("/pay 25 Blue hoodie", "crypteo_bot")).toEqual({ name: "pay", args: "25 Blue hoodie" });
  });

  it("accepts a command addressed to this bot, in any case", () => {
    expect(parseCommand("/PAY@Crypteo_Bot 5", "crypteo_bot")).toEqual({ name: "pay", args: "5" });
  });

  it("ignores another bot's command and plain text", () => {
    expect(parseCommand("/pay@other_bot 5", "crypteo_bot")).toBeNull();
    expect(parseCommand("pay 5", "crypteo_bot")).toBeNull();
    expect(parseCommand(undefined, "crypteo_bot")).toBeNull();
  });
});

describe("parsePayArgs", () => {
  it("reads a price and a title", () => {
    expect(parsePayArgs("25.50 Blue  hoodie")).toEqual({ amount: 25.5, title: "Blue hoodie" });
    expect(parsePayArgs("$10")).toEqual({ amount: 10, title: "Payment" });
  });

  it("refuses anything that isn't a sensible USD price", () => {
    for (const args of ["", "free", "0", "-5 x", "1.999", "1e3", "NaN", "2000000"]) {
      expect(parsePayArgs(args), args).toBeNull();
    }
  });

  it("caps the title", () => {
    expect(parsePayArgs(`1 ${"a".repeat(500)}`)?.title).toHaveLength(MAX_TITLE);
  });
});
