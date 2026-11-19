import type { PlanAccountUsage } from "@agenteschat/client";
import { useAiAccounts, usePlanUsage } from "@agenteschat/client";
import { accountName, groupUsageAccounts, planMeterText } from "@agenteschat/client/lib/plan-usage";
import {
  noQuotaText,
  type QuotaLine,
  type QuotaRingLine,
  quotaOverview,
  quotaRingLabel,
  quotaRingShape,
  recentLines,
} from "@agenteschat/client/lib/quotas";
import { PLAN_ALMOST, PLAN_TONE, planLevel } from "@agenteschat/ui/plan-state";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, type CircleProps, G } from "react-native-svg";
import { useOrg } from "@/providers/org";
import { Icon, IconButton, LIST_AVATAR, ListRow, ProviderLogo, SHEET_X, Text } from "@/ui";
import { useColors } from "../shared/hooks";
import { useSheet } from "../shared/SheetHost";
import { quotaRingFontSize } from "./logic";
import { Meter } from "./parts";
import { openQuotas } from "./QuotasScreen";

/** The ring on its round bar button's 40-point plate. */
const RING = 36;
/** What the shape of a ring is measured in (`quotaRingShape`). */
const BOX = 36;
/** The middle number shrinks as circles close in on it. */
const NUMBER_SCALE = [1, 0.86, 0.76];
/** The same dial at the head of the sheet. */
const RING_LARGE = 64;
const ARC_MS = 420;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The used part of the circle, drawn from the top on the UI thread as it appears and whenever the percent moves. */
function QuotaArc({ used, around, ...circle }: CircleProps & { used: number; around: number }) {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(Math.min(used, 100) / 100, { duration: ARC_MS, easing: Easing.out(Easing.cubic) });
  }, [used, shown]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: around * (1 - shown.value) }));
  return (
    <AnimatedCircle
      {...circle}
      animatedProps={props}
      strokeLinecap="round"
      strokeDasharray={`${around} ${around}`}
      fill="none"
    />
  );
}

/** A circle per account, the closest to a limit outermost, and that one's percent in the middle over a tint of its tone. */
function QuotaDial({ rings, size }: { rings: readonly QuotaRingLine[]; size: number }) {
  const c = useColors();
  const unit = size / BOX;
  const top = rings[0];
  const toneOf = (r: QuotaRingLine) => (r.level === "ok" ? c.ok : c[PLAN_TONE[r.level]]);
  const [emptyRadius = 15, emptyStroke = 4] = quotaRingShape(0)[0] ?? [];
  const circles = top
    ? rings.map((r) => ({
        key: r.account.key,
        r: r.radius,
        width: r.stroke,
        used: r.used,
        tone: toneOf(r),
        fade: r.fade,
      }))
    : [{ key: "none", r: emptyRadius, width: emptyStroke, used: 0, tone: c.muted, fade: 1 }];
  const last = circles.at(-1);
  const number = top ? String(top.used) : "–";
  const center = { cx: size / 2, cy: size / 2 };
  const font = quotaRingFontSize(number) * unit * (NUMBER_SCALE[Math.max(rings.length, 1) - 1] ?? 1);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={styles.turned}>
        {last ? (
          <Circle
            {...center}
            r={(last.r - last.width / 2) * unit}
            fill={top ? toneOf(top) : c.muted}
            fillOpacity={0.14}
          />
        ) : null}
        {circles.map((o) => {
          const radius = o.r * unit;
          const stroke = o.width * unit;
          const around = 2 * Math.PI * radius;
          const circle = { ...center, r: radius, strokeWidth: stroke };
          return (
            <G key={o.key}>
              <Circle {...circle} stroke={c.ink} strokeOpacity={0.16} fill="none" />
              <Circle
                {...circle}
                stroke={c.muted}
                strokeDasharray={`${stroke / 2} ${around}`}
                strokeDashoffset={-(PLAN_ALMOST / 100) * around + stroke / 4}
                fill="none"
              />
              {o.used > 0 ? (
                <QuotaArc {...circle} used={o.used} around={around} stroke={o.tone} strokeOpacity={o.fade} />
              ) : null}
            </G>
          );
        })}
      </Svg>
      <View style={styles.number} pointerEvents="none">
        <Text
          variant="caption"
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.digits, { color: c.ink, fontSize: font, lineHeight: font * 1.15 }]}
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
  return (
    <IconButton
      plate
      icon="chart"
      mark={<QuotaDial rings={overview.rings} size={RING} />}
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
  // The head: the ring, larger, and which circle is whose.
  const text = planMeterText(t, i18n.language);
  return (
    <>
      <View style={styles.top}>
        {overview.rings.length > 0 ? <QuotaDial rings={overview.rings} size={RING_LARGE} /> : null}
        <View style={styles.lead}>
          <Text variant="title">{t("quotas.ring.title")}</Text>
          {overview.rings.map((r) => (
            <View key={r.account.key} style={styles.key}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: r.level === "ok" ? c.ok : c[PLAN_TONE[r.level]], opacity: r.fade },
                ]}
              />
              <Text variant="small" tone="ink" numberOfLines={1} style={[styles.bold, styles.grow]}>
                {accountName(t, r.account)}
                {r.window ? <Text variant="small" tone="muted">{`  ${text.short(r.window)}`}</Text> : null}
              </Text>
              <Text variant="small" tone="ink" style={[styles.bold, styles.tabular]}>{`${r.used}%`}</Text>
            </View>
          ))}
        </View>
      </View>
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
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  lead: { flex: 1, gap: 3 },
  key: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
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
