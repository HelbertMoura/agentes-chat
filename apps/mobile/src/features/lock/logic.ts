/**
 * The app lock's rules (ADR 0192), kept apart from the native calls so they can be tested.
 */

/** Back within this long after leaving, the app opens as it was; later, it asks again. No setting changes it. */
export const LOCK_GRACE_MS = 60_000;

/**
 * What this phone can prove its owner with: a fingerprint or face, only its screen lock (PIN, pattern, passcode), or
 * nothing. Read from expo-local-authentication's `getEnrolledLevelAsync` (`SecurityLevel`: 0 none, 1 the screen lock
 * alone, 2 and 3 biometrics, weak and strong).
 */
export type LockAvailability = "biometrics" | "credential" | "none";

export function availabilityOf(level: number): LockAvailability {
  if (level >= 2) return "biometrics";
  if (level === 1) return "credential";
  return "none";
}

/**
 * Whether coming back to the app locks it: it went to the background (`leftAt`) at least the grace ago. A clock that
 * went backwards while away locks too, never the other way round.
 */
export function locksOnReturn(leftAt: number | null, now: number, grace = LOCK_GRACE_MS): boolean {
  if (leftAt === null) return false;
  return now < leftAt || now - leftAt >= grace;
}
