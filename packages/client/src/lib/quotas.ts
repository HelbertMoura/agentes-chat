import {
  EXTRA_USAGE_LABEL,
  limitRoom,
  PLAN_ALMOST,
  type PlanLevel,
  planLevel,
  planState,
  planWindows,
  windowExpired,
  windowLengthMs,
} from "@agenteschat/ui/plan-state";
import type { TFunction } from "i18next";
import type { AppNotification, PlanAccountUsage, RecentPeriod, RecentUse } from "../api/types";
import { formatInt, formatTokensShort, formatUsd } from "./format";
import { brandOf, planMeterText, usageWhen } from "./plan-usage";
import { planOf } from "./plans";
import { WALLPAPER_HUES, type WallpaperHue } from "./wallpaper";

/**
 * Cotas (ADR 0063 addendum 2026-11-17), shared by the web and the phone: every AI account the viewer sees, by maker,
 * each with its limits as the provider reports them, or its recent use where the provider reports none. Pure, no React.
 */

/** Where an account stands: at a limit, near one (`PLAN_ALMOST`), with room, or no limits known (`none`). */
export type QuotaStanding = "limited" | "almost" | "ok" | "none";

/** The makers in the order Cotas lists them; any other after them, by name. */
const MAKER_ORDER = ["claude_code", "codex", "antigravity", "opencode", "zai", "kimi", "minimax", "grok", "cursor"];

/** The mark an account's maker goes by (`ProviderLogo`): a coding plan's maker, else its CLI. */
export const makerOf = (a: Pick<PlanAccountUsage, "kind" | "provider">) => a.provider ?? a.kind;

export function quotaStanding(a: Pick<PlanAccountUsage, "usage">, now = Date.now()): QuotaStanding {
  const usage = a.usage;
  if (!usage || (usage.windows.length === 0 && usage.limited !== true)) return "none";
  return planState(usage, now).state;
}

/**
 * Whether the provider ever reports this account's limits here: not Cursor's, Grok Build's or the OpenCode CLI's
 * (their CLIs say nothing of a plan), not Antigravity's on the computer's own sign-in (read only per account), and not
 * a coding plan's whose maker has no usage endpoint (`plans.ts` `usage`).
 */
export function limitsReported(a: Pick<PlanAccountUsage, "kind" | "provider" | "accountId">): boolean {
  const plan = planOf(a.provider);
  if (plan) return Boolean(plan.usage);
  if (a.kind === "cursor" || a.kind === "grok" || a.kind === "opencode") return false;
  return !(a.kind === "antigravity" && a.accountId === null);
}

const RANK: Record<QuotaStanding, number> = { limited: 0, almost: 1, ok: 2, none: 3 };

export interface QuotaSection {
  /** The maker's mark (`makerOf`). */
  maker: string;
  name: string;
  accounts: PlanAccountUsage[];
}

/**
 * The accounts by maker, in `MAKER_ORDER`: within one, those at a limit first, then near one, then by their tightest
 * window, those with no limits known last. Each keeps its own row.
 */
export function quotaSections(accounts: readonly PlanAccountUsage[], now = Date.now()): QuotaSection[] {
  const sections = new Map<string, QuotaSection>();
  for (const a of accounts) {
    const maker = makerOf(a);
    const section = sections.get(maker) ?? { maker, name: brandOf(a), accounts: [] };
    section.accounts.push(a);
    sections.set(maker, section);
  }
  const used = (a: PlanAccountUsage) => (a.usage ? planState(a.usage, now).used : -1);
  const place = (m: string) => {
    const i = MAKER_ORDER.indexOf(m);
    return i === -1 ? MAKER_ORDER.length : i;
  };
  return [...sections.values()]
    .map((s) => ({
      ...s,
      accounts: [...s.accounts].sort(
        (a, b) => RANK[quotaStanding(a, now)] - RANK[quotaStanding(b, now)] || used(b) - used(a),
      ),
    }))
    .sort((a, b) => place(a.maker) - place(b.maker) || a.name.localeCompare(b.name));
}

