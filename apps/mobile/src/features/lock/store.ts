import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { readValueSync, STORED, writeValue } from "@/lib/storage";
import { availabilityOf, type LockAvailability, locksOnReturn } from "./logic";

/**
 * The app lock (ADR 0191), kept on this phone: off by default, on only after the person proved it once. While on, the
 * app opens locked and locks again when it comes back after the grace (`LOCK_GRACE_MS`). Out of sight (the app
 * switcher, the background) the lock screen covers it without asking anything, so its picture shows no conversation.
 */
interface LockState {
  enabled: boolean;
  /** Proof is needed before anything of the app shows. */
  locked: boolean;
  /** Out of sight: covered, nothing asked on return within the grace. */
  covered: boolean;
}

let state: LockState = (() => {
  const enabled = readValueSync(STORED.appLock) === "1";
  return { enabled, locked: enabled, covered: false };
})();
let leftAt: number | null = null;
/** The system's prompt is up: the app leaving for it (Face ID, Android's PIN screen) is not the person leaving. */
let authenticating = false;
const listeners = new Set<() => void>();
/** What waits for the lock to open (a tapped notification's screen). */
const waiting = new Set<() => void>();

function set(next: Partial<LockState>) {
  state = { ...state, ...next };
  for (const cb of listeners) cb();
  if (!state.locked) {
    const ready = [...waiting];
    waiting.clear();
    for (const fn of ready) fn();
  }
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const current = () => state;

export const useAppLock = () => useSyncExternalStore(subscribe, current, current);

/** Runs `fn` now, or once the lock opens; the returned function drops it if it hasn't run. */
export function whenUnlocked(fn: () => void): () => void {
  if (!state.locked) {
    fn();
    return () => {};
  }
  waiting.add(fn);
  return () => void waiting.delete(fn);
}

/** Follows the app in and out of the front (mounted once, at the root). */
export function watchAppLock(): () => void {
  const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
    if (!state.enabled || authenticating) return;
    if (s === "active") {
      const locked = state.locked || locksOnReturn(leftAt, Date.now());
      leftAt = null;
      set({ locked, covered: false });
      return;
    }
    if (s === "background" && leftAt === null) leftAt = Date.now();
    if (!state.covered) set({ covered: true });
  });
  return () => sub.remove();
}

/** What this phone can prove its owner with now. */
export async function lockAvailability(): Promise<LockAvailability> {
  try {
    return availabilityOf(await LocalAuthentication.getEnrolledLevelAsync());
  } catch {
    return "none";
  }
}

/** Read again whenever the app comes back: the person may have set up a fingerprint or a PIN meanwhile. */
export function useLockAvailability(): LockAvailability | null {
  const [availability, setAvailability] = useState<LockAvailability | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void lockAvailability().then((a) => {
        if (alive) setAvailability(a);
      });
    read();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") read();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return availability;
}

/** The system's prompt: biometrics, with the phone's PIN, pattern or passcode always allowed in their place. */
async function authenticate(promptMessage: string): Promise<boolean> {
  authenticating = true;
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
    return result.success;
  } catch {
    return false;
  } finally {
    authenticating = false;
  }
}

/**
 * Opens the lock with the system's proof. A phone that can no longer prove anything (its screen lock was removed)
 * turns the lock off instead of keeping the person out: no proof is left to ask for.
 */
export async function unlock(promptMessage: string): Promise<boolean> {
  if ((await lockAvailability()) === "none") {
    setAppLock(false);
    return true;
  }
  if (!(await authenticate(promptMessage))) return false;
  set({ locked: false, covered: false });
  return true;
}

/** Turning it on asks for the proof first; turning it off doesn't (the app is open already). */
export async function turnAppLock(on: boolean, promptMessage: string): Promise<boolean> {
  if (on && !(await authenticate(promptMessage))) return false;
  setAppLock(on);
  return true;
}

function setAppLock(on: boolean) {
  leftAt = null;
  void writeValue(STORED.appLock, on ? "1" : null);
  set({ enabled: on, locked: false, covered: false });
}

/** The phone's remembered values were cleared (the last account signed out): the lock goes with them. */
export function forgetAppLock() {
  leftAt = null;
  set({ enabled: false, locked: false, covered: false });
}
