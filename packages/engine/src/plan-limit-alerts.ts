import { isAccountKind } from "@agenteschat/adapters";
import { and, type Database, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { isPlanId } from "@agenteschat/providers/plans";
import { limitWindows, PLAN_CRITICAL, type PlanMeterUsage, windowLengthMs } from "@agenteschat/ui/plan-state";
import { BRAIN_PLAN_NAMES, isComputerBrain } from "./brains/types";
import { sha256 } from "./crypto";
import { isDefaultAccountLabel } from "./machine-accounts";
import {
  announceNotifications,
  type NotificationDeps,
  type WrittenNotification,
  writeNotifications,
} from "./notifications";
import { enqueuePush } from "./push";

const { agents, machineAccounts, machines, planLimitAlerts, rightHandBrains } = schema;

/**
 * A plan near its limit reaches the people it matters to (ADR 0063 addendum 2026-11-18): when a reading shows a window
 * at `PLAN_CRITICAL` or past it, once per account, window and reset period, whichever computer reported it and however
 * often. `plan_limit_alerts` holds what was told; the claim, the inbox rows and their push jobs commit together, so a
 * crash or a failure tells nobody and the next reading tries again.
 */

/** A reset this close to the one told of is the same reset, read again (some providers count it from the reading). */
const SAME_RESET_SECONDS = 600;

export interface PlanAlertDeps extends NotificationDeps {
  /** A failed alert is logged here: it never reaches what stores usage or runs a turn. */
  log?: { warn(message: string, data?: Record<string, unknown>): void };
}

/** The windows of this reading at the alert's line, neither reset nor past their length. */
export const windowsNearLimit = (usage: Pick<PlanMeterUsage, "windows" | "at">, now = Date.now()) =>
  limitWindows(usage, now).filter((w) => w.used >= PLAN_CRITICAL);

type AccountRow = Pick<
  typeof machineAccounts.$inferSelect,
  "id" | "machineId" | "kind" | "label" | "email" | "provider" | "keyHint" | "providerOrgId" | "createdBy" | "usage"
>;

/**
 * What makes logins one account for the provider, so its limits are told once: its email (with Claude's organization),
 * or its owner's key by its last 4. Hashed: the table holds no address.
 */
function accountKeyOf(orgId: string, a: AccountRow): string {
  const who = a.provider
    ? a.keyHint && `key:${a.provider}:${a.createdBy ?? ""}:${a.keyHint}`
    : a.email && `email:${a.kind}:${a.email.toLowerCase()}:${a.providerOrgId ?? ""}`;
  return sha256(`${orgId}:${who || `id:${a.id}`}`).slice(0, 32);
}

/** The account as its own connector reads it in the apps (`accountName`): their name for it, else its email. */
function ownName(a: AccountRow): string {
  if (a.kind === "opencode" || isPlanId(a.provider) || !isAccountKind(a.kind)) return a.label;
  return isDefaultAccountLabel(a.kind, a.label, a.provider) ? (a.email ?? a.label) : a.label;
}

interface Alert {
  orgId: string;
  accountKey: string;
  /** Who hears it, each with the account's name as they read it. */
  people: Map<string, string>;
  accountId?: string;
  machineId: string;
  usage: PlanMeterUsage;
}

/** Claims each window near its limit and tells `people` of those nobody was told of in this period. */
async function alertAccount(deps: PlanAlertDeps, a: Alert, now: Date) {
  const nowMs = now.getTime();
  // The reading's own time orders readings: one that arrives late from another computer never counts as newer.
  const readAt = new Date(Math.min(Date.parse(a.usage.at) || nowMs, nowMs));
  const named = new Map<string, string[]>();
  for (const [userId, name] of a.people) named.set(name, [...(named.get(name) ?? []), userId]);
  for (const w of windowsNearLimit(a.usage, nowMs)) {
    const windowKey = `${w.kind}:${w.label ?? ""}`;
    const resetsAt = w.resetsAt ? new Date(w.resetsAt) : null;
    const t = planLimitAlerts;
    const written = await deps.db.transaction(async (tx) => {
      // One statement, so two computers reporting one account at once tell it once. A newer reading takes the row when
      // its reset is another one; with no reset to compare, when the last period is over.
      const [won] = await tx
        .insert(t)
        .values({ orgId: a.orgId, accountKey: a.accountKey, windowKey, resetsAt, alertedAt: readAt })
        .onConflictDoUpdate({
          target: [t.orgId, t.accountKey, t.windowKey],
          set: { resetsAt, alertedAt: readAt },
          setWhere: sql`excluded.alerted_at > ${t.alertedAt} and (
            (excluded.resets_at is not null and (${t.resetsAt} is null
              or abs(extract(epoch from excluded.resets_at - ${t.resetsAt})) > ${SAME_RESET_SECONDS}))
            or (excluded.resets_at is null and (
              ${t.resetsAt} <= ${now.toISOString()}::timestamptz
              or (${t.resetsAt} is null
                and excluded.alerted_at >= ${t.alertedAt} + make_interval(secs => ${windowLengthMs(w) / 1000})))))`,
        })
        .returning({ orgId: t.orgId });
      if (!won) return [];
      const period = resetsAt ? resetsAt.getTime() : `read:${readAt.getTime()}`;
      const out: WrittenNotification[] = [];
      for (const [label, userIds] of named)
        out.push(
          ...(await writeNotifications(
            { db: tx, ...(deps.now ? { now: deps.now } : {}) },
            {
              orgId: a.orgId,
              userIds,
              kind: "plan_limit_near",
              groupKey: `plan_limit_near:${a.accountKey}:${windowKey}:${period}`,
              source: { machineId: a.machineId, ...(a.accountId ? { accountId: a.accountId } : {}), label },
              latest: {
                percent: Math.round(w.used),
                window: { kind: w.kind, ...(w.label ? { label: w.label } : {}) },
                ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}),
              },
            },
          )),
        );
      for (const { row, prefs } of out) if (row.count === 1) await enqueuePush(tx, row, now, prefs);
      return out;
    });
    // Committed: telling open screens may fail without undoing it.
    await announceNotifications(deps, written, { push: false }).catch((error) =>
      deps.log?.warn("plan limit alert not announced", { orgId: a.orgId, error: String(error) }),
    );
  }
}

