# 0220. Phone app lock: biometrics or the screen lock, per device

- Status: Accepted
- Date: 2026-11-23
- Amends: 0035 (the phone app)
- Code: `apps/mobile/src/features/lock/logic.ts` (`LOCK_GRACE_MS`, `availabilityOf`, `locksOnReturn`), `store.ts`
  (`useAppLock`, `watchAppLock`, `unlock`, `turnAppLock`, `whenUnlocked`, `forgetAppLock`, `useLockAvailability`),
  `LockScreen.tsx`, `AppLockRow.tsx` (Você › Preferências); the root `apps/mobile/app/_layout.tsx`; a tapped push
  waits in `src/providers/push.tsx`; `STORED.appLock` in `src/lib/storage.ts`; sign-out of the last account in
  `src/features/account/index.ts`; `expo-local-authentication` in `app.config.ts`; tests
  `apps/mobile/test/features/app-lock.test.ts`

## Context

A phone stays signed in for good (ADR 0035), and what it opens to is people's and agents' conversations. Someone who
picks up an unlocked phone, or one whose owner hands it over, reads them all. Banking and chat apps answer this with an
app lock behind the phone's own biometrics. The server can't help: the risk is the device in someone else's hand,
and the proof has to come from the device.

## Decision

1. **A setting of the phone, off by default.** Você › Preferências has "Bloquear com biometria" ("Lock with
   biometrics"). It is kept on the phone (`STORED.appLock` in SecureStore), not on the account: another phone of the
   same person is not locked, and signing out of one account or switching accounts or servers leaves it as it is.
   Signing out of the last account clears the phone's remembered values (ADR 0154), and the lock with them.
2. **Offered where the phone can prove its owner.** `getEnrolledLevelAsync` says whether biometrics are enrolled
   (weak or strong), only a screen lock (PIN, pattern, passcode) is set, or nothing. With nothing the switch is off
   and disabled, with one line saying what to set up; it is read again whenever the app comes back to the front.
   Turning it on asks for one successful proof first; turning it off doesn't, since the app is already open.
3. **The proof is the system's.** `authenticateAsync` with the device credential allowed: a fingerprint that no
   longer reads, or a face the phone can't see, gives way to the phone's PIN, pattern or passcode, so a person is
   never kept out of their own app. A phone whose screen lock was removed while the lock was on can prove nothing
   any more: Desbloquear turns the lock off and opens, rather than locking the person out for good.
4. **When it asks.** On a cold start, and on coming back from the background one minute or more after leaving
   (`LOCK_GRACE_MS`, a constant, with no setting of its own). A clock that went backwards while away locks too. The
   system's own prompt takes the app out of the front (Face ID, Android's PIN screen): that time is not counted as
   leaving.
5. **Nothing shows behind it.** The lock screen is the app's mark and Desbloquear on the app's background, over the
   whole navigator (which stays mounted, so links and pushes can still navigate) and under the launch splash; the app
   under it is hidden from screen readers. Out of sight (the app switcher, the background) the same screen covers the
   app without asking anything, so the system's picture of the app shows no conversation; back within the grace it
   goes away by itself.
6. **A tapped push waits.** What a tapped notification opens (its screen, or its action button's work) runs once the
   lock opens (`whenUnlocked`), not behind the lock.

## Consequences

- No server change and no new storage: one more remembered value of the phone.
- iOS shows `NSFaceIDUsageDescription` (each ready language's in `assets/locales`); Android gets
  `USE_BIOMETRIC` from the module's plugin. Both need a new native build.
- Open: Android takes the recents picture as the app pauses, and React may not have drawn the cover by then; the
  sure way is `FLAG_SECURE`, which also blocks screenshots, so it is left out. The lock screen asks only when
  Desbloquear is pressed; asking on its own as it appears is a possible refinement.
