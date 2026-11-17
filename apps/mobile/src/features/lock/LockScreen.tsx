import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button } from "@/ui/Button";
import { LogoMark } from "@/ui/LogoMark";
import { useTheme } from "@/ui/theme";
import { unlock, useAppLock, watchAppLock } from "./store";

const LOGO = 72;

/**
 * The app lock over everything (ADR 0220): the mark and Desbloquear, on the app's background so nothing of the app
 * shows under it. Out of sight it covers alone; Desbloquear appears once proof is needed. Mounted once, at the root.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lock = useAppLock();
  const [busy, setBusy] = useState(false);
  useEffect(() => watchAppLock(), []);
  if (!lock.locked && !lock.covered) return null;
  const open = () => {
    setBusy(true);
    void unlock(t("mobile.lock.prompt")).finally(() => setBusy(false));
  };
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
      <LogoMark size={LOGO} />
      {lock.locked ? (
        <View style={styles.action}>
          <Button
            variant="primary"
            wide
            label={t("mobile.lock.unlock")}
            loading={busy}
            disabled={busy}
            onPress={open}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: 32, paddingHorizontal: 32 },
  action: { width: "100%", maxWidth: 360 },
});