/** The accounts with limits known, the closest to one first (at a limit, near one, then the most used): Início's few. */
export function tightestAccounts(accounts: readonly PlanAccountUsage[], count: number, now = Date.now()) {
  return accounts
    .filter((a) => quotaStanding(a, now) !== "none")
    .map((a) => ({ a, rank: RANK[quotaStanding(a, now)], used: a.usage ? planState(a.usage, now).used : 0 }))
    .sort((x, y) => x.rank - y.rank || y.used - x.used)
    .slice(0, count)
    .map((x) => x.a);
}

/** How many accounts are at a limit and near one, of how many with limits known. */
export function quotaSummary(accounts: readonly Pick<PlanAccountUsage, "usage">[], now = Date.now()) {
  const standings = accounts.map((a) => quotaStanding(a, now));
  return {
    limited: standings.filter((s) => s === "limited").length,
    almost: standings.filter((s) => s === "almost").length,
    known: standings.filter((s) => s !== "none").length,
    total: accounts.length,
  };
}

/** The line of the way into Cotas: "1 no limite · 2 quase no limite", "Todas com folga", or how many accounts. */
export function quotaSummaryText(t: TFunction, summary: ReturnType<typeof quotaSummary>) {
  const parts = [
    summary.limited > 0 ? t("quotas.summary.limited", { count: summary.limited }) : null,
    summary.almost > 0 ? t("quotas.summary.almost", { count: summary.almost }) : null,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return summary.known > 0 ? t("quotas.summary.ok") : t("quotas.summary.accounts", { count: summary.total });
}

/** How much of an account's limits is used now, and where that leaves it. */
export interface QuotaRoom {
  /** The tightest window's percent, whole; 100 at a limit, a refusal with no full window included. */
  used: number;
  standing: Exclude<QuotaStanding, "none">;
}

/**
 * An account's room (`QuotaRoom`), from the windows that limit it (`limitWindows`) that haven't reset. Null where it
 * reports no limits, and for an account signed out: nothing thinks with it, its last numbers only grow old.
 */
export function quotaRoom(a: Pick<PlanAccountUsage, "usage" | "signedOut">, now = Date.now()): QuotaRoom | null {
  if (!a.usage || a.signedOut) return null;
  const room = limitRoom(a.usage, now);
  if (!room) return null;
  const used = room.limited ? 100 : Math.round(room.used);
  return { used, standing: used >= 100 ? "limited" : used >= PLAN_ALMOST ? "almost" : "ok" };
}

/** One window of an account in the ring's list; `resetsAt` only while it is still ahead. */
export interface QuotaWindowLine {
  key: string;
  kind: string;
  label?: string;
  used: number;
  resetsAt: string | null;
}

/** One account in the ring's list: its mark and maker, its room, and every window it reports. */
export interface QuotaLine {
  account: PlanAccountUsage;
  maker: string;
  brand: string;
  room: QuotaRoom | null;
  windows: QuotaWindowLine[];
  /** Its color: the viewer's choice, else its maker's, else the first one free. */
  hue: WallpaperHue;
}

/** How many accounts the ring draws. */
export const QUOTA_RINGS = 3;

/** The colors an account can take in the ring, for the light and the dark theme. */
export const QUOTA_HUES: Record<WallpaperHue, { light: string; dark: string }> = {
  sky: { light: "#0284c7", dark: "#38bdf8" },
  indigo: { light: "#4f46e5", dark: "#818cf8" },
  violet: { light: "#7c3aed", dark: "#a78bfa" },
  rose: { light: "#db2777", dark: "#f472b6" },
  amber: { light: "#c8603f", dark: "#e8926f" },
  green: { light: "#15803d", dark: "#4ade80" },
  teal: { light: "#0f766e", dark: "#2dd4bf" },
  graphite: { light: "#57534e", dark: "#a8a29e" },
};

/** Each maker's color, near its own mark's. */
const MAKER_HUES: Partial<Record<string, WallpaperHue>> = {
  claude_code: "amber",
  antigravity: "sky",
  enterprise: "sky",
  opencode: "violet",
  zen: "violet",
  codex: "teal",
  cursor: "indigo",
  grok: "graphite",
};

/** One circle of the ring, in a 36-unit box. */
export interface QuotaRingLine {
  account: PlanAccountUsage;
  used: number;
  level: PlanLevel;
  /** The account's tightest window. */
  window: QuotaWindowLine | null;
  radius: number;
  stroke: number;
  hue: WallpaperHue;
}

const RING_SHAPES: readonly (readonly (readonly [radius: number, stroke: number])[])[] = [
  [[15, 4]],
  [
    [15.6, 3.2],
    [11.4, 3.2],
  ],
  [
    [16, 2.6],
    [12.7, 2.6],
    [9.4, 2.6],
  ],
];

/** Each circle's radius and stroke for a ring of `count` (none yet: one empty circle). */
export const quotaRingShape = (count: number) => RING_SHAPES[Math.max(count, 1) - 1] ?? RING_SHAPES[0] ?? [];

/** The pixel ring's grid: this many cells a side, each a pixel of the drawing. */
export const QUOTA_GRID = 24;
const PIXEL_RADII: readonly (readonly number[])[] = [[10.2], [10.6, 7.6], [11, 8.6, 6.2]];
const PIXEL_WIDTHS = [2.4, 2.1, 1.8];
/** The front of what is used, as a share of the circle: drawn every other cell, as the sky's dither. */
const PIXEL_EDGE = 0.05;

/** One cell of the pixel ring: its account (by place, outermost 0), and whether it is used, and at the dithered front. */
export interface QuotaPixel {
  x: number;
  y: number;
  ring: number;
  lit: boolean;
  half: boolean;
}

/**
 * The ring drawn in pixels (the app's dither, as its skies): a stepped circle per account, from the top clockwise, its
 * unused part every other cell. `used`: each circle's percent, outermost first; none: one empty circle.
 */
export function quotaPixels(used: readonly number[]): QuotaPixel[] {
  const count = Math.min(Math.max(used.length, 1), QUOTA_RINGS);
  const radii = PIXEL_RADII[count - 1] ?? [];
  const width = PIXEL_WIDTHS[count - 1] ?? 2;
  const out: QuotaPixel[] = [];
  for (let y = 0; y < QUOTA_GRID; y++) {
    for (let x = 0; x < QUOTA_GRID; x++) {
      const dx = x + 0.5 - QUOTA_GRID / 2;
      const dy = y + 0.5 - QUOTA_GRID / 2;
      const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
      const ring = radii.findIndex((r) => Math.abs(Math.hypot(dx, dy) - r) <= width / 2);
      if (ring < 0) continue;
      const share = Math.min(used[ring] ?? 0, 100) / 100;
      const lit = turn < share;
      const checker = (x + y) % 2 === 1;
      if (!lit && checker) continue;
      out.push({ x, y, ring, lit, half: lit && checker && turn > share - PIXEL_EDGE });
    }
  }
  return out;
}

/** The pixel digits, 5 cells tall; a 1 is narrower, so 100 fits inside three circles. */
const DIGITS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["01", "11", "01", "01", "01"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "–": ["000", "000", "111", "000", "000"],
};

/** The cells of `text` in pixel digits, centered on the ring's grid. */
export function quotaDigitPixels(text: string): { x: number; y: number }[] {
  const glyphs = [...text].map((ch) => DIGITS[ch] ?? DIGITS["–"] ?? []);
  const width = glyphs.reduce((w, g) => w + (g[0]?.length ?? 0), 0) + Math.max(glyphs.length - 1, 0);
  let x0 = Math.round(QUOTA_GRID / 2 - width / 2);
  const y0 = Math.round(QUOTA_GRID / 2 - 2.5);
  const out: { x: number; y: number }[] = [];
  for (const g of glyphs) {
    g.forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit === "1") out.push({ x: x0 + x, y: y0 + y });
      });
    });
    x0 += (g[0]?.length ?? 0) + 1;
  }
  return out;
}

