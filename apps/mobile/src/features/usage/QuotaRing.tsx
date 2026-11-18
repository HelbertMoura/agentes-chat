import type { PlanAccountUsage } from "@agenteschat/client";
import { useAiAccounts, usePlanUsage } from "@agenteschat/client";
import { accountName, groupUsageAccounts, planMeterText } from "@agenteschat/client/lib/plan-usage";
import {
  noQuotaText,
  type QuotaLine,
  quotaLevel,
  quotaOverview,
  quotaRingLabel,
  recentLines,
} from "@agenteschat/client/lib/quotas";
import { PLAN_TONE, planLevel } from "@agenteschat/ui/plan-state";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useOrg } from "@/providers/org";
import { ICON_BUTTON_SIZE, Icon, LIST_AVATAR, ListRow, PressScale, ProviderLogo, SHEET_X, Text } from "@/ui";
import { useColors } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { useSheet } from "../shared/SheetHost";
import { openQuotas } from "./QuotasScreen";

/** The ring in its bar button: a little inside the 40-point target, as a bar button's glyph is. */
const RING = 32;
const STROKE = 2.5;
const RADIUS = (RING - STROKE) / 2;
const AROUND = 2 * Math.PI * RADIUS;

/** The workspace's accounts as Cotas lists them, with the ring's numbers. */
function useQuotaOverview() {
  const { orgId } = useOrg();
  const usage = usePlanUsage(orgId);
  const mine = useAiAccounts(orgId);
  // One seat on two computers is one account, as Cotas lists it.
  const accounts: PlanAccountUsage[] = usage.data ? groupUsageAccounts(usage.data.accounts, mine.data) : [];
  return quotaOverview(accounts);
}

/**
 * The plan limits ring for the bar of Conversas (ADR 0063 addendum 2026-11-18), as beside the web's bell: the percent of
 * the account closest to a limit, written in the circle, in the color the meters give it. Pressed, the sheet with every
 * account. Null while the workspace has no AI account; a dash while none reports limits.
 */
export function useQuotaRing(): ReactNode {
  const { t } = useTranslation();
  const c = useColors();
  const sheet = useSheet();
  const overview = useQuotaOverview();
  if (overview.lines.length === 0) return null;
  const top = overview.tightest;
  const level = quotaLevel(top);
  const tone = level === "ok" ? c.ink2 : c[PLAN_TONE[level]];
  return (
    <PressScale
      to={0.9}
      onPress={() => sheet.open(<QuotaSheet />)}
      accessibilityRole="button"
      accessibilityLabel={quotaRingLabel(t, overview, (a) => accountName(t, a))}
      style={styles.button}
    >
      <Svg width={RING} height={RING} style={styles.turned}>
        <Circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke={c.line} strokeWidth={STROKE} fill="none" />
        {top && top.used > 0 ? (
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            stroke={tone}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${(Math.min(top.used, 100) / 100) * AROUND} ${AROUND}`}
            fill="none"
          />
        ) : null}
      </Svg>
      <View style={styles.number} pointerEvents="none">
        <Text variant="caption" allowFontScaling={false} style={[styles.digits, { color: tone }]}>
          {top ? top.used : "–"}
        </Text>
      </View>
    </PressScale>
  );
}

/** Every account with its windows, the closest to a limit first, and the row into Cotas. */
function QuotaSheet() {
  const { t } = useTranslation();
  const c = useColors();
  const sheet = useSheet();
  const overview = useQuotaOverview();
  return (
    <>
      <SheetTitle title={t("quotas.ring.title")} />
      {overview.lines.map((line) => (
        <QuotaSheetLine key={line.account.key} line={line} />
      ))}
      <View style={styles.bleed}>
        <ListRow
          leading={
            <View style={[styles.tile, { backgroundColor: c.plate }]}>
              <Icon name="chart" size={22} color={c.muted} />
            </View>
          }
          title={t("quotas.seeAll")}
          chevron
          accessibilityRole="button"
          onPress={() => sheet.close(openQuotas)}
        />
      </View>
    </>
  );
}

/** One account: its mark and name, then each window's percent and reset, or why it has none and its recent use. */
function QuotaSheetLine({ line }: { line: QuotaLine }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const text = planMeterText(t, i18n.language);
  const { account, windows } = line;
  const recent = recentLines(t, i18n.language, account.recent).at(-1);
  return (
    <View style={styles.account}>
      <View style={styles.head}>
        <ProviderLogo id={line.maker} size="xs" off={account.signedOut} />
        <Text variant="callout" tone="ink" style={[styles.bold, styles.shrink]}>
          {accountName(t, account)}
        </Text>
        <Text variant="small" tone="muted">
          {line.brand}
        </Text>
      </View>
      {windows.length > 0 ? (
        windows.map((w) => {
          const level = planLevel(w.used);
          return (
            <View key={w.key} style={styles.window}>
              <Text variant="small" tone="ink2" style={styles.shrink}>
                {text.window(w)}
              </Text>
              <Text
                variant="small"
                style={[styles.bold, styles.tabular, { color: level === "ok" ? c.ink : c[PLAN_TONE[level]] }]}
              >
                {`${w.used}%`}
              </Text>
              {w.resetsAt ? (
                <Text variant="small" tone="muted" style={styles.reset}>
                  {text.resets(w.resetsAt)}
                </Text>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text variant="small" tone="muted">
          {recent ? `${recent.label}: ${recent.value}` : noQuotaText(t, account)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: ICON_BUTTON_SIZE, height: ICON_BUTTON_SIZE, alignItems: "center", justifyContent: "center" },
  // The arc starts at the top.
  turned: { transform: [{ rotate: "-90deg" }] },
  number: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  digits: { fontSize: 10, lineHeight: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  account: { gap: 4 },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8 },
  // The name and percent lead; the reset goes to the row's end, or under them on a narrow phone.
  window: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 8 },
  reset: { marginLeft: "auto" },
  shrink: { flexShrink: 1 },
  bold: { fontWeight: "600" },
  tabular: { fontVariant: ["tabular-nums"] },
  // The row reaches the sheet's edges, as a list's rows do.
  bleed: { marginHorizontal: -SHEET_X },
  // The avatar column's tile, a little inside it, as the list's other icon rows.
  tile: {
    width: LIST_AVATAR - 8,
    height: LIST_AVATAR - 8,
    borderRadius: (LIST_AVATAR - 8) * 0.3,
    alignItems: "center",
    justifyContent: "center",
  },
});
