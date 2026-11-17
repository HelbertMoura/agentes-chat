import * as Notifications from "expo-notifications";
import type { TFunction } from "i18next";
import { createApi } from "@/lib/api";
import { placeAccounts, placeKey, signedInServers } from "@/lib/server";
import { pushPlace } from "@/lib/server-choice";
import { readValueSyncOrUnknown, STORED } from "@/lib/storage";
import {
  APPROVAL_BUTTONS,
  APPROVAL_CATEGORY,
  approvalButtonsOn,
  approvalDecision,
  type PressedButton,
  takenOnce,
} from "./push-actions";

/** Whether the buttons are offered, from the app lock's switch on this phone (ADR 0260: "1" while on). */
const buttonsOn = () => approvalButtonsOn(readValueSyncOrUnknown(STORED.appLock));

/**
 * Aprovar and Recusar on the notification of an approval that isn't high risk, decided without opening the app
 * (ADR 0035 addendum). Not while the app lock is on (ADR 0260): the category is taken away, so such a push shows no
 * buttons and a tap opens the app behind the lock. Registered again whenever the app leaves the front, so turning
 * the lock on or off reaches the next push. On an iPhone the phone must be unlocked to run one.
 */
export function registerApprovalActions(t: TFunction) {
  const done = buttonsOn()
    ? Notifications.setNotificationCategoryAsync(
        APPROVAL_CATEGORY,
        APPROVAL_BUTTONS.map(([identifier, key]) => ({
          identifier,
          buttonTitle: t(key),
          options: {
            opensAppToForeground: false,
            isDestructive: identifier === "refuse",
            isAuthenticationRequired: true,
          },
        })),
      )
    : Notifications.deleteNotificationCategoryAsync(APPROVAL_CATEGORY);
  return done.catch(() => undefined);
}

const taken = takenOnce();

/**
 * Decides an approval from its notification's button, on the account the push is for (ADR 0183), and clears the
 * notification once the server took it. Null when the press isn't an approval's button. A failure (no network, already
 * decided elsewhere, expired) leaves the notification where it is: a tap on it opens the request in the app.
 */
export function decideFromPush(pressed: PressedButton): Promise<void> | null {
  const decision = approvalDecision(pressed.data, pressed.action);
  if (!decision) return null;
  if (!taken(pressed.identifier) || !buttonsOn()) return Promise.resolve();
  const place = pushPlace(pressed.data.server, placeKey(), signedInServers(), {
    user: pressed.data.user,
    accounts: placeAccounts(),
  });
  if (place.kind === "gone") return Promise.resolve();
  const api = createApi(place.kind === "switch" ? place.server : placeKey());
  const { orgId, approvalId } = decision;
  const decided =
    decision.decision === "approve"
      ? api.approvals.approve(orgId, approvalId)
      : api.approvals.refuse(orgId, approvalId);
  return decided.then(
    () => Notifications.dismissNotificationAsync(pressed.identifier).catch(() => undefined),
    () => undefined,
  );
}
