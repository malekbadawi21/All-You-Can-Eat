"use client";

import { CITY } from "./palette";
import {
  FILLERS,
  LAMPS,
  TREES,
  BENCHES,
  CARS,
  type FillerBuilding,
  type StreetProp,
} from "./cityLayout";

// ── The block around the restaurants ─────────────────────────────────────────
//
// Anonymous buildings, street furniture and parked cars. All of it is drawn
// from the plain data in cityLayout.ts, so nothing here decides *where*
// anything goes — only what it looks like.
//
// Same local convention as Storefront: each object is authored facing +X and
// turned by its own rotation, so one component covers both sides of the street.

function Filler({ b }: { b: FillerBuilding }) {
  const face = b.depth / 2;

  return (
    <group position={b.position} rotation={[0, b.rotation, 0]}>
      <mesh position={[0, b.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[b.depth, b.height, b.width]} />
        <meshStandardMaterial color={b.color} roughness={1} metalness={0} flatShading />
      </mesh>

      {b.parapet && (
        <mesh position={[0, b.height + 0.25, 0]} castShadow>
          <boxGeometry args={[b.depth * 1.05, 0.5, b.width * 1.05]} />
          <meshStandardMaterial
            color={CITY.fillerRoof}
            roughness={1}
            metalness={0}
            flatShading
          />
        </mesh>
      )}

      {/* Window bands rather than individual windows. At the distance these
          buildings are seen from, a horizontal stripe reads as glazing just as
          well as a grid of panes would, for a fraction of the geometry. */}
      {Array.from({ length: b.bands }, (_, i) => {
        // Spread the bands up the facade, leaving the ground floor solid.
        const y = 2.4 + (i * (b.height - 3.2)) / Math.max(1, b.bands);
        if (y > b.height - 0.9) return null;
        return (
          <mesh key={i} position={[face + 0.06, y, 0]}>
            <boxGeometry args={[0.14, 1.1, b.width * 0.82]} />
            <meshStandardMaterial
              color={CITY.window}
              roughness={0.5}
              metalness={0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function Lamp({ p }: { p: StreetProp }) {
  return (
    <group position={p.position} rotation={[0, p.rotation, 0]}>
      <mesh position={[0, 3.2, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.18, 6.4, 6]} />
        <meshStandardMaterial color={CITY.lampPost} roughness={1} metalness={0} />
      </mesh>
      {/* The arm leans out over the road, which is the shape that reads as a
          street light rather than a fence post. */}
      <mesh position={[0.75, 6.3, 0]} castShadow>
        <boxGeometry args={[1.7, 0.16, 0.16]} />
        <meshStandardMaterial color={CITY.lampPost} roughness={1} metalness={0} />
      </mesh>
      <mesh position={[1.5, 6.05, 0]}>
        <boxGeometry args={[0.7, 0.4, 0.5]} />
        <meshStandardMaterial
          color={CITY.lampHead}
          roughness={1}
          metalness={0}
          emissive={CITY.lampHead}
          emissiveIntensity={0.35}
        />
      </mesh>
    </group>
  );
}

function Tree({ p }: { p: StreetProp }) {
  return (
    <group position={p.position} rotation={[0, p.rotation, 0]} scale={p.scale}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.32, 3, 6]} />
        <meshStandardMaterial color={CITY.trunk} roughness={1} metalness={0} flatShading />
      </mesh>
      {/* An icosahedron at detail 0 is a twenty-faced ball — the cheapest shape
          that still reads as foliage rather than as a sphere. */}
      <mesh position={[0, 4.1, 0]} castShadow>
        <icosahedronGeometry args={[1.9, 0]} />
        <meshStandardMaterial color={p.color} roughness={1} metalness={0} flatShading />
      </mesh>
      <mesh position={[0.7, 3.1, 0.4]} castShadow scale={0.62}>
        <icosahedronGeometry args={[1.9, 0]} />
        <meshStandardMaterial color={p.color} roughness={1} metalness={0} flatShading />
      </mesh>
    </group>
  );
}

function Bench({ p }: { p: StreetProp }) {
  return (
    <group position={p.position} rotation={[0, p.rotation, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.75, 0.14, 2.6]} />
        <meshStandardMaterial color={CITY.bench} roughness={1} metalness={0} flatShading />
      </mesh>
      <mesh position={[-0.32, 1.05, 0]} rotation={[0, 0, 0.18]} castShadow>
        <boxGeometry args={[0.14, 0.85, 2.6]} />
        <meshStandardMaterial color={CITY.bench} roughness={1} metalness={0} flatShading />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.25, s * 1.1]}>
          <boxGeometry args={[0.7, 0.5, 0.14]} />
          <meshStandardMaterial color={CITY.bin} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

function Car({ p }: { p: StreetProp }) {
  return (
    <group position={p.position} rotation={[0, p.rotation, 0]}>
      {/* Body */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.85, 4.6]} />
        <meshStandardMaterial color={p.color} roughness={0.8} metalness={0} flatShading />
      </mesh>
      {/* Cabin, set back and narrower — the step is what makes a box a car. */}
      <mesh position={[0, 1.45, -0.25]} castShadow>
        <boxGeometry args={[1.85, 0.75, 2.3]} />
        <meshStandardMaterial color={p.color} roughness={0.8} metalness={0} flatShading />
      </mesh>
      <mesh position={[0, 1.5, -0.3]}>
        <boxGeometry args={[1.92, 0.5, 2.0]} />
        <meshStandardMaterial color={CITY.window} roughness={0.35} metalness={0} />
      </mesh>
      {/* Wheels: cylinders turned on their side to roll along X. */}
      {[
        [-1.03, 1.5],
        [1.03, 1.5],
        [-1.03, -1.5],
        [1.03, -1.5],
      ].map(([x, z]) => (
        <mesh
          key={`${x}:${z}`}
          position={[x, 0.42, z]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.42, 0.42, 0.28, 8]} />
          <meshStandardMaterial color={CITY.tyre} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

export default function CityFill() {
  return (
    <group>
      {FILLERS.map((b, i) => (
        <Filler key={`f${i}`} b={b} />
      ))}
      {LAMPS.map((p, i) => (
        <Lamp key={`l${i}`} p={p} />
      ))}
      {TREES.map((p, i) => (
        <Tree key={`t${i}`} p={p} />
      ))}
      {BENCHES.map((p, i) => (
        <Bench key={`b${i}`} p={p} />
      ))}
      {CARS.map((p, i) => (
        <Car key={`c${i}`} p={p} />
      ))}
    </group>
  );
}
