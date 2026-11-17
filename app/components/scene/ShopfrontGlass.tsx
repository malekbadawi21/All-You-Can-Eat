"use client";

import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrderResult } from "@/lib/searchResult";
import { useBoardTexture, BOARD_ASPECT, type BoardContent } from "./boardTexture";

// ── Results on the shopfront glass ───────────────────────────────────────────
//
// Three glazed bays across the front of the building. Idle they are just
// windows; when a search lands, each one lights up with an order.
//
// This replaces a row of free-standing menu boards on the pavement. Those
// worked, but they stood in front of every restaurant all the time, so the
// street view was a line of dark slabs partly hiding the storefronts they were
// advertising. Putting the results *in* the windows means the street stays
// clean and the information appears exactly where you're already looking once
// the camera has flown in.

const GLASS = "#BCD9E8";
/** Frame around each bay, so the glass reads as glazed rather than painted on. */
const MULLION = "#3F3832";

export interface GlassBayLayout {
  /** Z centre of each bay, along the frontage. */
  centres: number[];
  width: number;
  height: number;
  /** Y centre of the run. */
  y: number;
}

/**
 * Works out where the bays go, given the frontage left over once the door has
 * taken its end. Exported because the facade needs the same numbers to place
 * the door and to know how much room is left.
 */
export function glassLayout(frontage: number, doorWidth: number): GlassBayLayout {
  const margin = 0.5;
  const start = -frontage / 2 + doorWidth + margin * 2;
  const end = frontage / 2 - margin;
  const gap = 0.35;

  const width = Math.max(0.8, (end - start - gap * 2) / 3);
  // Bays are cut to the card's proportions, so nothing is stretched.
  const height = width / BOARD_ASPECT;

  return {
    centres: [0, 1, 2].map((i) => start + width / 2 + i * (width + gap)),
    width,
    height,
    y: 0.9 + height / 2,
  };
}

function Bay({
  content,
  brand,
  ink,
  faceX,
  z,
  width,
  height,
  y,
  active,
}: {
  content: BoardContent;
  brand: string;
  ink: string;
  faceX: number;
  z: number;
  width: number;
  height: number;
  y: number;
  /** True while the matching order is being looked at in the panel. */
  active: boolean;
}) {
  // A bay with nothing to say stays plain glass rather than showing an empty
  // card. Seven storefronts all displaying "tell us what you're after" would
  // be the same clutter the pavement boards created.
  const live = Boolean(content.result || content.message);
  const texture = useBoardTexture(content, brand, ink, live);

  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const fade = useRef(0);
  const invalidate = useThree((s) => s.invalidate);

  // Restart the fade whenever a new face arrives, so swapping results reads as
  // the window changing rather than as a hard cut.
  useEffect(() => {
    fade.current = 0;
    invalidate();
  }, [texture, invalidate]);

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (!material || !texture) return;
    if (fade.current < 1) {
      // Clamped: on a demand-driven loop the first frame after an idle spell
      // reports a huge delta, which would skip the fade entirely.
      fade.current = Math.min(1, fade.current + Math.min(delta, 0.05) * 3);
      material.opacity = fade.current;
      // The canvas only draws when asked, so the fade asks for its own frames.
      invalidate();
    }
  });

  return (
    <group position={[0, y, z]}>
      {/* Frame */}
      <mesh position={[faceX + 0.06, 0, 0]} castShadow>
        <boxGeometry args={[0.18, height + 0.34, width + 0.34]} />
        <meshStandardMaterial
          // The frame takes the restaurant's own colour while its order is
          // the one under the pointer in the panel, tying the card on the
          // right to the window on the left.
          color={active ? brand : MULLION}
          emissive={brand}
          emissiveIntensity={active ? 0.55 : 0}
          roughness={1}
          metalness={0}
          flatShading
        />
      </mesh>

      {/* Glazing */}
      <mesh position={[faceX + 0.18, 0, 0]}>
        <boxGeometry args={[0.1, height, width]} />
        <meshStandardMaterial color={GLASS} roughness={0.35} metalness={0} />
      </mesh>

      {/* The card, sitting just inside the glass. Same quarter-turn convention
          as the shop signs: a plane is authored facing +Z, so turning it about
          Y aims it at the road and lands its +U along the viewer's right. */}
      {texture && (
        <mesh position={[faceX + 0.25, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            ref={materialRef}
            map={texture}
            transparent
            opacity={0}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

export default function ShopfrontGlass({
  layout,
  faceX,
  brand,
  ink,
  results,
  message,
  active,
}: {
  layout: GlassBayLayout;
  /** Local X of the building's front face. */
  faceX: number;
  brand: string;
  ink: string;
  results: OrderResult[] | null;
  message: string;
  active: number | null;
}) {
  return (
    <group>
      {layout.centres.map((z, i) => {
        // Bays are laid out from the door outward, and the door is on the
        // viewer's right. Reading order is left to right, so the first result
        // goes in the bay furthest from the door.
        const order = layout.centres.length - 1 - i;
        return (
        <Bay
          key={i}
          content={{
            result: results?.[order] ?? null,
            // Only the focused restaurant is given a message; everywhere else
            // it is empty, which keeps the glass clear.
            message: results ? undefined : message,
          }}
          brand={brand}
          ink={ink}
          faceX={faceX}
          z={z}
          width={layout.width}
          height={layout.height}
          y={layout.y}
          active={active === order}
        />
        );
      })}
    </group>
  );
}
