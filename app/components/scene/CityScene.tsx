"use client";

import { type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { PALETTE, LIGHT } from "./palette";
import Storefront from "./Storefront";
import CityFill from "./CityFill";
import CameraRig, { type CameraMode } from "./CameraRig";
import { CROSS_STREET_Z } from "./cityLayout";
import { type CameraPose } from "./cameraPoses";
import type { OrderResult } from "@/lib/searchResult";
import { PLACEMENTS, ROAD_HALF_WIDTH } from "@/lib/restaurants";

// ── The 3D layer ─────────────────────────────────────────────────────────────
//
// This component owns the canvas and nothing else. It does not fetch, it does
// not know what a restaurant is, and it has no opinion about search results —
// those arrive later as props. Keeping that boundary means the 3D work and the
// API integration can be changed independently of each other.
//
// The street runs along -Z: the camera sits at +Z looking into the scene, so
// "further down the block" and "more negative Z" are the same direction. Every
// position in the scene is written with that convention in mind.

/** How far the street runs in each direction before fog swallows it. */
const STREET_LENGTH = 260;

function Ground() {
  return (
    <group>
      {/* Pavement — one big plane under everything. Rotated flat because a
          PlaneGeometry is born standing up, facing +Z. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[STREET_LENGTH, STREET_LENGTH]} />
        <meshStandardMaterial color={PALETTE.sidewalk} roughness={1} metalness={0} />
      </mesh>

      {/* Road — a strip laid a hair above the pavement. The 0.01 offset is
          z-fighting insurance: two coplanar surfaces flicker as the camera
          moves, because the depth buffer can't decide which is in front. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[ROAD_HALF_WIDTH * 2, STREET_LENGTH]} />
        <meshStandardMaterial color={PALETTE.road} roughness={1} metalness={0} />
      </mesh>

      {/* Cross-street at the far end. Without it the block terminates in a
          wall of buildings and reads as a dead end; a road running through
          closes the vista while leaving it obvious the city continues. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, CROSS_STREET_Z]}
        receiveShadow
      >
        <planeGeometry args={[STREET_LENGTH, ROAD_HALF_WIDTH * 2]} />
        <meshStandardMaterial color={PALETTE.road} roughness={1} metalness={0} />
      </mesh>

      {/* Centre line — dashes, so the eye reads speed and depth down the block. */}
      {Array.from({ length: 30 }, (_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 40 - i * 7]}
          receiveShadow
        >
          <planeGeometry args={[0.35, 3]} />
          <meshStandardMaterial color={PALETTE.roadLine} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

/** Raised kerbs, so the road reads as cut into the pavement rather than painted on. */
function Kerbs() {
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * ROAD_HALF_WIDTH, 0.12, 0]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[0.5, 0.24, STREET_LENGTH]} />
          <meshStandardMaterial color={PALETTE.kerb} roughness={1} metalness={0} />
        </mesh>
      ))}
    </>
  );
}

export interface CitySceneProps {
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
  results: OrderResult[] | null;
  boardMessage: string;
}

export default function CityScene({
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
}: CitySceneProps) {
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
        // box is tiny; widened here to cover the whole block, or buildings at
        // the far end simply cast nothing.
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-far={120}
      />

      <Ground />
      <Kerbs />
      <CityFill />

      {PLACEMENTS.map((placement) => (
        <Storefront
          key={placement.slug}
          placement={placement}
          // Only free roam lets the scene be clicked. In home mode the search
          // bar is the sole way in, so clicking a building does nothing.
          selectable={mode === "roam"}
          onSelect={onSelectRestaurant}
          results={placement.slug === focusedSlug ? results : null}
          boardMessage={placement.slug === focusedSlug ? boardMessage : ""}
        />
      ))}
    </Canvas>
  );
}