export interface QuotaOverview {
  /**
   * The closest to a limit among the accounts that concern the viewer: theirs, or one their own agents or right hand
   * think with (`forMe`). Someone else's private plan never colors their ring. Null while none of those reports limits.
   */
  tightest: (QuotaRoom & { account: PlanAccountUsage }) | null;
  /** The accounts the ring draws, the closest to a limit outermost: those same accounts, `QUOTA_RINGS` at most. */
  rings: QuotaRingLine[];
  /** Every account: the closest to a limit first, those with no limits known after them in Cotas' order. */
  lines: QuotaLine[];
}

/** The ring over every screen (ADR 0063 addendum 2026-11-18): the tightest account and each account's windows. */
export function quotaOverview(
  accounts: readonly PlanAccountUsage[],
  now = Date.now(),
  chosen: Readonly<Record<string, WallpaperHue>> = {},
): QuotaOverview {
  const taken = new Set<WallpaperHue>(Object.values(chosen));
  const hueOf = (account: PlanAccountUsage) => {
    const own = chosen[account.key];
    if (own) return own;
    const maker = MAKER_HUES[makerOf(account)];
    const hue = maker && !taken.has(maker) ? maker : (WALLPAPER_HUES.find((h) => !taken.has(h)) ?? "sky");
    taken.add(hue);
    return hue;
  };
  const lines = quotaSections(accounts, now)
    .flatMap((s) => s.accounts)
    .map((account): QuotaLine => {
      const usage = account.usage;
      const windows = usage ? planWindows(usage, now) : [];
      return {
        account,
        maker: makerOf(account),
        brand: brandOf(account),
        room: quotaRoom(account, now),
        hue: hueOf(account),
        windows: windows.map((w) => ({
          key: `${w.kind}:${w.label ?? ""}`,
          kind: w.kind,
          ...(w.label ? { label: w.label } : {}),
          // A reading with no reset, older than its window: nothing is known to be used now.
          used: windowExpired(w, usage?.at, now) ? 0 : Math.round(w.used),
          resetsAt: w.resetsAt && Date.parse(w.resetsAt) > now ? w.resetsAt : null,
        })),
      };
    })
    .sort((a, b) => (b.room?.used ?? -1) - (a.room?.used ?? -1));
  const concerning = lines.filter((l) => l.room && (l.account.mine || l.account.forMe)).slice(0, QUOTA_RINGS);
  const shape = quotaRingShape(concerning.length);
  const rings = concerning.flatMap((l, i): QuotaRingLine[] => {
    const circle = shape[i];
    if (!l.room || !circle) return [];
    const level = quotaLevel(l.room);
    const [radius, stroke] = circle;
    return [{ account: l.account, used: l.room.used, level, window: l.windows[0] ?? null, radius, stroke, hue: l.hue }];
  });
  const first = concerning[0];
  return { tightest: first?.room ? { ...first.room, account: first.account } : null, rings, lines };
}

