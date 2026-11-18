import { afterEach, expect, test } from "bun:test";
import { ACCOUNTS_PROTOCOL, type PlanUsage, type RunnerAccountInfo } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { noticeOn, setNoticePref, storeOwnUsage, syncMachineAccounts } from "../src";
import { alertPlanLimits } from "../src/plan-limit-alerts";
import { addMember, type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/** ADR 0063 addendum 2026-11-18: an AI account at 90% of a window tells its people once per reset period. */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const ACCOUNT = "0193eeee-0000-4000-8000-000000000001";
const SECOND = "0193eeee-0000-4000-8000-000000000002";
const HOUR = 3600_000;
const soon = (hours = 2) => new Date(Date.now() + hours * HOUR).toISOString();

const reading = (usedPercent: number, resetsAt: string | undefined = soon(), kind = "five_hour"): PlanUsage =>
  ({
    windows: [{ kind, usedPercent, ...(resetsAt ? { resetsAt } : {}) }],
    source: "probe",
    at: new Date().toISOString(),
  }) as PlanUsage;

const report = (id: string, usage: PlanUsage): RunnerAccountInfo => ({
  id,
  kind: "claude_code",
  loggedIn: true,
  email: "ana@example.com",
  shared: true,
  usage,
});

async function computer(name = "mac") {
  const { machineId } = await pairMachine({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, {
    name,
    hostname: name,
    os: "darwin",
    arch: "arm64",
    version: "0.9.0",
    workspace: "/Users/a/agentes",
    protocol: ACCOUNTS_PROTOCOL,
    exec: true,
  });
  return machineId;
}

const addAccount = (machineId: string, id = ACCOUNT, over: Record<string, unknown> = {}) =>
  f.db.insert(schema.machineAccounts).values({
    id,
    orgId: f.org.id,
    machineId,
    kind: "claude_code",
    label: "Trabalho",
    email: "ana@example.com",
    status: "active",
    shared: true,
    createdBy: f.owner.id,
    ...over,
  });

const deps = () => ({ db: f.db, pubsub: f.pubsub });
const sync = (machineId: string, ...accounts: RunnerAccountInfo[]) =>
  syncMachineAccounts(deps(), f.org.id, machineId, accounts);
const told = () => f.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "plan_limit_near"));
const setUsage = (usage: PlanUsage) =>
  f.db
    .update(schema.machineAccounts)
    .set({ usage: usage as never })
    .where(eq(schema.machineAccounts.id, ACCOUNT));

test("crossing 90% tells the owner once, however often it is reported", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const resetsAt = soon();
  await sync(machineId, report(ACCOUNT, reading(89, resetsAt)));
  expect(await told()).toHaveLength(0);
  await sync(machineId, report(ACCOUNT, reading(90, resetsAt)));
  await sync(machineId, report(ACCOUNT, reading(93, resetsAt)));
  await sync(machineId, report(ACCOUNT, reading(100, resetsAt)));
  const rows = await told();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    userId: f.owner.id,
    source: { label: "Trabalho", accountId: ACCOUNT, machineId },
    latest: { percent: 90, window: { kind: "five_hour" }, resetsAt },
  });
  // Never the account's address, in the row or in what is kept of the alert.
  expect(JSON.stringify(rows[0])).not.toContain("ana@example.com");
  expect(JSON.stringify(await f.db.select().from(schema.planLimitAlerts))).not.toContain("ana@example.com");
});

test("what was told survives a restart, and a reset that moved a little is the same period", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const at = Date.now() + 2 * HOUR;
  await sync(machineId, report(ACCOUNT, reading(95, new Date(at).toISOString())));
  // As after a restart: only the table remembers. The provider counted the reset from a later moment.
  await alertPlanLimits(deps(), f.org.id, machineId);
  await sync(machineId, report(ACCOUNT, reading(96, new Date(at + 90_000).toISOString())));
  expect(await told()).toHaveLength(1);
});

test("the next period tells again; a window already reset says nothing", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const first = Date.now() + 2 * HOUR;
  await sync(machineId, report(ACCOUNT, reading(91, new Date(first).toISOString())));
  const late = { ...deps(), now: () => new Date(first + 60_000) };
  // The old reading, read after its reset: empty by now.
  await alertPlanLimits(late, f.org.id, machineId);
  expect(await told()).toHaveLength(1);
  // A reading a moment past the reset, its time barely moved: still that period.
  await setUsage(reading(92, new Date(first + 120_000).toISOString()));
  await alertPlanLimits(late, f.org.id, machineId);
  expect(await told()).toHaveLength(1);
  // The window after it.
  const next = new Date(first + 5 * HOUR).toISOString();
  await setUsage(reading(92, next));
  await alertPlanLimits(late, f.org.id, machineId);
  const rows = await told();
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.latest.resetsAt)).toContain(next);
});

