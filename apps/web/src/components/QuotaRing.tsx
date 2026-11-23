import { useAiAccounts, usePlanUsage, useSetChatPrefs } from "@agenteschat/client";
import {
  noQuotaText,
  QUOTA_DIAL,
  type QuotaLine,
  type QuotaRingLine,
  quotaDialRadii,
  quotaDialShowsNumber,
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
 * The ring (ADR 0063 addendum 2026-11-23): one thin circle per account in use (`rings`, up to three), the closest to a
 * limit outermost, each a faint track and an arc with round ends in its account's own color, amber from 70% and red
 * from 90% (`quotaRingTone`). The largest percent in the middle while it fits (one or two rings). An arc moves only when
 * its percent does, and not at all with reduced motion. A dash on one track while none reports limits.
 */
function QuotaDial({ rings }: { rings: readonly QuotaRingLine[] }) {
  const top = rings[0];
  const c = QUOTA_DIAL.size / 2;
  return (
    <span
      className="quota-dial"
      data-tone={quotaRingTone(top?.used)}
      data-used={top?.used ?? "–"}
      data-rings={rings.length}
    >
      <svg viewBox={`0 0 ${QUOTA_DIAL.size} ${QUOTA_DIAL.size}`} aria-hidden="true">
        {quotaDialRadii(rings.length).map((r, i) => {
          const ring = rings[i];
          const shown = ring ? Math.min(Math.max(ring.used, 0), 100) : 0;
          return (
            // By place, not account: a ring whose percent changes moves instead of being drawn again.
            // biome-ignore lint/suspicious/noArrayIndexKey: the rings are places, outermost first
            <g key={i} data-hue={ring?.hue} data-tone={ring?.tone}>
              <circle className="quota-dial__track" cx={c} cy={c} r={r} />
              {shown > 0 && (
                <circle
                  className="quota-dial__arc"
                  cx={c}
                  cy={c}
                  r={r}
                  pathLength={100}
                  transform={`rotate(-90 ${c} ${c})`}
                  style={{ strokeDasharray: `${shown} 100` }}
                />
              )}
            </g>
          );
        })}
        {quotaDialShowsNumber(rings.length) && (
          <text className="quota-dial__num" x={c} y={c}>
            {top?.used ?? "–"}
          </text>
        )}
      </svg>
    </span>
  );
}

/**
 * The plan limits ring (ADR 0063 addendum 2026-11-18), beside the account menu on every screen: how much of its limits
 * each account in use has used, one circle each (`QuotaDial`), its name listing them all. Resting on
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
          <QuotaDial rings={overview.rings} />
        </button>
      }
    >
      <div ref={body} className="quota-pop__in">
        <div className="quota-pop__top">
          {top && <QuotaDial rings={overview.rings} />}
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