/** Too little of a window gone to tell its pace: under this share of it, or under `PACE_MIN_MS`. */
const PACE_MIN_SHARE = 0.05;
const PACE_MIN_MS = 10 * 60_000;

/**
 * Where a window is heading at the pace it was used so far: past its limit before it resets (`hits`, when), or short
 * of it (`room`, the percent it ends at). Null where its reset or length is unknown, too little of it is gone to tell,
 * nothing is used yet, or it is already at its limit. Extra usage is a cap, not a window: no pace.
 */
export type QuotaPace = { kind: "hits"; at: string } | { kind: "room"; projected: number };

export function quotaPace(
  w: Pick<QuotaWindowLine, "kind" | "label" | "used" | "resetsAt">,
  now = Date.now(),
): QuotaPace | null {
  const length = windowLengthMs(w);
  const reset = Date.parse(w.resetsAt ?? "");
  if (!length || w.label === EXTRA_USAGE_LABEL || !(reset > now) || w.used <= 0 || w.used >= 100) return null;
  const elapsed = length - (reset - now);
  if (elapsed < Math.max(length * PACE_MIN_SHARE, PACE_MIN_MS)) return null;
  const projected = w.used / (elapsed / length);
  if (projected < 100) return { kind: "room", projected: Math.round(projected) };
  const at = now + ((100 - w.used) / w.used) * elapsed;
  return at < reset ? { kind: "hits", at: new Date(at).toISOString() } : null;
}

