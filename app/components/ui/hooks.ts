"use client";

import { useSyncExternalStore } from "react";

// ── Facts about the device ───────────────────────────────────────────────────
//
// Small hooks that answer "what is this browser like?" — how big, whether the
// user asked for less motion, whether the pointer is a finger, whether WebGL
// works at all.
//
// They are all built on useSyncExternalStore, which exists for exactly this:
// reading a value that lives outside React and can change. Its third argument
// is what the *server* should assume, because none of these questions has an
// answer during a server render. Getting that wrong is what causes hydration
// mismatches, so every hook here states its server-side assumption explicitly
// and nothing that affects markup depends on these values — layout is CSS
// media queries; these only feed the camera and optional extras.

function useMediaQuery(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue
  );
}

/** True when the user has asked their system for reduced motion. */
export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)", false);

/** True when the primary pointer is a finger rather than a mouse. */
export const useCoarsePointer = () => useMediaQuery("(pointer: coarse)", false);

/** The breakpoint where the panel moves from a bottom sheet to a side dock. */
export const DESKTOP_QUERY = "(min-width: 900px)";
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY, true);

// useSyncExternalStore compares snapshots by identity, so a fresh object every
// call would loop forever. The size is cached and only replaced when it changes.
let cachedSize = { width: 1280, height: 800 };
const SERVER_SIZE = cachedSize;

function readSize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width !== cachedSize.width || height !== cachedSize.height) cachedSize = { width, height };
  return cachedSize;
}

export function useViewport(): { width: number; height: number } {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    readSize,
    () => SERVER_SIZE
  );
}

// ── Can this browser draw the street? ────────────────────────────────────────
//
// Asked once and remembered. Creating a WebGL context is the only reliable
// test — a browser can report the API and still refuse to hand one out
// (blocklisted GPU, hardware acceleration switched off, too many contexts).

export type WebGLSupport = "unknown" | "yes" | "no";

let webgl: WebGLSupport = "unknown";

function detectWebGL(): WebGLSupport {
  if (webgl !== "unknown") return webgl;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    webgl = context ? "yes" : "no";
    // Give the context back straight away: browsers cap how many a page may
    // hold, and the real scene is about to ask for one.
    (context?.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
  } catch {
    webgl = "no";
  }
  return webgl;
}

const noop = () => () => {};

/** "unknown" on the server and during hydration; then "yes" or "no". */
export const useWebGLSupport = (): WebGLSupport =>
  useSyncExternalStore(noop, detectWebGL, () => "unknown" as const);
