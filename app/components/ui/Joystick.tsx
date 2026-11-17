"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { moveInput } from "../scene/pointerState";

// ── Walking by thumb ─────────────────────────────────────────────────────────
//
// Free roam was keyboard-only: on a phone you could look around by dragging
// but never take a step. This is the missing half — a thumb pad in the corner.
// Push it forward to walk, sideways to sidestep; how far you push is how fast
// you go.
//
// It is ordinary DOM over the canvas, and talks to the camera through
// `moveInput` (see scene/pointerState.ts) rather than through React state:
// the thumb moves many times a second, and none of those moves should
// re-render anything but the knob.

/** How far the knob can travel from centre, in pixels. */
const REACH = 38;

export default function Joystick() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number } | null>(null);

  const release = () => {
    origin.current = null;
    moveInput.forward = 0;
    moveInput.strafe = 0;
    setKnob({ x: 0, y: 0 });
  };

  // If the pad unmounts mid-push (leaving roam), the camera must not keep
  // walking.
  useEffect(() => release, []);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
    onMove(e);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!origin.current) return;
    let dx = e.clientX - origin.current.x;
    let dy = e.clientY - origin.current.y;

    // Keep the knob inside its ring, preserving direction.
    const length = Math.hypot(dx, dy);
    if (length > REACH) {
      dx = (dx / length) * REACH;
      dy = (dy / length) * REACH;
    }

    setKnob({ x: dx, y: dy });
    // Screen-down is +y; walking forward is pushing the knob *up*.
    moveInput.forward = -dy / REACH;
    moveInput.strafe = dx / REACH;
    moveInput.wake?.();
  };

  return (
    <div
      // Not focusable and hidden from assistive tech: it is a second way to do
      // what the arrow keys already do, and every restaurant is reachable
      // without walking at all.
      aria-hidden="true"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={release}
      onPointerCancel={release}
      className="pointer-events-auto absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-6 z-20 flex h-28 w-28 touch-none select-none items-center justify-center rounded-full border-2 border-white/60 bg-black/30 backdrop-blur-sm"
    >
      <div
        className="h-12 w-12 rounded-full bg-white/90 shadow-lg"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      />
    </div>
  );
}
