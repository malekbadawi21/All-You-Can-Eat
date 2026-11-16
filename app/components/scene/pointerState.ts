// ── Shared pointer state ─────────────────────────────────────────────────────
//
// Free roam steers the camera by dragging, and storefronts are selected by
// clicking. Those are the same two buttons on the same mouse: the browser
// fires `click` at the end of a drag just as readily as at the end of a tap,
// so without a guard, every look-around ends by flying into whatever building
// happened to be under the cursor when you let go.
//
// The rig records how far the pointer travelled while held down; the click
// handler consults it and ignores anything that was really a drag. A module
// value rather than context or props deliberately — this is transient input
// state read once inside an event handler, and putting it in React state would
// re-render the scene on every mouse move.

export const pointerState = {
  /** Pixels travelled since the last pointerdown. */
  dragDistance: 0,
};

/** Beyond this many pixels, a press was a drag and not a click. */
const CLICK_SLOP = 6;

export const wasDrag = () => pointerState.dragDistance > CLICK_SLOP;
