import { describe, expect, it } from "vitest";
import { detectNetwork, expiryState, formatNumber, luhnValid, maskNumber, normalizeExpiry } from "./card.ts";
import { deriveKey, seal, unlock, WrongPassphraseError } from "./vault.ts";

// published test numbers only
describe("card helpers", () => {
  it("detects networks", () => {
    expect(detectNetwork("4111 1111 1111 1111")).toBe("visa");
    expect(detectNetwork("5555555555554444")).toBe("mastercard");
    expect(detectNetwork("2223003122003222")).toBe("mastercard");
    expect(detectNetwork("378282246310005")).toBe("amex");
    expect(detectNetwork("6521 1500 0000 0000")).toBe("rupay");
    expect(detectNetwork("6011111111111117")).toBe("discover");
    expect(detectNetwork("3530111333300000")).toBe("jcb");
    expect(detectNetwork("9999")).toBe("other");
  });

  it("checks Luhn", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid("4111")).toBe(false);
  });

  it("formats and masks with the printed grouping", () => {
    expect(formatNumber("378282246310005")).toBe("3782 822463 10005");
    expect(maskNumber("4111111111111111")).toBe("•••• •••• •••• 1111");
    expect(maskNumber("378282246310005")).toBe("•••• •••••• •0005");
  });

  it("normalizes expiry and knows when it lapses", () => {
    expect(normalizeExpiry("729")).toBe("07/29");
    expect(normalizeExpiry("7")).toBe(null);
    expect(normalizeExpiry("0729")).toBe("07/29");
    expect(normalizeExpiry("7/2029")).toBe("07/29");
    expect(normalizeExpiry("13/29")).toBe(null);
    const now = new Date(2026, 10, 1);
    expect(expiryState("11/26", now)).toBe("soon");
    expect(expiryState("10/26", now)).toBe("expired");
    expect(expiryState("01/30", now)).toBe("ok");
  });
});

describe("vault", () => {
  it("round-trips and rejects a wrong passphrase", async () => {
    const vk = await deriveKey("correct horse", undefined, 100_000);
    const sealed = await seal({ cards: [{ cvv: "123" }] }, vk);
    expect(sealed.ct).not.toContain("123");
    expect((await unlock(sealed, "correct horse")).data).toEqual({ cards: [{ cvv: "123" }] });
    await expect(unlock(sealed, "wrong horse")).rejects.toBeInstanceOf(WrongPassphraseError);
    const again = await seal({ cards: [] }, vk);
    expect(again.iv).not.toBe(sealed.iv);
    expect(sealed.pin).toBeUndefined();
    expect((await seal({}, await deriveKey("123456789", undefined, 100_000))).pin).toBe(true);
    // a vault with a few MB of attachments seals and opens (used to overflow the call stack)
    const big = { files: ["x".repeat(3_000_000)] };
    expect((await unlock(await seal(big, vk), "correct horse")).data).toEqual(big);
  });
});

describe("id documents", () => {
  it("validates, masks and dates", async () => {
    const { validDocNumber, maskDocNumber, formatDocNumber, normalizeDate, mergeById } = await import("./doc.ts");
    expect(validDocNumber("aadhaar", "234567890123")).toBe(true);
    expect(validDocNumber("aadhaar", "134567890123")).toBe(false);
    expect(validDocNumber("pan", "ABCDE1234F")).toBe(true);
    expect(validDocNumber("pan", "ABCD1234F")).toBe(false);
    expect(formatDocNumber("aadhaar", "234567890123")).toBe("2345 6789 0123");
    expect(maskDocNumber("aadhaar", "234567890123")).toBe("XXXX XXXX 0123");
    expect(maskDocNumber("pan", "ABCDE1234F")).toBe("••••••234F");
    expect(normalizeDate("1/2/1990")).toBe("01/02/1990");
    expect(normalizeDate("31021990")).toBe(null);
    const merged = mergeById([{ id: "a", updatedAt: 1 }, { id: "b", updatedAt: 5 }], [{ id: "a", updatedAt: 3 }, { id: "c", updatedAt: 1 }]);
    expect(merged.map((x) => `${x.id}${x.updatedAt}`).sort()).toEqual(["a3", "b5", "c1"]);
  });
});
