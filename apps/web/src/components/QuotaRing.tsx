import { useAiAccounts, usePlanUsage } from "@agenteschat/client";
import {
  noQuotaText,
  type QuotaLine,
  quotaLevel,
  quotaOverview,
  quotaRingLabel,
  recentLines,
} from "@agenteschat/client/lib/quotas";
import { Icon, Meter, movesByKeys, Popover, ProviderLogo, useHoverCard } from "@agenteschat/ui";
import { PLAN_ALMOST, type PlanLevel, planLevel } from "@agenteschat/ui/plan-state";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { accountName, groupUsageAccounts, planMeterText } from "@/lib/plan-usage";
import { HOVER_OPEN_MS } from "./ProfileCard";
import "./quota-ring.css";

/** The dial's circle in its 36-unit box. */
const CENTER = 18;
const RADIUS = 15;
const AROUND = 2 * Math.PI * RADIUS;
/** The tick on the track where a plan counts as almost at its limit, as long as the stroke is wide. */
const TICK = 1.6;

/** The percent inside its arc, over a tint of the arc's tone, with a tick where "almost at the limit" starts. */
function QuotaDial({ used, level }: { used: number | null; level: PlanLevel }) {
  const number = used === null ? "–" : String(used);
  return (
    <span className="quota-dial" data-level={used === null ? "none" : level} data-long={number.length > 2 || undefined}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="quota-dial__disc" cx={CENTER} cy={CENTER} r={RADIUS} />
        <circle className="quota-dial__track" cx={CENTER} cy={CENTER} r={RADIUS} />
        <circle
          className="quota-dial__tick"
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          strokeDasharray={`${TICK} ${AROUND}`}
          strokeDashoffset={-(PLAN_ALMOST / 100) * AROUND + TICK / 2}
        />
        {used !== null && used > 0 && (
          <circle
            className="quota-dial__used"
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            strokeDasharray={`${(Math.min(used, 100) / 100) * AROUND} ${AROUND}`}
          />
        )}
      </svg>
      <span className="quota-dial__num" aria-hidden="true">
        {number}
      </span>
    </span>
  );
}

/**
 * The plan limits ring (ADR 0063 addendum 2026-11-18), beside the bell on every screen: how much of its limit the
 * account closest to one has used, the number always written in it, the color the meters give that percent. Resting on
 * it, focusing it or pressing it opens every account with its windows and a way to Cotas. Nothing while the workspace
 * has no AI account; a dash while none reports limits.
 */
export function QuotaRing({ side = "top" }: { side?: "top" | "bottom" | "right" }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const usage = usePlanUsage(org.id);
  const mine = useAiAccounts(org.id);
  const card = useHoverCard(HOVER_OPEN_MS);
  // Keyboard focus shows it too, without taking the focus; Enter or Space then moves in.
  const [focused, setFocused] = useState(false);
  const open = card.open || (focused ? "hover" : false);
  const body = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Closed with the focus here or in the card: the focus comes back to the ring and doesn't open it again.
  const closing = useRef(false);
  useEffect(() => {
    if (open === "press") body.current?.querySelector("a")?.focus();
  }, [open]);
  const accounts = usage.data ? groupUsageAccounts(usage.data.accounts, mine.data) : [];
  if (accounts.length === 0) return null;
  const overview = quotaOverview(accounts);
  const top = overview.tightest;
  const level = quotaLevel(top);
  const label = quotaRingLabel(t, overview, (a) => accountName(t, a));
  // The head of the card: what the ring is showing, the window that sets it and when that renews.
  const text = planMeterText(t, i18n.language);
  const window = top ? overview.lines.find((l) => l.account === top.account)?.windows[0] : undefined;
  return (
    <Popover
      hover={card}
      open={open !== false}
      onOpenChange={(o) => {
        if (o) return;
        setFocused(false);
        // The card itself holds the focus where nothing in it took it.
        const inCard = body.current?.parentElement?.contains(document.activeElement) === true;
        closing.current = inCard || document.activeElement === button.current;
        if (inCard) button.current?.focus();
      }}
      moveFocus={open === "press"}
      label={t("quotas.ring.title")}
      side={side}
      align="end"
      className="quota-pop"
      trigger={
        <button
          ref={button}
          type="button"
          className="quota-ring"
          data-level={level}
          aria-label={label}
          aria-haspopup="dialog"
          // Shown by the focus, Enter or Space keeps it open and moves in, instead of Radix's toggle closing it.
          onClick={(e) => {
            if (!focused || card.open) return;
            e.preventDefault();
            setFocused(false);
            card.onOpenChange(true);
          }}
          onFocus={() => {
            if (closing.current) closing.current = false;
            else if (!open && movesByKeys()) setFocused(true);
          }}
          onBlur={(e) => {
            closing.current = false;
            if (!(e.relatedTarget instanceof Node && body.current?.contains(e.relatedTarget))) setFocused(false);
          }}
        >
          <QuotaDial used={top ? top.used : null} level={level} />
        </button>
      }
    >
      <div ref={body} className="quota-pop__in">
        <div className="quota-pop__top">
          {top && <QuotaDial used={top.used} level={level} />}
          <div className="quota-pop__lead">
            <p className="quota-pop__title">{t("quotas.ring.title")}</p>
            {top && (
              <p className="quota-pop__tightest">
                {accountName(t, top.account)}
                {window ? ` · ${text.window(window)}` : ""}
              </p>
            )}
            {window?.resetsAt && <p className="quota-pop__renews">{text.resets(window.resetsAt)}</p>}
          </div>
        </div>
        <ul className="quota-pop__list">
          {overview.lines.map((line) => (
            <QuotaPopLine key={line.account.key} line={line} locale={i18n.language} />
          ))}
        </ul>
        <Link
          className="quota-pop__more"
          to="/org/$orgId/settings/$section"
          params={{ orgId: org.id, section: "usage" }}
          search={{ view: "quotas" }}
          onClick={() => {
            card.close();
            setFocused(false);
          }}
        >
          {t("quotas.seeAll")}
          <Icon name="chevronRight" size={14} />
        </Link>
      </div>
    </Popover>
  );
}

/** One account: its mark and name, then each window's percent and reset, or why it has none and its recent use. */
function QuotaPopLine({ line, locale }: { line: QuotaLine; locale: string }) {
  const { t } = useTranslation();
  const text = planMeterText(t, locale);
  const { account, windows } = line;
  const recent = recentLines(t, locale, account.recent).at(-1);
  return (
    <li className="quota-pop__account">
      <div className="quota-pop__head">
        <ProviderLogo id={line.maker} size="xs" off={account.signedOut} />
        <span className="quota-pop__name">{accountName(t, account)}</span>
        <span className="quota-pop__brand">{line.brand}</span>
      </div>
      {windows.length > 0 ? (
        <ul className="quota-pop__windows">
          {windows.map((w) => (
            <li key={w.key} className="quota-pop__window" data-level={planLevel(w.used)}>
              <span className="quota-pop__wname">{text.window(w)}</span>
              <span className="quota-pop__pct">{w.used}%</span>
              <Meter value={w.used} max={100} label={text.window(w)} marks={[PLAN_ALMOST]} />
              {w.resetsAt && <span className="quota-pop__reset">{text.resets(w.resetsAt)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="quota-pop__none">{recent ? `${recent.label}: ${recent.value}` : noQuotaText(t, account)}</p>
      )}
    </li>
  );
}
