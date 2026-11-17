/** The bar's margins, the back and "…" circles and a gap on each side: what the pill's room gives up before any other button. */
const BAR_CHROME = 152;
/** A bar button's width. */
const BUTTON = 44;
/** The narrowest the pill's room goes: the name still reads beside the buttons. */
export const MIN_ROOM = 160;

/** The width the pill's slot has in the bar: the screen less the bar's chrome and `extraActions` bar buttons. */
export function pillRoom(screen: number, extraActions: number): number {
  return Math.max(MIN_ROOM, screen - BAR_CHROME - extraActions * BUTTON);
}

/**
 * Whether the bar has room for the "switch conversation" button beside the pill and `extraActions` other buttons.
 * On a narrow phone (360) crowded with an agent's own buttons it would squeeze the name below `MIN_ROOM`, so it
 * steps aside there and holding the pill stays the way in.
 */
export function switchFits(screen: number, extraActions: number): boolean {
  return screen - BAR_CHROME - (extraActions + 1) * BUTTON >= MIN_ROOM;
}
