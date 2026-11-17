// ── Shared input state ───────────────────────────────────────────────────────
//
// Two small pieces of transient input that have to cross the boundary between
// the DOM layer and the render loop. Both are plain module values rather than
// React state or context, deliberately: they change many times a second and are
// read once per frame, and routing them through React would re-render the
// scene on every mouse move.

// 1 ── Was that a click or a drag? ───────────────────────────────────────────
//
// Free roam steers the camera by dragging, and storefronts are selected by
// clicking. Those are the same button on the same mouse: the browser fires
// `click` at the end of a drag just as readily as at the end of a tap, so
// without a guard, every look-around ends by flying into whatever building
// happened to be under the cursor when you let go.

export const pointerState = {
  /** Pixels travelled since the last pointerdown. */
  dragDistance: 0,
};

/** Beyond this many pixels, a press was a drag and not a click. */
const CLICK_SLOP = 6;

export const wasDrag = () => pointerState.dragDistance > CLICK_SLOP;

// 2 ── Walking without a keyboard ────────────────────────────────────────────
//
// The on-screen joystick (app/components/ui/Joystick.tsx) is ordinary DOM. It
// writes where the thumb is here; the camera rig reads it every frame and adds
// it to whatever the keyboard is doing. Each axis runs from -1 to 1.

export const moveInput = {
  /** +1 is full speed ahead. */
  forward: 0,
  /** +1 is full speed to the right. */
  strafe: 0,
  /**
   * Set by the joystick to ask for a frame. The scene only renders when
   * something changes, and a thumb on a joystick is a change it cannot see.
   */
  wake: null as null | (() => void),
};
