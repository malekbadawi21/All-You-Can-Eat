"use client";

import { useMemo, type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { PALETTE, LIGHT } from "./palette";
import Storefront from "./Storefront";
import CityFill from "./CityFill";
import CameraRig, { type CameraMode } from "./CameraRig";
import { BLOCK_NEAR, buildCity } from "./cityLayout";
import { type CameraPose } from "./cameraPoses";
import type { OrderResult } from "@/lib/searchResult";
import { ROAD_HALF_WIDTH, type RestaurantPlacement } from "@/lib/restaurants";

// ── The 3D layer ─────────────────────────────────────────────────────────────
//
// This component owns the canvas and nothing else. It does not fetch, and it
// has no opinion about search results — those arrive as props. Keeping that
// boundary means the 3D work and the API integration can be changed
// independently of each other.
//
// It is also strictly optional. Everything the scene shows is available as
// ordinary DOM in the panel beside it, so if this component never loads —
// no WebGL, a lost context, a slow connection — the app still works. Nothing
// here is the only way to reach anything.
//
// The street runs along -Z: the camera sits at +Z looking into the scene, so
// "further down the block" and "more negative Z" are the same direction. Every
// position in the scene is written with that convention in mind.

function Ground({ blockFar }: { blockFar: number }) {
  // The ground has to outrun the street in both directions, or the far end of
  // a long block would show the edge of the world through the fog.
  const length = Math.max(260, BLOCK_NEAR - blockFar + 140);
  const centreZ = (BLOCK_NEAR + blockFar) / 2;
  const dashes = Math.ceil((BLOCK_NEAR + 40 - blockFar) / 7);

  return (
    <group>
      {/* Pavement — one big plane under everything. Rotated flat because a
          PlaneGeometry is born standing up, facing +Z. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, centreZ]} receiveShadow>
        <planeGeometry args={[260, length]} />
        <meshStandardMaterial color={PALETTE.sidewalk} roughness={1} metalness={0} />
      </mesh>

      {/* Road — a strip laid a hair above the pavement. The 0.01 offset is
          z-fighting insurance: two coplanar surfaces flicker as the camera
          moves, because the depth buffer can't decide which is in front. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, centreZ]} receiveShadow>
        <planeGeometry args={[ROAD_HALF_WIDTH * 2, length]} />
        <meshStandardMaterial color={PALETTE.road} roughness={1} metalness={0} />
      </mesh>

      {/* Cross-street at the far end. Without it the block terminates in a
          wall of buildings and reads as a dead end; a road running through
          closes the vista while leaving it obvious the city continues. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, blockFar]} receiveShadow>
        <planeGeometry args={[260, ROAD_HALF_WIDTH * 2]} />
        <meshStandardMaterial color={PALETTE.road} roughness={1} metalness={0} />
      </mesh>

      {/* Centre line — dashes, so the eye reads speed and depth down the block. */}
      {Array.from({ length: dashes }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 40 - i * 7]} receiveShadow>
          <planeGeometry args={[0.35, 3]} />
          <meshStandardMaterial color={PALETTE.roadLine} roughness={1} metalness={0} />
        </mesh>
      ))}

      {/* Raised kerbs, so the road reads as cut into the pavement rather than
          painted on. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * ROAD_HALF_WIDTH, 0.12, centreZ]} receiveShadow castShadow>
          <boxGeometry args={[0.5, 0.24, length]} />
          <meshStandardMaterial color={PALETTE.kerb} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

export interface CitySceneProps {
  /** Every restaurant on the street, already placed. */
  placements: RestaurantPlacement[];
  mode: CameraMode;
  /** Which restaurant's boards are live. */
  focusedSlug: string | null;
  /** Parked pose for home and focused modes. */
  parked: CameraPose | null;
  flightTo: CameraPose | null;
  flightKey: number;
  poseRef: RefObject<CameraPose>;
  onFlightComplete: () => void;
  onSelectRestaurant: (slug: string) => void;
  /** The orders for the three windows, or null while there are none. */
  results: OrderResult[] | null;
  boardMessage: string;
  /** Which window to highlight — the order the user is looking at in the panel. */
  activeBoard: number | null;
  initialPose: CameraPose;
  shift: { x: number; y: number };
  /** Reduced motion. */
  instant: boolean;
  /** Called if the GPU takes the context away, so the page can fall back. */
  onContextLost: () => void;
  /** Called once the renderer exists, so the page can fade the scene in. */
  onReady: () => void;
}