/** The pace in words: when it reaches 100% ("às 15:10", "sexta às 10:00"), or the room it ends with. */
export function quotaPaceText(t: TFunction, locale: string, pace: QuotaPace, now = Date.now()) {
  return pace.kind === "hits"
    ? t("quotas.pace.hits", { when: usageWhen(t, locale, pace.at, new Date(now)) })
    : t("quotas.pace.room", { percent: pace.projected });
}

/** The tightest account's soonest window that reaches its limit before it resets, at the pace so far: the card's head. */
export function quotaPaceAlert(
  overview: QuotaOverview,
  now = Date.now(),
): { account: PlanAccountUsage; at: string } | null {
  const line = overview.lines.find((l) => l.account.key === overview.tightest?.account.key);
  const hits = (line?.windows ?? [])
    .map((w) => quotaPace(w, now))
    .flatMap((p) => (p?.kind === "hits" ? [p.at] : []))
    .sort();
  return line && hits[0] ? { account: line.account, at: hits[0] } : null;
}

/** The card's head line: the tightest account (`name`, as the screen names it) reaches its limit then. */
export const quotaPaceAlertText = (
  t: TFunction,
  locale: string,
  alert: { at: string },
  name: string,
  now = Date.now(),
) => t("quotas.pace.head", { account: name, when: usageWhen(t, locale, alert.at, new Date(now)) });

/** The color level of a ring (`PLAN_TONE`, the web's `data-level`), as the meters color the same percent. */
export const quotaLevel = (room: QuotaRoom | null) =>
  room ? planLevel(room.used, room.standing === "limited") : ("ok" as const);

/** The ring's name for a screen reader: the percent and the account, or that no account reports limits. */
export function quotaRingLabel(t: TFunction, overview: QuotaOverview, name: (a: PlanAccountUsage) => string) {
  const top = overview.tightest;
  if (!top) return t("quotas.ring.none");
  return t(`quotas.ring.${top.standing}`, { percent: top.used, account: name(top.account) });
}

/** What a `plan_limit_near` row says: the account, the percent, the window and, while it is ahead, its reset. */
export function planLimitNotice(
  t: TFunction,
  locale: string,
  n: Pick<AppNotification, "source" | "latest">,
  now = new Date(),
) {
  const text = planMeterText(t, locale, now);
  const { percent, window, resetsAt } = n.latest;
  return {
    account: n.source.label ?? "",
    percent: Math.round(percent ?? 90),
    window: window ? text.window(window) : "",
    resets: resetsAt && Date.parse(resetsAt) > now.getTime() ? text.resets(resetsAt) : null,
  };
}

const PERIODS: readonly RecentPeriod[] = ["day", "week", "month"];

/**
 * An account's recent use, one line per rolling period ("Últimas 24 h", "1,2 mi tokens · 34 chamadas · ≈ US$ 3,10"),
 * money only where the server sent it. Empty for an older server, or no use in 30 days.
 */
export function recentLines(
  t: TFunction,
  locale: string,
  recent: Record<RecentPeriod, RecentUse> | undefined,
): { period: RecentPeriod; label: string; value: string }[] {
  if (!recent || recent.month.requests === 0) return [];
  return PERIODS.map((period) => {
    const r = recent[period];
    const value = [
      t("usageViews.tokens", { tokens: formatTokensShort(t, locale, r.tokens) }),
      t("quotas.recent.requests", { count: r.requests, value: formatInt(locale, r.requests) }),
      typeof r.equivalentUsd === "number" && r.equivalentUsd > 0
        ? t("usageViews.equivalent", { amount: formatUsd(locale, r.equivalentUsd) })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { period, label: t(`quotas.recent.${period}`), value };
  });
}

/**
 * Why an account shows no meters: its provider never reports limits here (`limitsReported`), or not yet (`noWindows`),
 * or nobody uses it.
 */
export function noQuotaText(
  t: TFunction,
  a: Pick<PlanAccountUsage, "kind" | "provider" | "accountId" | "agents">,
): string {
  if (!limitsReported(a)) return t("quotas.notReported");
  return a.agents.length > 0 ? t("usageViews.noWindows") : t("usageViews.unused");
}
