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
import { PLAN_ALMOST, PLAN_TONE, type PlanLevel, planLevel } from "@agenteschat/ui/plan-state";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useOrg } from "@/providers/org";
import { Icon, IconButton, LIST_AVATAR, ListRow, ProviderLogo, SHEET_X, Text } from "@/ui";
import { useColors } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { useSheet } from "../shared/SheetHost";
import { quotaRingFontSize } from "./logic";
import { Meter } from "./parts";
import { openQuotas } from "./QuotasScreen";

/** The ring on its round bar button's plate, 3 points from the plate's edge. */
const RING = 34;
/** The same dial at the head of the sheet. */
const RING_LARGE = 56;

/** The percent inside its arc, over a tint of the arc's tone, with a tick where "almost at the limit" starts. */
function QuotaDial({ used, level, size }: { used: number | null; level: PlanLevel; size: number }) {
  const c = useColors();
  const scale = size / RING;
  const stroke = 4 * scale;
  const radius = (size - stroke) / 2;
  const around = 2 * Math.PI * radius;
  const tone = used === null ? c.muted : level === "ok" ? c.ok : c[PLAN_TONE[level]];
  const number = used === null ? "–" : String(used);
  const circle = { cx: size / 2, cy: size / 2, r: radius, strokeWidth: stroke };
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={styles.turned}>
        <Circle {...circle} strokeWidth={0} fill={tone} fillOpacity={0.14} />
        <Circle {...circle} stroke={c.ink} strokeOpacity={0.16} fill="none" />
        <Circle
          {...circle}
          stroke={c.muted}
          strokeDasharray={`${stroke / 2} ${around}`}
          strokeDashoffset={-(PLAN_ALMOST / 100) * around + stroke / 4}
          fill="none"
        />
        {used !== null && used > 0 ? (
          <Circle
            {...circle}
            stroke={tone}
            strokeLinecap="round"
            strokeDasharray={`${(Math.min(used, 100) / 100) * around} ${around}`}
            fill="none"
          />
        ) : null}
      </Svg>
      <View style={styles.number} pointerEvents="none">
        <Text
          variant="caption"
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.digits, { color: c.ink, fontSize: quotaRingFontSize(number) * scale, lineHeight: 15 * scale }]}
        >
          {number}
        </Text>
      </View>
    </View>
  );
}

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
 * The plan limits ring for the bar of Conversas (ADR 0063 addendum 2026-11-18), a round button of its own beside "+":
 * the percent of the account closest to a limit, in the ink over the plate so it always reads, and an arc in the
 * positive tone with room, then the tones the meters give near and at a limit. Pressed, the sheet with every account.
 * Null while the workspace has no AI account; a dash while none reports limits.
 */
export function useQuotaRing(): ReactNode {
  const { t } = useTranslation();
  const sheet = useSheet();
  const overview = useQuotaOverview();
  if (overview.lines.length === 0) return null;
  const top = overview.tightest;
  return (
    <IconButton
      plate
      icon="chart"
      mark={<QuotaDial used={top ? top.used : null} level={quotaLevel(top)} size={RING} />}
      label={quotaRingLabel(t, overview, (a) => accountName(t, a))}
      onPress={() => sheet.open(<QuotaSheet />)}
    />
  );
}

/** Every account with its windows, the closest to a limit first, and the row into Cotas. */
function QuotaSheet() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const sheet = useSheet();
  const overview = useQuotaOverview();
  const top = overview.tightest;
  // The head: what the ring is showing and the window that sets it.
  const text = planMeterText(t, i18n.language);
  const window = top ? overview.lines.find((l) => l.account === top.account)?.windows[0] : undefined;
  const tightest = top ? [accountName(t, top.account), window ? text.window(window) : null] : [];
  return (
    <>
      <SheetTitle
        {...(top
          ? {
              leading: <QuotaDial used={top.used} level={quotaLevel(top)} size={RING_LARGE} />,
              subtitle: tightest.filter(Boolean).join(" · "),
            }
          : {})}
        title={t("quotas.ring.title")}
      />
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
    <View style={[styles.account, { borderTopColor: c.line }]}>
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
              <View style={styles.windowHead}>
                <Text variant="small" tone="ink2" style={styles.shrink}>
                  {text.window(w)}
                </Text>
                <Text
                  variant="small"
                  style={[styles.bold, styles.tabular, { color: level === "ok" ? c.ink : c[PLAN_TONE[level]] }]}
                >
                  {`${w.used}%`}
                </Text>
              </View>
              <Meter
                value={w.used}
                label={text.window(w)}
                mark={PLAN_ALMOST}
                color={level === "ok" ? c.ok : c[PLAN_TONE[level]]}
              />
              {w.resetsAt ? (
                <Text variant="small" tone="muted">
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
  // The arc starts at the top.
  turned: { transform: [{ rotate: "-90deg" }] },
  number: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  digits: { fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "center" },
  account: { gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8 },
  // The name and percent over the bar, when it renews under it.
  window: { gap: 4 },
  windowHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", columnGap: 8 },
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
