import { describe, expect, test } from "bun:test";
import {
  APPROVAL_BUTTONS,
  approvalButtonsOn,
  approvalDecision,
  pressedButton,
  takenOnce,
} from "../../src/features/approvals/push-actions";

const push = { kind: "approval", orgId: "o1", approvalId: "a1", server: "https://x.test", user: "u1" };

describe("approval buttons on a push", () => {
  test("offered only while the app lock is surely off", () => {
    expect(approvalButtonsOn(null)).toBe(true);
    expect(approvalButtonsOn("1")).toBe(false);
    // Unreadable is taken as on: deciding then needs the app opened behind the lock.
    expect(approvalButtonsOn(undefined)).toBe(false);
  });

  test("the buttons are Aprovar and Recusar, worded like the approval card", () => {
    expect(APPROVAL_BUTTONS.map(([id]) => id)).toEqual(["approve", "refuse"]);
  });

  test("a button decides only an approval's push with its ids", () => {
    expect(approvalDecision(push, "approve")).toEqual({ orgId: "o1", approvalId: "a1", decision: "approve" });
    expect(approvalDecision(push, "refuse")).toEqual({ orgId: "o1", approvalId: "a1", decision: "refuse" });
    // A plain tap, a device's button, another kind or a push without its ids decide nothing.
    expect(approvalDecision(push, "expo.modules.notifications.actions.DEFAULT")).toBeNull();
    expect(approvalDecision(push, "allow")).toBeNull();
    expect(approvalDecision({ ...push, kind: "device.join_request" }, "approve")).toBeNull();
    expect(approvalDecision({ kind: "approval", orgId: "o1" }, "approve")).toBeNull();
  });

  test("a response reads the same from the listener and from Android's background task", () => {
    const listener = {
      actionIdentifier: "approve",
      notification: { request: { identifier: "n1", content: { data: push } } },
    };
    const task = {
      actionIdentifier: "approve",
      notification: { request: { identifier: "n1", content: { dataString: JSON.stringify(push) } } },
    };
    const expected = { identifier: "n1", action: "approve", data: push };
    expect(pressedButton(listener)).toEqual(expected);
    expect(pressedButton(task)).toEqual(expected);
  });

  test("a received push, junk or unknown fields read as nothing or are dropped", () => {
    expect(pressedButton({ notification: { request: { identifier: "n1", content: {} } } })).toBeNull();
    expect(pressedButton(null)).toBeNull();
    expect(pressedButton("x")).toBeNull();
    const bad = {
      actionIdentifier: "approve",
      notification: { request: { identifier: "n1", content: { dataString: "{not json", data: null } } },
    };
    expect(pressedButton(bad)).toEqual({ identifier: "n1", action: "approve", data: {} });
    const extra = {
      actionIdentifier: "approve",
      notification: { request: { identifier: "n1", content: { data: { ...push, label: "x", approvalId: 3 } } } },
    };
    expect(pressedButton(extra)?.data).toEqual({ kind: "approval", orgId: "o1", server: "https://x.test", user: "u1" });
  });

  test("the task and the listener both hearing one press decide it once", () => {
    const take = takenOnce(2);
    expect(take("n1")).toBe(true);
    expect(take("n1")).toBe(false);
    expect(take("n2")).toBe(true);
    expect(take("n3")).toBe(true);
    // The oldest is forgotten past the limit.
    expect(take("n1")).toBe(true);
  });
});
