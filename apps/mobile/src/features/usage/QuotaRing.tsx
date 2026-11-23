import type { PlanAccountUsage } from "@agenteschat/client";
import { useAiAccounts, usePlanUsage, useSetChatPrefs } from "@agenteschat/client";
import { accountName, groupUsageAccounts, planMeterText } from "@agenteschat/client/lib/plan-usage";
import {
  noQuotaText,
  QUOTA_HUES,
  type QuotaLine,
  type QuotaRingLine,
  quotaOverview,
  quotaPace,
  quotaPaceAlert,
  quotaPaceAlertText,
  quotaPaceText,
  quotaRingLabel,
  quotaRingTone,
  recentLines,
} from "@agenteschat/client/lib/quotas";
import { WALLPAPER_HUES } from "@agenteschat/client/lib/wallpaper";
import { PLAN_ALMOST, PLAN_TONE, type PlanLevel, planLevel } from "@agenteschat/ui/plan-state";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useOrg } from "@/providers/org";
import { Icon, IconButton, LIST_AVATAR, ListRow, ProviderLogo, SHEET_X, Text, useTheme } from "@/ui";
import { useReducedMotion } from "@/ui/theme";
import { useColors } from "../shared/hooks";
import { useSheet } from "../shared/SheetHost";
import { quotaRingFontSize } from "./logic";
import { Meter } from "./parts";
import { openQuotas } from "./QuotasScreen";

/** The ring on its round bar button's 40-point plate, 4 points from its edge. */
const RING = 32;
/** The same dial at the head of the sheet. */
const RING_LARGE = 56;

/** A plan's color in this theme, or the color its level gives it near a limit. */
function useQuotaTone() {
  const c = useColors();
  const { scheme } = useTheme();
  const hueOf = (hue: QuotaRingLine["hue"]) => QUOTA_HUES[hue][scheme === "dark" ? "dark" : "light"];
  return {
    hueOf,
    toneOf: (hue: QuotaRingLine["hue"], level: PlanLevel) => (level === "ok" ? hueOf(hue) : c[PLAN_TONE[level]]),
  };
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
/** How long the arc takes to reach a new percent. */
const ARC_MS = 360;

/**
 * The ring (ADR 0063 addendum 2026-11-23): a thin track and one arc with round ends for the account closest to a limit,
 * its percent in the middle in tabular digits. The arc is the soft text color with room, amber from 70% and red from
 * 90% (`quotaRingTone`); it moves only when the percent does, and not at all with reduced motion. A dash while none
 * reports limits.
 */
function QuotaDial({ used, size }: { used: number | null; size: number }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const scale = size / RING;
  const stroke = 3 * scale;
  const radius = (size - stroke) / 2;
  const around = 2 * Math.PI * radius;
  const tone = quotaRingTone(used);
  const arc = tone === "danger" ? c.danger : tone === "warn" ? c.warn : c.muted;
  const target = used === null ? 0 : Math.min(Math.max(used, 0), 100) / 100;
  // Drawn where it stands at first; only a change of the percent moves it.
  const shown = useSharedValue(target);
  useEffect(() => {
    shown.value = reduced ? target : withTiming(target, { duration: ARC_MS, easing: Easing.out(Easing.cubic) });
  }, [target, reduced, shown]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: around * (1 - shown.value) }));
  const number = used === null ? "–" : String(used);
  const circle = { cx: size / 2, cy: size / 2, r: radius, strokeWidth: stroke, fill: "none" };
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={styles.turned}>
        <Circle {...circle} stroke={c.ink} strokeOpacity={0.14} />
        {target > 0 ? (
          <AnimatedCircle
            {...circle}
            stroke={arc}
            strokeLinecap="round"
            strokeDasharray={`${around} ${around}`}
            animatedProps={props}
          />
        ) : null}
      </Svg>
      <View style={styles.number} pointerEvents="none">
        <Text
          variant="caption"
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.bold, styles.tabular, { color: c.ink, fontSize: quotaRingFontSize(number) * scale }]}
        >
          {number}
        </Text>
      </View>
    </View>
  );
}

/** The workspace's accounts as Cotas lists them, with the ring's numbers. */
function useQuotaOverview() {
  const { orgId, org } = useOrg();
  const usage = usePlanUsage(orgId);
  const mine = useAiAccounts(orgId);
  // One seat on two computers is one account, as Cotas lists it.
  const accounts: PlanAccountUsage[] = usage.data ? groupUsageAccounts(usage.data.accounts, mine.data) : [];
  const now = Date.now();
  return { overview: quotaOverview(accounts, now, org?.chatPrefs?.ringColors), now };
}

