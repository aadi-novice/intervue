import { describe, expect, it } from "vitest";
import { isPasswordValid, passwordRules } from "@/lib/password";

const met = (pw: string) => Object.fromEntries(passwordRules(pw).map((r) => [r.id, r.met]));

describe("password rules", () => {
  it("flags each rule independently", () => {
    expect(met("")).toEqual({ length: false, letter: false, digit: false });
    expect(met("abcdefghij")).toEqual({ length: true, letter: true, digit: false });
    expect(met("1234567890")).toEqual({ length: true, letter: false, digit: true });
    expect(met("abc123")).toEqual({ length: false, letter: true, digit: true });
  });

  it("accepts 10+ chars with letters and digits only", () => {
    expect(isPasswordValid("abcde12345")).toBe(true);
    expect(isPasswordValid("abcde1234")).toBe(false);
    expect(isPasswordValid("abcdefghij")).toBe(false);
    expect(isPasswordValid("1234567890")).toBe(false);
  });
});
