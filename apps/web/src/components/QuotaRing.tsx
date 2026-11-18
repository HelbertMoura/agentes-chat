import { useAiAccounts, usePlanUsage } from "@agenteschat/client";
import {
  noQuotaText,
  type QuotaLine,
  quotaLevel,
  quotaOverview,
  quotaRingLabel,
  recentLines,
} from "@agenteschat/client/lib/quotas";
import { movesByKeys, Popover, ProviderLogo, useHoverCard } from "@agenteschat/ui";
import { planLevel } from "@agenteschat/ui/plan-state";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { accountName, groupUsageAccounts, planMeterText } from "@/lib/plan-usage";
import { HOVER_OPEN_MS } from "./ProfileCard";
import "./quota-ring.css";

/** The ring's circle in its 24-unit box. */
const RADIUS = 10.5;
const AROUND = 2 * Math.PI * RADIUS;

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
  useEffect(() => {
    if (open === "press") body.current?.querySelector("a")?.focus();
  }, [open]);
  const accounts = usage.data ? groupUsageAccounts(usage.data.accounts, mine.data) : [];
  if (accounts.length === 0) return null;
  const overview = quotaOverview(accounts);
  const top = overview.tightest;
  const label = quotaRingLabel(t, overview, (a) => accountName(t, a));
  return (
    <Popover
      hover={card}
      open={open !== false}
      onOpenChange={(o) => {
        if (!o) setFocused(false);
      }}
      moveFocus={open === "press"}
      label={t("quotas.ring.title")}
      side={side}
      align="end"
      className="quota-pop"
      trigger={
        <button
          type="button"
          className="quota-ring"
          data-level={quotaLevel(top)}
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
            if (!open && movesByKeys()) setFocused(true);
          }}
          onBlur={(e) => {
            if (!(e.relatedTarget instanceof Node && body.current?.contains(e.relatedTarget))) setFocused(false);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle className="quota-ring__track" cx="12" cy="12" r={RADIUS} />
            {top && top.used > 0 && (
              <circle
                className="quota-ring__used"
                cx="12"
                cy="12"
                r={RADIUS}
                strokeDasharray={`${(Math.min(top.used, 100) / 100) * AROUND} ${AROUND}`}
              />
            )}
          </svg>
          <span className="quota-ring__num" aria-hidden="true">
            {top ? top.used : "–"}
          </span>
        </button>
      }
    >
      <div ref={body} className="quota-pop__in">
        <p className="quota-pop__title">{t("quotas.ring.title")}</p>
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
