import { describe, expect, test } from "bun:test";
import { availabilityOf, LOCK_GRACE_MS, locksOnReturn } from "../../src/features/lock/logic";

describe("app lock (ADR 0220)", () => {
  test("the grace is one minute", () => {
    expect(LOCK_GRACE_MS).toBe(60_000);
  });

  test("never left the front: no lock", () => {
    expect(locksOnReturn(null, 1_000_000)).toBe(false);
  });

  test("back within the grace opens as it was; at or past it, locks", () => {
    const left = 1_000_000;
    expect(locksOnReturn(left, left)).toBe(false);
    expect(locksOnReturn(left, left + LOCK_GRACE_MS - 1)).toBe(false);
    expect(locksOnReturn(left, left + LOCK_GRACE_MS)).toBe(true);
    expect(locksOnReturn(left, left + 10 * LOCK_GRACE_MS)).toBe(true);
  });

  test("a clock that went backwards locks", () => {
    expect(locksOnReturn(1_000_000, 999_999)).toBe(true);
  });

  test("another grace is honored", () => {
    expect(locksOnReturn(0, 4_999, 5_000)).toBe(false);
    expect(locksOnReturn(0, 5_000, 5_000)).toBe(true);
  });

  test("the enrolled level maps to what the phone can prove", () => {
    // expo-local-authentication's SecurityLevel: NONE 0, SECRET 1, BIOMETRIC_WEAK 2, BIOMETRIC_STRONG 3.
    expect(availabilityOf(0)).toBe("none");
    expect(availabilityOf(1)).toBe("credential");
    expect(availabilityOf(2)).toBe("biometrics");
    expect(availabilityOf(3)).toBe("biometrics");
    expect(availabilityOf(-1)).toBe("none");
  });
});
