import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GroupedRow } from "@/ui";
import { turnAppLock, useAppLock, useLockAvailability } from "./store";

/**
 * Você › Preferências: "Bloquear com biometria", for this phone only (ADR 0191). Offered where the phone has
 * biometrics or a screen lock; turning it on asks for that proof once.
 */
export function AppLockRow() {
  const { t } = useTranslation();
  const { enabled } = useAppLock();
  const availability = useLockAvailability();
  const [busy, setBusy] = useState(false);
  const missing = availability === "none" && !enabled;
  const flip = () => {
    if (busy) return;
    setBusy(true);
    void turnAppLock(!enabled, t("mobile.lock.confirm")).finally(() => setBusy(false));
  };
  return (
    <GroupedRow
      icon="lock"
      label={t("mobile.lock.setting")}
      labelLines={0}
      {...(missing ? { sub: t("mobile.lock.unavailable"), subLines: 0 } : {})}
      toggle={enabled}
      disabled={busy || availability === null || missing}
      onPress={flip}
    />
  );
}