/**
 * The plan limits ring for the bar of Conversas (ADR 0063 addendum 2026-11-18), a round button of its own beside "+":
 * the percent of the account closest to a limit, in the ink over the plate so it always reads, and an arc in the soft
 * text color with room, amber from 70% and red from 90%. Pressed, the sheet with every account.
 * Null while the workspace has no AI account; a dash while none reports limits.
 */
export function useQuotaRing(): ReactNode {
  const { t } = useTranslation();
  const sheet = useSheet();
  const { overview } = useQuotaOverview();
  if (overview.lines.length === 0) return null;
  return (
    <IconButton
      plate
      icon="chart"
      mark={<QuotaDial used={overview.tightest?.used ?? null} size={RING} />}
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
  const { overview, now } = useQuotaOverview();
  const alert = quotaPaceAlert(overview, now);
  // The head: the ring, larger, and which circle is whose; pressing a color opens the ones to pick from.
  const text = planMeterText(t, i18n.language);
  const { orgId, org } = useOrg();
  const setPrefs = useSetChatPrefs(orgId);
  const { hueOf, toneOf } = useQuotaTone();
  const [picking, setPicking] = useState<string | null>(null);
  return (
    <>
      <View style={styles.top}>
        {overview.tightest ? <QuotaDial used={overview.tightest.used} size={RING_LARGE} /> : null}
        <View style={styles.lead}>
          <Text variant="title">{t("quotas.ring.title")}</Text>
          {alert ? (
            <Text variant="small" style={{ color: c.warn }}>
              {quotaPaceAlertText(t, i18n.language, alert, accountName(t, alert.account), now)}
            </Text>
          ) : null}
          {overview.rings.map((r) => (
            <View key={r.account.key} style={styles.keyBlock}>
              <View style={styles.key}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={accountName(t, r.account)}
                  accessibilityState={{ expanded: picking === r.account.key }}
                  hitSlop={14}
                  onPress={() => setPicking(picking === r.account.key ? null : r.account.key)}
                  style={[styles.dot, { backgroundColor: toneOf(r.hue, r.level) }]}
                />
                <Text variant="small" tone="ink" numberOfLines={1} style={[styles.bold, styles.grow]}>
                  {accountName(t, r.account)}
                  {r.window ? <Text variant="small" tone="muted">{`  ${text.short(r.window)}`}</Text> : null}
                </Text>
                <Text variant="small" tone="ink" style={[styles.bold, styles.tabular]}>{`${r.used}%`}</Text>
              </View>
              {picking === r.account.key ? (
                <View style={styles.hues} accessibilityRole="radiogroup">
                  {WALLPAPER_HUES.map((hue, i) => (
                    <Pressable
                      key={hue}
                      accessibilityRole="radio"
                      accessibilityLabel={`${accountName(t, r.account)} ${i + 1}`}
                      accessibilityState={{ checked: r.hue === hue }}
                      hitSlop={4}
                      onPress={() => {
                        setPrefs.mutate({ ringColors: { ...org?.chatPrefs?.ringColors, [r.account.key]: hue } });
                        setPicking(null);
                      }}
                      style={[
                        styles.hue,
                        { backgroundColor: hueOf(hue) },
                        r.hue === hue ? { borderColor: c.ink, borderWidth: 2 } : null,
                      ]}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </View>
      {overview.lines.map((line) => (
        <QuotaSheetLine key={line.account.key} line={line} now={now} />
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

/** One account: its mark and name, then each window's percent, reset and pace, or why it has none and its recent use. */
function QuotaSheetLine({ line, now }: { line: QuotaLine; now: number }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const text = planMeterText(t, i18n.language);
  const { account, windows } = line;
  const { toneOf } = useQuotaTone();
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
          const pace = quotaPace(w, now);
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
              <Meter value={w.used} label={text.window(w)} mark={PLAN_ALMOST} color={toneOf(line.hue, level)} />
              {w.resetsAt ? (
                <Text variant="small" tone="muted">
                  {text.resets(w.resetsAt)}
                </Text>
              ) : null}
              {pace ? (
                <Text variant="small" tone="muted" style={pace.kind === "hits" ? { color: c.warn } : undefined}>
                  {quotaPaceText(t, i18n.language, pace, now)}
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
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  lead: { flex: 1, gap: 3 },
  key: { flexDirection: "row", alignItems: "center", gap: 8 },
  keyBlock: { gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  hues: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingVertical: 2 },
  hue: { width: 26, height: 26, borderRadius: 13 },
  grow: { flex: 1 },
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
