import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { decideFromPush } from "./push";
import { APPROVAL_TASK, pressedButton } from "./push-actions";

/**
 * Android hands a button pressed with the app in the background or closed to this task, run without the app's screens
 * (expo-task-manager); with the app in front, the push provider's listener takes it. Defined by the app's entry
 * (`index.ts`) before anything else, as the task manager requires. Every push received in the background also reaches
 * it and is let go at once. An iPhone runs the button in the app it wakes, through the listener.
 */
TaskManager.defineTask(APPROVAL_TASK, async ({ data }) => {
  const pressed = pressedButton(data);
  if (pressed) await decideFromPush(pressed);
});

if (Platform.OS === "android") void Notifications.registerTaskAsync(APPROVAL_TASK).catch(() => undefined);
