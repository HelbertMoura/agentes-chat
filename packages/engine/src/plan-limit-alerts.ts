import { and, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { limitWindows, PLAN_CRITICAL, type PlanMeterUsage } from "@agenteschat/ui/plan-state";
import { BRAIN_PLAN_NAMES, isComputerBrain } from "./brains/types";
import { sha256 } from "./crypto";
import { type NotificationDeps, notify } from "./notifications";

const { agents, machineAccounts, machines, planLimitAlerts, rightHandBrains } = schema;

/**
 * A plan near its limit reaches the people it matters to (ADR 0063 addendum 2026-11-18): when a reading shows a window
 * at `PLAN_CRITICAL` or past it, once per account, window and reset period, whichever computer reported it and however
 * often. `plan_limit_alerts` holds what was told, so a restart or a repeated reading says nothing again.
 */

/** With no reset to go by, a window that stays near its limit is told again after this long. */
const NO_RESET_DAYS = 7;
/** A new period's reset is at least this far past the last one: closer, it is the same reset, read again. */
const SAME_RESET_MINUTES = 10;

/** The windows of this reading at the alert's line, not yet reset. */
export const windowsNearLimit = (usage: Pick<PlanMeterUsage, "windows">, now = Date.now()) =>
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

interface Alert {
  orgId: string;
  accountKey: string;
  /** Who hears it. */
  people: Iterable<string | null | undefined>;
  label: string;
  accountId?: string;
  machineId: string;
  usage: Pick<PlanMeterUsage, "windows">;
}

/** Claims each window near its limit and tells `people` of those nobody was told of in this period. */
async function alertAccount(deps: NotificationDeps, a: Alert, now: Date) {
  const at = now.toISOString();
  for (const w of windowsNearLimit(a.usage, now.getTime())) {
    const windowKey = `${w.kind}:${w.label ?? ""}`;
    const resetsAt = w.resetsAt ? new Date(w.resetsAt) : null;
    // One statement, so two computers reporting one account at once tell it once. A row is taken over only once its
    // period is over; a reset that merely moved a little (counted from the moment of the reading) is the same period.
    const [won] = await deps.db
      .insert(planLimitAlerts)
      .values({ orgId: a.orgId, accountKey: a.accountKey, windowKey, resetsAt, alertedAt: now })
      .onConflictDoUpdate({
        target: [planLimitAlerts.orgId, planLimitAlerts.accountKey, planLimitAlerts.windowKey],
        set: { resetsAt, alertedAt: now },
        setWhere: sql`coalesce(${planLimitAlerts.resetsAt}, ${planLimitAlerts.alertedAt} + make_interval(days => ${NO_RESET_DAYS})) <= ${at}::timestamptz
          and (excluded.resets_at is null or ${planLimitAlerts.resetsAt} is null
            or excluded.resets_at > ${planLimitAlerts.resetsAt} + make_interval(mins => ${SAME_RESET_MINUTES}))`,
      })
      .returning({ orgId: planLimitAlerts.orgId });
    if (!won) continue;
    const period = resetsAt ? resetsAt.getTime() : `day:${at.slice(0, 10)}`;
    try {
      await notify(deps, {
        orgId: a.orgId,
        userIds: a.people,
        kind: "plan_limit_near",
        groupKey: `plan_limit_near:${a.accountKey}:${windowKey}:${period}`,
        source: { machineId: a.machineId, ...(a.accountId ? { accountId: a.accountId } : {}), label: a.label },
        latest: {
          percent: Math.round(w.used),
          window: { kind: w.kind, ...(w.label ? { label: w.label } : {}) },
          ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}),
        },
      });
    } catch (error) {
      // Nobody was told for sure: the next reading tries again (the notification's own key keeps it from doubling).
      await deps.db
        .delete(planLimitAlerts)
        .where(
          and(
            eq(planLimitAlerts.orgId, a.orgId),
            eq(planLimitAlerts.accountKey, a.accountKey),
            eq(planLimitAlerts.windowKey, windowKey),
          ),
        );
      throw error;
    }
  }
}

/**
 * After a computer reported usage: its accounts and its own sign-ins near a limit are told. Who hears an account:
 * whoever connected it (on any computer it is signed in on), the people whose agents think with it and those who chose
 * it for their own right hand. It may serve the whole workspace, but the others have no stake in it until they use it.
 * An account of nobody goes to the computer's pairer. A computer's own sign-in thinks for its pairer's agents: its pairer.
 */
export async function alertPlanLimits(deps: NotificationDeps, orgId: string, machineId: string) {
  const now = deps.now?.() ?? new Date();
  const [machine] = await deps.db
    .select({ name: machines.name, pairer: machines.pairedByUserId, executors: machines.executors })
    .from(machines)
    .where(and(eq(machines.orgId, orgId), eq(machines.id, machineId), isNull(machines.deletedAt)));
  if (!machine) return;
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
    const accountKey = accountKeyOf(orgId, row);
    const logins = rows.filter((r) => accountKeyOf(orgId, r) === accountKey);
    const ids = logins.map((r) => r.id);
    const [thinking, ownAi] = await Promise.all([
      deps.db
        .select({ userId: agents.ownerUserId })
        .from(agents)
        .where(and(eq(agents.orgId, orgId), inArray(agents.brainAccountId, ids), isNull(agents.archivedAt))),
      deps.db
        .select({ userId: rightHandBrains.userId })
        .from(rightHandBrains)
        .where(and(eq(rightHandBrains.orgId, orgId), inArray(rightHandBrains.brainAccountId, ids))),
    ]);
    await alertAccount(
      deps,
      {
        orgId,
        accountKey,
        people: [
          ...logins.map((r) => r.createdBy ?? machine.pairer),
          ...thinking.map((r) => r.userId),
          ...ownAi.map((r) => r.userId),
        ],
        label: row.label,
        accountId: row.id,
        machineId,
        usage: row.usage,
      },
      now,
    );
  }
  for (const [kind, usage] of Object.entries(machine.executors?.ownUsage ?? {})) {
    if (!usage || !isComputerBrain(kind)) continue;
    await alertAccount(
      deps,
      {
        orgId,
        accountKey: sha256(`${orgId}:own:${machineId}:${kind}`).slice(0, 32),
        people: [machine.pairer],
        label: `${BRAIN_PLAN_NAMES[kind]} · ${machine.name}`,
        machineId,
        usage,
      },
      now,
    );
  }
}