export default function CityScene({
  placements,
  mode,
  focusedSlug,
  parked,
  flightTo,
  flightKey,
  poseRef,
  onFlightComplete,
  onSelectRestaurant,
  results,
  boardMessage,
  activeBoard,
  initialPose,
  shift,
  instant,
  onContextLost,
  onReady,
}: CitySceneProps) {
  // Rebuilt only when the set of restaurants changes — that is, when one is
  // ingested. Otherwise this is computed once.
  const city = useMemo(() => buildCity(placements), [placements]);
  const bounds = useMemo(() => ({ near: BLOCK_NEAR, far: city.blockFar }), [city.blockFar]);

  return (
    <Canvas
      // "variance" = VSM shadows. R3F's `shadows={true}` selects PCFSoft,
      // which three 0.185 has deprecated and silently downgrades to hard-edged
      // PCF. VSM is both current and softer-edged, which suits the pastel look.
      shadows="variance"
      // `flat` turns off ACES tone mapping. ACES is built for photoreal
      // rendering and quietly desaturates everything — which is exactly wrong
      // for a flat pastel look. Without it the palette lands as authored.
      flat
      // Cap the pixel ratio at 2. Retina phones report 3, which triples the
      // fragment work for a difference nobody can see.
      dpr={[1, 2]}
      // Draw a frame only when something has changed. See CameraRig.
      frameloop="demand"
      // The picture is decoration for anyone who can't see it: everything it
      // conveys is in the DOM. Hidden from assistive tech except in free roam,
      // where it is the thing being controlled.
      aria-hidden={mode !== "roam"}
      aria-label={mode === "roam" ? "The street. Arrow keys or W A S D to walk." : undefined}
      role={mode === "roam" ? "application" : undefined}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (event) => {
          // Without preventDefault the browser won't try to restore it, but
          // either way the picture is gone *now* and the page should say so.
          event.preventDefault();
          onContextLost();
        });
        onReady();
      }}
    >
      <color attach="background" args={[PALETTE.sky]} />
      {/* Fog does the heavy lifting for depth: the far end of the block fades
          into haze instead of becoming a wall of unreadable tiny buildings. */}
      <fog attach="fog" args={[PALETTE.haze, 75, 260]} />

      <CameraRig
        mode={mode}
        parked={parked}
        flightTo={flightTo}
        flightKey={flightKey}
        poseRef={poseRef}
        onFlightComplete={onFlightComplete}
        initial={initialPose}
        shift={shift}
        instant={instant}
        bounds={bounds}
      />

      {/* Hemisphere light is what makes low-poly read as "soft" rather than
          "unlit": warm from above, a cooler green bounce from the ground, so
          faces pointing different ways pick up different tints for free. */}
      <hemisphereLight args={[LIGHT.skyTint, LIGHT.groundTint, 1.1]} />

      <directionalLight
        castShadow
        position={[22, 30, 14]}
        intensity={1.9}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        // A directional light's shadow uses an orthographic camera. Its default
        // box is tiny; widened here to cover the near block, or buildings
        // simply cast nothing.
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-far={120}
      />

      {/* Fill light from the other side of the street, casting no shadows. The
          sun lights the fronts of the left-hand buildings; without this the
          right-hand storefronts face away from it and sit in murk, with their
          signs unreadable. Half the restaurants live on that side. */}
      <directionalLight position={[-20, 14, 12]} intensity={0.85} />

      <Ground blockFar={city.blockFar} />
      <CityFill city={city} />

      {placements.map((placement) => (
        <Storefront
          key={placement.slug}
          placement={placement}
          // Only free roam lets the scene be clicked. Elsewhere the DOM is the
          // way in, so clicking a building does nothing.
          selectable={mode === "roam"}
          onSelect={onSelectRestaurant}
          results={placement.slug === focusedSlug ? results : null}
          boardMessage={placement.slug === focusedSlug ? boardMessage : ""}
          activeBoard={placement.slug === focusedSlug ? activeBoard : null}
        />
      ))}
    </Canvas>
  );
}
