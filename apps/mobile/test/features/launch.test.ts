import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LAUNCH,
  LOGO,
  LOGO_LOOK,
  launchLookOf,
  launchPose,
  launchSkyTones,
  SPRITES,
  spriteBlinks,
  spriteY,
  waitLine,
} from "../../src/features/launch/logic";

describe("launch splash", () => {
  test("starts on the native image: the body is 400 of its 512 px at 120 pt", () => {
    expect(LOGO).toBeCloseTo(93.75, 5);
  });

  test("one line only once it's late: why it waits", () => {
    expect(waitLine(false, true)).toBeNull();
    expect(waitLine(true, false)).toBe("slow");
    expect(waitLine(true, true)).toBe("offline");
  });

  test("the agent looks down at the sky, back up, smiles; closes its eyes offline; smiles leaving", () => {
    // Native frame: facing ahead, eyes open, like the launch image.
    expect(launchPose(0)).toEqual({ turn: [0, 0], blink: false });
    expect(launchPose(0.4).turn?.[1]).toBeGreaterThan(0.5);
    expect(launchPose(0.89).turn?.[1]).toBeLessThan(0);
    expect(launchPose(1.2).expression).toBe("happy");
    expect(launchPose(LAUNCH.lineAfter + 0.1, { offline: true }).expression).toBe("closed");
    expect(launchPose(1, { offline: true }).expression).not.toBe("closed");
    expect(launchPose(3, { offline: true, leaving: true }).expression).toBe("happy");
  });

  test("the sprites stay inside the sky as they rise, and wait while it is low", () => {
    for (const s of SPRITES) {
      expect(spriteY(s, 1, 0.1)).toBeNull();
      for (let t = 0; t < 30; t += 0.7) {
        const y = spriteY(s, t, LAUNCH.sky);
        expect(y).not.toBeNull();
        // From near the bottom up to a little under the sky's top (it starts at 1 - 0.5).
        expect(y as number).toBeLessThanOrEqual(0.95);
        expect(y as number).toBeGreaterThan(1 - LAUNCH.sky + 0.05);
      }
    }
    // They move up over time.
    const s = SPRITES[0];
    expect(spriteY(s, 0.5, LAUNCH.sky) as number).toBeLessThan(spriteY(s, 0, LAUNCH.sky) as number);
  });

  test("waiting on the person, the sprites rise only above the panel at the bottom", () => {
    const bottom = 0.6;
    for (const s of SPRITES)
      for (let t = 0; t < 30; t += 0.7) {
        const y = spriteY(s, t, LAUNCH.waitingSky, bottom);
        expect(y).not.toBeNull();
        expect(y as number).toBeLessThanOrEqual(bottom);
        expect(y as number).toBeGreaterThan(1 - LAUNCH.waitingSky + 0.05);
      }
    // No room between the sky's top and the panel: none.
    expect(spriteY(SPRITES[0], 1, LAUNCH.waitingSky, 0.48)).toBeNull();
  });

  test("a sprite blinks for a moment every 3.6 s", () => {
    const s = SPRITES[0];
    const blinks = Array.from({ length: 360 }, (_, i) => spriteBlinks(s, i / 100)).filter(Boolean).length;
    expect(blinks).toBeGreaterThan(5);
    expect(blinks).toBeLessThan(20);
  });

  test("it always plays its minimum, long enough for the sky and the name", () => {
    expect(LAUNCH.min).toBeGreaterThanOrEqual(LAUNCH.nameAt + 0.42);
    expect(LAUNCH.min).toBeGreaterThanOrEqual(LAUNCH.rise);
    const splash = readFileSync(join(import.meta.dir, "../../src/features/launch/LaunchSplash.tsx"), "utf8");
    expect(splash).toContain("if (!played) return;");
    // Leaving, the agent holds its last pose: no frames of it on the JS thread while the app arrives under it.
    expect(splash).toContain("const now = useFrameTime(!reduced && !leaving, heldAt);");
  });

  test("the sky starts from the screen's own background", () => {
    expect(launchSkyTones("#ffffff", false)[0]).toBe("#ffffff");
    expect(launchSkyTones("#0f0f0e", true)[0]).toBe("#0f0f0e");
    expect(launchSkyTones("#ffffff", false).length).toBeLessThanOrEqual(8);
  });

  test("the agent and the sky are the app icon's in use; nothing kept or unknown is the logo's", () => {
    expect(launchLookOf(null)).toEqual(LOGO_LOOK);
    expect(launchLookOf("not-an-icon")).toEqual(LOGO_LOOK);
    expect(launchLookOf("peekNight")).toEqual(LOGO_LOOK);
    expect(launchLookOf("moon").sky).toBe("night");
    expect(launchLookOf("peekSky")).toEqual({ ...LOGO_LOOK, sky: "sky" });
    expect(launchLookOf("made-sky-rose-heart")).toEqual({
      color: "rose",
      eyes: "round",
      expression: "heart",
      accessory: "none",
      sky: "sky",
    });
    expect(launchLookOf("made-night-teal-sleepy-peek")).toEqual({
      color: "teal",
      eyes: "sleepy",
      accessory: "none",
      sky: "night",
    });
    expect(launchLookOf("made-night-amber-crown")).toMatchObject({ color: "amber", eyes: "round", accessory: "crown" });
  });

  test("a day sky's icon rises in its day blues in light; the night's keeps the logo's sky", () => {
    expect(launchSkyTones("#ffffff", false, false, "night")).toEqual(launchSkyTones("#ffffff", false));
    const day = launchSkyTones("#ffffff", false, false, "sky");
    expect(day[0]).toBe("#ffffff");
    expect(day).not.toEqual(launchSkyTones("#ffffff", false));
    expect(launchSkyTones("#0f0f0e", true, false, "sky")).toEqual(launchSkyTones("#0f0f0e", true));
  });
});