test("each window has its own alert; extra usage and a model's own week have none", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const usage = {
    windows: [
      { kind: "five_hour", usedPercent: 95, resetsAt: soon(2) },
      { kind: "seven_day", usedPercent: 92, resetsAt: soon(40) },
      { kind: "other", label: "Extra usage", usedPercent: 100 },
      { kind: "other", label: "Fable", usedPercent: 100, resetsAt: soon(40) },
    ],
    source: "probe",
    at: new Date().toISOString(),
  } as PlanUsage;
  await sync(machineId, report(ACCOUNT, usage));
  expect((await told()).map((r) => (r.latest as { window?: { kind: string } }).window?.kind).sort()).toEqual([
    "five_hour",
    "seven_day",
  ]);
});

test("a window with no reset is told once, again only a week later", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  const usage = {
    windows: [{ kind: "monthly", usedPercent: 97 }],
    source: "probe",
    at: new Date().toISOString(),
  } as PlanUsage;
  await sync(machineId, report(ACCOUNT, usage));
  await alertPlanLimits({ ...deps(), now: () => new Date(Date.now() + 6 * 24 * HOUR) }, f.org.id, machineId);
  expect(await told()).toHaveLength(1);
  await alertPlanLimits({ ...deps(), now: () => new Date(Date.now() + 8 * 24 * HOUR) }, f.org.id, machineId);
  expect(await told()).toHaveLength(2);
});

test("one account on two computers is told once, to both people who connected it", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const one = await computer("one");
  const two = await computer("two");
  await addAccount(one);
  await addAccount(two, SECOND, { createdBy: bia.id });
  const resetsAt = soon();
  await sync(one, report(ACCOUNT, reading(91, resetsAt)));
  await sync(two, report(SECOND, reading(91, resetsAt)));
  expect((await told()).map((r) => r.userId).sort()).toEqual([f.owner.id, bia.id].sort());
});

test("whose agents think with it hear it; the rest of the workspace does not", async () => {
  f = await setup();
  const bia = await addMember(f.db, f.org.id, "member", "Bia");
  const caio = await addMember(f.db, f.org.id, "member", "Caio");
  const machineId = await computer();
  await addAccount(machineId, ACCOUNT, { serves: "everyone" });
  await f.db
    .update(schema.agents)
    .set({ machineId, brain: "claude_code", brainAccountId: ACCOUNT, ownerUserId: bia.id })
    .where(eq(schema.agents.id, f.agent.id));
  await sync(machineId, report(ACCOUNT, reading(92)));
  const people = (await told()).map((r) => r.userId);
  expect(people.sort()).toEqual([f.owner.id, bia.id].sort());
  expect(people).not.toContain(caio.id);
});

test("a computer's own sign-in tells who connected the computer", async () => {
  f = await setup();
  const machineId = await computer();
  await storeOwnUsage(deps(), f.org.id, machineId, { claude_code: reading(94) });
  await storeOwnUsage(deps(), f.org.id, machineId, { claude_code: reading(95) });
  const rows = await told();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ userId: f.owner.id, source: { label: "Claude · mac", machineId } });
  expect(rows[0]?.source.accountId).toBeUndefined();
});

test("a signed-out account says nothing", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId, ACCOUNT, { status: "signed_out", usage: reading(99) });
  await alertPlanLimits(deps(), f.org.id, machineId);
  expect(await told()).toHaveLength(0);
  expect(await f.db.select().from(schema.planLimitAlerts)).toHaveLength(0);
});

test("the person can turn the phone's alert off: the inbox keeps it", async () => {
  f = await setup();
  expect(noticeOn({}, "plan_limit_near", false)).toBe(true);
  const view = await setNoticePref(f.db, f.org.id, f.owner.id, "plans", false);
  expect(view.categories.find((c) => c.id === "plans")?.on).toBe(false);
  const machineId = await computer();
  await addAccount(machineId);
  await f.db.insert(schema.pushDevices).values({
    userId: f.owner.id,
    platform: "android",
    token: "phone-token",
    locale: "pt-BR",
  });
  await sync(machineId, report(ACCOUNT, reading(92)));
  expect(await told()).toHaveLength(1);
  expect(await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "push.send"))).toHaveLength(0);
});

test("with the alert on, it goes to the phone through the usual job", async () => {
  f = await setup();
  const machineId = await computer();
  await addAccount(machineId);
  await f.db.insert(schema.pushDevices).values({
    userId: f.owner.id,
    platform: "android",
    token: "phone-token",
    locale: "pt-BR",
  });
  await sync(machineId, report(ACCOUNT, reading(92)));
  expect(await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "push.send"))).toHaveLength(1);
});
