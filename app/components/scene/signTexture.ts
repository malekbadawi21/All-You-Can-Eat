"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

// ── Lettering for anything flat in the scene ─────────────────────────────────
//
// Text is drawn into a 2D canvas and used as a texture, rather than through
// drei's <Text> (troika). Troika generates its glyph atlas on the GPU via a
// second WebGL context, and doing so reliably crashed the renderer here,
// taking the scene's own context down with it — a blank canvas with
// `isContextLost() === true` and no JS error to show for it. Its
// `gpuAccelerateSDF={false}` fallback doesn't help, because that path still
// composites the atlas through WebGL.
//
// Canvas textures are also simply a better fit for signage: a sign is a flat
// rectangle, so one textured quad beats a mesh of glyph geometry, and there
// are no workers or font-format constraints (troika needs .ttf/.woff and
// refuses .woff2).
//
// The tradeoff is fixed resolution — a sign inspected from a few centimetres
// away will soften. The canvases are drawn large enough that this only shows
// up closer than the camera ever gets.

export const FONT_FAMILY = "AyceSign";
const FONT_URL = "/fonts/Baloo2-Bold.ttf";

/** Horizontal pixels per canvas. Chosen for legibility at fly-in distance. */
const CANVAS_WIDTH = 1024;

/**
 * Registers the sign face once per page, not once per sign. Loading is shared
 * through a single promise so seven storefronts mounting at once trigger one
 * fetch. A failure resolves rather than rejects: a sign in the browser's
 * default face is a cosmetic problem, an unhandled rejection is not.
 */
let fontReady: Promise<void> | null = null;

export function ensureSignFont(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      const face = new FontFace(FONT_FAMILY, `url(${FONT_URL})`);
      await face.load();
      document.fonts.add(face);
    })().catch((err) => {
      console.warn("Sign font failed to load; falling back to a system face.", err);
    });
  }
  return fontReady;
}

/**
 * Draws `text` centred on a transparent canvas and returns it as a texture.
 *
 * `aspect` is the width/height of the surface the texture will land on. The
 * canvas is cut to match, so the lettering is never stretched by the quad it
 * sits on.
 */
export function useSignTexture(
  text: string,
  color: string,
  aspect: number
): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: THREE.CanvasTexture | null = null;

    ensureSignFont().then(() => {
      if (cancelled) return;

      const width = CANVAS_WIDTH;
      const height = Math.max(64, Math.round(CANVAS_WIDTH / aspect));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Start from a size that fills the height, then shrink until the string
      // fits the width. Measuring beats guessing at an average advance —
      // "Chipotle" and "Raising Cane's" want very different sizes.
      const padding = width * 0.06;
      let fontSize = Math.floor(height * 0.62);
      ctx.font = `${fontSize}px "${FONT_FAMILY}"`;

      const measured = ctx.measureText(text).width;
      const maxWidth = width - padding * 2;
      if (measured > maxWidth) {
        fontSize = Math.floor(fontSize * (maxWidth / measured));
        ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
      }

      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, width / 2, height / 2);

      created = new THREE.CanvasTexture(canvas);
      // Colour textures must be tagged sRGB or three treats them as linear
      // data and the lettering comes out washed out.
      created.colorSpace = THREE.SRGBColorSpace;
      // Signs are seen at a glancing angle down the street, which is exactly
      // the case anisotropic filtering exists for.
      created.anisotropy = 4;

      setTexture(created);
    });

    return () => {
      cancelled = true;
      // Textures hold GPU memory that garbage collection cannot reclaim on its
      // own, so the only way to release it is to say so explicitly.
      created?.dispose();
    };
  }, [text, color, aspect]);

  return texture;
}