/** Who hears an account near its limit, each with the name they know it by. */
async function peopleOf(
  db: Database,
  orgId: string,
  row: AccountRow,
  logins: AccountRow[],
  pairers: Map<string, string | null>,
) {
  const ids = logins.map((r) => r.id);
  const [thinking, ownAi] = await Promise.all([
    db
      .select({ userId: agents.ownerUserId })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), inArray(agents.brainAccountId, ids), isNull(agents.archivedAt))),
    db
      .select({ userId: rightHandBrains.userId })
      .from(rightHandBrains)
      .where(and(eq(rightHandBrains.orgId, orgId), inArray(rightHandBrains.brainAccountId, ids))),
  ]);
  const people = new Map<string, string>();
  for (const r of [...thinking, ...ownAi]) if (r.userId) people.set(r.userId, row.label);
  for (const l of logins) {
    // Nobody's login goes to who connected its own computer, who reads it by its name.
    const pairer = l.createdBy ? null : pairers.get(l.machineId);
    if (pairer && !people.has(pairer)) people.set(pairer, row.label);
  }
  for (const l of logins) if (l.createdBy) people.set(l.createdBy, ownName(l));
  return people;
}

/**
 * After a computer reported usage: its accounts and its own sign-ins near a limit are told. Who hears an account:
 * whoever connected it (on any computer it is signed in on), the people whose agents think with it and those who chose
 * it for their own right hand. It may serve the whole workspace, but the others have no stake in it until they use it.
 * An account of nobody goes to its computer's pairer. A computer's own sign-in thinks for its pairer's agents: its
 * pairer, unless it is signed out. Never throws: each account stands alone and a failure is logged.
 */
export async function alertPlanLimits(deps: PlanAlertDeps, orgId: string, machineId: string) {
  const failed = (error: unknown) =>
    deps.log?.warn("plan limit alert failed", { orgId, machineId, error: String(error) });
  try {
    const now = deps.now?.() ?? new Date();
    const computers = await deps.db
      .select({
        id: machines.id,
        name: machines.name,
        pairer: machines.pairedByUserId,
        executors: machines.executors,
      })
      .from(machines)
      .where(and(eq(machines.orgId, orgId), isNull(machines.deletedAt)));
    const machine = computers.find((m) => m.id === machineId);
    if (!machine) return;
    const pairers = new Map(computers.map((m) => [m.id, m.pairer]));
    const rows: AccountRow[] = await deps.db
      .select({
        id: machineAccounts.id,
        machineId: machineAccounts.machineId,
        kind: machineAccounts.kind,
        label: machineAccounts.label,
        email: machineAccounts.email,
        provider: machineAccounts.provider,
        keyHint: machineAccounts.keyHint,
        providerOrgId: machineAccounts.providerOrgId,
        createdBy: machineAccounts.createdBy,
        usage: machineAccounts.usage,
      })
      .from(machineAccounts)
      .where(and(eq(machineAccounts.orgId, orgId), eq(machineAccounts.status, "active")));
    for (const row of rows) {
      if (row.machineId !== machineId || !row.usage) continue;
      if (windowsNearLimit(row.usage, now.getTime()).length === 0) continue;
      try {
        const accountKey = accountKeyOf(orgId, row);
        const logins = rows.filter((r) => accountKeyOf(orgId, r) === accountKey);
        const people = await peopleOf(deps.db, orgId, row, logins, pairers);
        await alertAccount(deps, { orgId, accountKey, people, accountId: row.id, machineId, usage: row.usage }, now);
      } catch (error) {
        failed(error);
      }
    }
    for (const [kind, usage] of Object.entries(machine.executors?.ownUsage ?? {})) {
      if (!usage || !isComputerBrain(kind) || !machine.pairer) continue;
      // As the usage views read it (`plan-usage.ts`): only Claude's CLI says it is signed out.
      if (kind === "claude_code" && machine.executors?.claude?.loggedIn === false) continue;
      try {
        await alertAccount(
          deps,
          {
            orgId,
            accountKey: sha256(`${orgId}:own:${machineId}:${kind}`).slice(0, 32),
            people: new Map([[machine.pairer, `${BRAIN_PLAN_NAMES[kind]} · ${machine.name}`]]),
            machineId,
            usage,
          },
          now,
        );
      } catch (error) {
        failed(error);
      }
    }
  } catch (error) {
    failed(error);
  }
}
