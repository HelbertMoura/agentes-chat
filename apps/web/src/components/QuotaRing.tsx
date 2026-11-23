import { useAiAccounts, usePlanUsage, useSetChatPrefs } from "@agenteschat/client";
import {
  noQuotaText,
  type QuotaLine,
  quotaLevel,
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
import { Icon, Meter, movesByKeys, Popover, ProviderLogo, useHoverCard } from "@agenteschat/ui";
import { PLAN_ALMOST, planLevel } from "@agenteschat/ui/plan-state";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { accountName, groupUsageAccounts, planMeterText } from "@/lib/plan-usage";
import { HOVER_OPEN_MS } from "./ProfileCard";
import "./quota-ring.css";

/**
 * The ring (ADR 0063 addendum 2026-11-23): a thin track and one arc for the account closest to a limit, its percent in
 * the middle. The arc is the soft text color with room, amber from 70% and red from 90% (`quotaRingTone`); it moves
 * only when the percent does, and not at all with reduced motion. A dash while none reports limits.
 */
function QuotaDial({ used }: { used: number | null }) {
  const shown = used === null ? 0 : Math.min(Math.max(used, 0), 100);
  return (
    <span className="quota-dial" data-tone={quotaRingTone(used)} data-used={used ?? "–"}>
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <circle className="quota-dial__track" cx="14" cy="14" r="12.5" />
        {shown > 0 && (
          <circle
            className="quota-dial__arc"
            cx="14"
            cy="14"
            r="12.5"
            pathLength={100}
            transform="rotate(-90 14 14)"
            style={{ strokeDasharray: `${shown} 100` }}
          />
        )}
        <text className="quota-dial__num" x="14" y="14">
          {used ?? "–"}
        </text>
      </svg>
    </span>
  );
}

/**
 * The plan limits ring (ADR 0063 addendum 2026-11-18), beside the account menu on every screen: how much of its limit the
 * account closest to one has used, the number always written in it, its arc toned by that percent. Resting on
 * it, focusing it or pressing it opens every account with its windows and a way to Cotas. Nothing while the workspace
 * has no AI account; a dash while none reports limits.
 */
export function QuotaRing({ side = "top" }: { side?: "top" | "bottom" | "right" }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const usage = usePlanUsage(org.id);
  const mine = useAiAccounts(org.id);
  const setPrefs = useSetChatPrefs(org.id);
  // The account whose color is being picked in the card.
  const [picking, setPicking] = useState<string | null>(null);
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
  const chosen = org.chatPrefs?.ringColors;
  const now = Date.now();
  const overview = quotaOverview(accounts, now, chosen);
  const top = overview.tightest;
  const alert = quotaPaceAlert(overview, now);
  const label = quotaRingLabel(t, overview, (a) => accountName(t, a));
  const text = planMeterText(t, i18n.language);
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
            if (closing.current) closing.current = false;
            else if (!open && movesByKeys()) setFocused(true);
          }}
          onBlur={(e) => {
            closing.current = false;
            if (!(e.relatedTarget instanceof Node && body.current?.contains(e.relatedTarget))) setFocused(false);
          }}
        >
          <QuotaDial used={top?.used ?? null} />
        </button>
      }
    >
      <div ref={body} className="quota-pop__in">
        <div className="quota-pop__top">
          {top && <QuotaDial used={top?.used ?? null} />}
          <div className="quota-pop__lead">
            <p className="quota-pop__title">{t("quotas.ring.title")}</p>
            {alert && (
              <p className="quota-pop__pace" data-hits="">
                {quotaPaceAlertText(t, i18n.language, alert, accountName(t, alert.account), now)}
              </p>
            )}
            {top && (
              <ul className="quota-pop__keys">
                {overview.rings.map((r) => (
                  <li key={r.account.key} className="quota-pop__key" data-level={r.level} data-hue={r.hue}>
                    <button
                      type="button"
                      className="quota-pop__dot"
                      aria-label={accountName(t, r.account)}
                      aria-expanded={picking === r.account.key}
                      onClick={() => setPicking(picking === r.account.key ? null : r.account.key)}
                    />
                    <span className="quota-pop__keyname">
                      {accountName(t, r.account)}
                      {r.window ? <small>{text.short(r.window)}</small> : null}
                    </span>
                    <b>{r.used}%</b>
                    {picking === r.account.key && (
                      <div className="quota-pop__hues" role="radiogroup" aria-label={accountName(t, r.account)}>
                        {WALLPAPER_HUES.map((hue, i) => (
                          // biome-ignore lint/a11y/useSemanticElements: a row of color swatches, not a form's radios
                          <button
                            key={hue}
                            type="button"
                            role="radio"
                            aria-checked={r.hue === hue}
                            aria-label={`${accountName(t, r.account)} ${i + 1}`}
                            data-hue={hue}
                            onClick={() => {
                              setPrefs.mutate({ ringColors: { ...chosen, [r.account.key]: hue } });
                              setPicking(null);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <ul className="quota-pop__list">
          {overview.lines.map((line) => (
            <QuotaPopLine key={line.account.key} line={line} locale={i18n.language} now={now} />
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

/** One account: its mark and name, then each window's percent, reset and pace, or why it has none and its recent use. */
function QuotaPopLine({ line, locale, now }: { line: QuotaLine; locale: string; now: number }) {
  const { t } = useTranslation();
  const text = planMeterText(t, locale);
  const { account, windows } = line;
  const recent = recentLines(t, locale, account.recent).at(-1);
  return (
    <li className="quota-pop__account" data-hue={line.hue}>
      <div className="quota-pop__head">
        <ProviderLogo id={line.maker} size="xs" off={account.signedOut} />
        <span className="quota-pop__name">{accountName(t, account)}</span>
        <span className="quota-pop__brand">{line.brand}</span>
      </div>
      {windows.length > 0 ? (
        <ul className="quota-pop__windows">
          {windows.map((w) => {
            const pace = quotaPace(w, now);
            return (
              <li key={w.key} className="quota-pop__window" data-level={planLevel(w.used)}>
                <span className="quota-pop__wname">{text.window(w)}</span>
                <span className="quota-pop__pct">{w.used}%</span>
                <Meter value={w.used} max={100} label={text.window(w)} marks={[PLAN_ALMOST]} />
                {w.resetsAt && <span className="quota-pop__reset">{text.resets(w.resetsAt)}</span>}
                {pace && (
                  <span className="quota-pop__pace" data-hits={pace.kind === "hits" ? "" : undefined}>
                    {quotaPaceText(t, locale, pace, now)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="quota-pop__none">{recent ? `${recent.label}: ${recent.value}` : noQuotaText(t, account)}</p>
      )}
    </li>
  );
}
