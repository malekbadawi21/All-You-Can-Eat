"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import type { OrderResult } from "@/lib/searchResult";
import { ensureSignFont, FONT_FAMILY } from "./signTexture";

// ── Menu board faces ─────────────────────────────────────────────────────────
//
// Each board is one quad wearing a canvas texture. Same reasoning as the shop
// signs (see signTexture.ts): troika text takes the WebGL context down with it,
// and a menu board is a flat rectangle of text — exactly what a 2D canvas is
// for.
//
// A board shows one OrderResult: what kind of order it is, what's in it, and
// the numbers worth deciding on. Deliberately *not* shown: any score. The
// search API omits them because they aren't comparable between restaurants,
// and inventing a stand-in here would leak a number that means nothing.

const BOARD_W = 512;
const BOARD_H = 640;
/** Width over height. The glazed bays are cut to match, so nothing stretches. */
export const BOARD_ASPECT = BOARD_W / BOARD_H;

const PANEL = "#241F1B";
const PANEL_EDGE = "#171310";
const BODY_INK = "#F4ECE0";
const MUTED_INK = "#A79D91";

export interface BoardContent {
  result: OrderResult | null;
  /** Shown when there is no result — idle prompt, loading, or an error. */
  message?: string;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Wraps `text` to `maxWidth`, returning the lines. Canvas has no text layout of
 * its own — `fillText` will happily run a sentence off the edge of the board —
 * so wrapping has to be done by measuring word by word.
 */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);

  // Anything that didn't fit is signalled rather than silently dropped.
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(`${last}…`).width <= maxWidth && words.length > 0) {
      const rebuilt = lines.join(" ").split(" ").length;
      if (rebuilt < words.length) lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function draw(
  ctx: CanvasRenderingContext2D,
  content: BoardContent,
  brand: string,
  ink: string
) {
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);

  // Panel
  ctx.fillStyle = PANEL_EDGE;
  roundRect(ctx, 0, 0, BOARD_W, BOARD_H, 26);
  ctx.fill();
  ctx.fillStyle = PANEL;
  roundRect(ctx, 8, 8, BOARD_W - 16, BOARD_H - 16, 20);
  ctx.fill();

  const pad = 40;
  const innerWidth = BOARD_W - pad * 2;

  if (!content.result) {
    ctx.fillStyle = MUTED_INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `34px "${FONT_FAMILY}"`;
    const lines = wrap(ctx, content.message ?? "", innerWidth, 5);
    const start = BOARD_H / 2 - ((lines.length - 1) * 44) / 2;
    lines.forEach((l, i) => ctx.fillText(l, BOARD_W / 2, start + i * 44));
    return;
  }

  const r = content.result;

  // Header band, in the restaurant's own colour so a board is unmistakably
  // attached to the building it stands in front of.
  ctx.fillStyle = brand;
  roundRect(ctx, 8, 8, BOARD_W - 16, 96, 20);
  ctx.fill();
  ctx.fillStyle = brand;
  ctx.fillRect(8, 74, BOARD_W - 16, 30);

  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `46px "${FONT_FAMILY}"`;
  ctx.fillText(r.label, BOARD_W / 2, 58);

  // Items
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let y = 142;

  for (const item of r.items) {
    ctx.font = `34px "${FONT_FAMILY}"`;
    ctx.fillStyle = BODY_INK;
    const lines = wrap(ctx, item.name, innerWidth - 24, 2);
    for (const line of lines) {
      ctx.fillText(line, pad, y);
      y += 40;
    }

    // The slot name on build-your-own orders ("protein", "rice"). Absent on
    // fixed menus, where an order is just a flat list.
    if (item.group) {
      ctx.font = `24px "${FONT_FAMILY}"`;
      ctx.fillStyle = MUTED_INK;
      ctx.fillText(item.group.toUpperCase(), pad + 4, y);
      y += 30;
    }
    y += 8;

    if (y > BOARD_H - 190) break;
  }

  // Numbers, pinned to the bottom so every board's figures line up with its
  // neighbours' and can be compared at a glance.
  const barY = BOARD_H - 148;
  ctx.fillStyle = "#1B1714";
  roundRect(ctx, 8, barY, BOARD_W - 16, BOARD_H - barY - 8, 20);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = brand;
  ctx.font = `52px "${FONT_FAMILY}"`;
  ctx.fillText(`${r.total_calories}`, pad, barY + 26);

  const calWidth = ctx.measureText(`${r.total_calories}`).width;
  ctx.fillStyle = MUTED_INK;
  ctx.font = `28px "${FONT_FAMILY}"`;
  ctx.fillText("cal", pad + calWidth + 10, barY + 48);

  ctx.fillStyle = BODY_INK;
  ctx.font = `30px "${FONT_FAMILY}"`;
  ctx.fillText(
    `${r.total_protein_g}g protein · ${r.total_carbs_g}g carbs`,
    pad,
    barY + 88
  );

  // Prices are US national averages and vary by more than a dollar between
  // markets, so they are always shown as approximate.
  ctx.textAlign = "right";
  ctx.fillStyle = brand;
  ctx.font = `40px "${FONT_FAMILY}"`;
  ctx.fillText(`~$${r.total_price.toFixed(2)}`, BOARD_W - pad, barY + 30);
}

/** Builds a board texture, redrawing whenever its content changes. */
export function useBoardTexture(
  content: BoardContent,
  brand: string,
  ink: string,
  /** When false, no texture is built at all and the bay stays clear glass. */
  enabled = true
): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  // Serialised so the effect re-runs on a genuine content change rather than
  // on every render that happens to build a new object literal.
  const key = content.result
    ? `${content.result.label}|${content.result.items.map((i) => i.id).join(",")}`
    : `msg:${content.message ?? ""}`;

  useEffect(() => {
    // Nothing to draw. Returning early rather than clearing state keeps this
    // out of the "setState inside an effect" trap — the hook simply reports
    // null below, and the cleanup has already disposed whatever was there.
    if (!enabled) return;

    let cancelled = false;
    let created: THREE.CanvasTexture | null = null;

    ensureSignFont().then(() => {
      if (cancelled) return;

      const canvas = document.createElement("canvas");
      canvas.width = BOARD_W;
      canvas.height = BOARD_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      draw(ctx, content, brand, ink);

      created = new THREE.CanvasTexture(canvas);
      created.colorSpace = THREE.SRGBColorSpace;
      created.anisotropy = 4;
      setTexture(created);
    });

    return () => {
      cancelled = true;
      created?.dispose();
    };
    // `content` is covered by `key`; including the object itself would redraw
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, brand, ink, enabled]);

  return enabled ? texture : null;
}
