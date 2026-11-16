import { CITY } from "./palette";
import { PLACEMENTS, ROAD_HALF_WIDTH, BUILDING_LINE } from "@/lib/restaurants";

// ── Where everything that isn't a restaurant goes ────────────────────────────
//
// The block is generated once, at module load, from a *seeded* random number
// generator. Two reasons it isn't `Math.random()`:
//
//   1. The city must look identical on every load. Comparing two screenshots is
//      how we tell whether a change improved anything, and that only works if
//      the only difference between them is the change.
//   2. Generating during render would rebuild the city on every re-render and
//      make the street visibly shuffle itself.
//
// Everything below is plain data. The components that draw it hold no state.

/**
 * mulberry32 — a small, fast, well-distributed PRNG. Any seeded generator would
 * do; this one is nine lines and has no dependencies.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260811);

/** Random float in [min, max). */
const between = (min: number, max: number) => min + rand() * (max - min);
/** Random element of a list. */
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

// ── Block extents ────────────────────────────────────────────────────────────

/**
 * Nearest end of the block. Deliberately *in front of* the establishing camera
 * rather than around it: filler standing level with the camera flanks the shot
 * like a pair of blinders and hides the street it is supposed to frame.
 */
export const BLOCK_NEAR = 16;
/** Far end, where a cross-street closes the view. */
export const BLOCK_FAR = -104;
/** Centre of the cross-street's road surface. */
export const CROSS_STREET_Z = BLOCK_FAR;

export interface FillerBuilding {
  position: [number, number, number];
  /** Frontage, along the street. */
  width: number;
  /** How far back from the street it runs. */
  depth: number;
  height: number;
  color: string;
  /** Whether it wears a parapet slab — variation in the roofline. */
  parapet: boolean;
  /** How many horizontal window bands to draw up the facade. */
  bands: number;
  /** Which way the facade points: -1 faces +X, 1 faces -X. */
  facing: -1 | 1;
  rotation: number;
}

function makeFiller(
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  side: -1 | 1
): FillerBuilding {
  return {
    position: [x, 0, z],
    width,
    depth,
    height,
    color: pick(CITY.filler),
    parapet: rand() > 0.35,
    // Roughly a band per three units of height, never more than four — beyond
    // that the facade turns into stripes rather than a building.
    bands: Math.min(4, Math.max(1, Math.round(height / 3.2))),
    facing: side,
    rotation: side === -1 ? 0 : Math.PI,
  };
}

/**
 * Filler that sits on the same building line as the restaurants, filling the
 * gaps between them. Without these the block reads as seven objects placed on a
 * plane; with them it reads as a street that happens to contain seven
 * restaurants.
 */
function gapFillers(): FillerBuilding[] {
  const out: FillerBuilding[] = [];

  for (const side of [-1, 1] as const) {
    const sideName = side === -1 ? "left" : "right";
    const occupied = PLACEMENTS.filter((p) => p.side === sideName)
      .map((p) => ({ z: p.position[2], width: p.width }))
      .sort((a, b) => b.z - a.z); // nearest first

    // Treat the ends of the block as neighbours, so the runs before the first
    // restaurant and after the last get filled the same way as the gaps.
    const edges: { from: number; to: number }[] = [];
    let cursor = BLOCK_NEAR;
    for (const r of occupied) {
      edges.push({ from: cursor, to: r.z + r.width / 2 });
      cursor = r.z - r.width / 2;
    }
    edges.push({ from: cursor, to: BLOCK_FAR + 8 });

    for (const gap of edges) {
      // `from` is nearer the camera, so it is the larger z.
      let z = gap.from - 1.5;
      while (z - 6 > gap.to) {
        const width = between(6, 11);
        if (z - width > gap.to) {
          const depth = between(9, 14);
          // Capped just under the restaurants' own range (5–8). A real street
          // would have neighbours of every height, but anything that towers
          // over a storefront steals it — and the storefronts are the point.
          const height = between(4.5, 7.6);
          out.push(
            makeFiller(
              (BUILDING_LINE + depth / 2) * side,
              z - width / 2,
              width,
              depth,
              height,
              side
            )
          );
          z -= width + between(0.8, 2.2);
        } else {
          break;
        }
      }
    }
  }

  return out;
}

/**
 * Rows set back behind the shopfronts. These never face the street directly —
 * they exist to give the block a skyline and to stop the eye from running off
 * the edge of the ground plane.
 */
function backdropRows(): FillerBuilding[] {
  const out: FillerBuilding[] = [];

  // [distance from centre, height range] — further back means taller, which is
  // how a city silhouette reads even when every building is a plain box.
  const rows: [number, number, number][] = [
    [33, 9, 17],
    [52, 13, 24],
    [72, 16, 30],
  ];

  for (const side of [-1, 1] as const) {
    for (const [distance, minH, maxH] of rows) {
      let z = BLOCK_NEAR;
      while (z > BLOCK_FAR - 16) {
        const width = between(9, 17);
        const depth = between(10, 18);
        out.push(
          makeFiller(
            (distance + between(-4, 6)) * side,
            z - width / 2,
            width,
            depth,
            between(minH, maxH),
            side
          )
        );
        z -= width + between(1.5, 5);
      }
    }
  }

  return out;
}

/**
 * The far end of the street. A solid wall of buildings straight across would
 * read as a dead end, so a perpendicular road runs through first and the
 * buildings sit beyond it — the vista closes without feeling boxed in.
 */
function crossStreetRow(): FillerBuilding[] {
  const out: FillerBuilding[] = [];
  let x = -78;
  while (x < 78) {
    const width = between(10, 18);
    const depth = between(11, 16);
    out.push({
      position: [x + width / 2, 0, CROSS_STREET_Z - 12 - depth / 2],
      width,
      depth,
      height: between(9, 19),
      color: pick(CITY.filler),
      parapet: rand() > 0.4,
      bands: 3,
      // Turned a quarter circle so these face back up the street toward the
      // camera rather than sideways.
      facing: -1,
      rotation: -Math.PI / 2,
    });
    x += width + between(1.5, 4);
  }
  return out;
}

export const FILLERS: FillerBuilding[] = [
  ...gapFillers(),
  ...backdropRows(),
  ...crossStreetRow(),
];

// ── Street furniture ─────────────────────────────────────────────────────────

export interface StreetProp {
  position: [number, number, number];
  rotation: number;
  scale: number;
  color?: string;
}

/** Lamp posts alternate sides, so the block never looks like a runway. */
export const LAMPS: StreetProp[] = (() => {
  const out: StreetProp[] = [];
  let z = BLOCK_NEAR - 6;
  let side: -1 | 1 = -1;
  while (z > BLOCK_FAR + 10) {
    out.push({
      position: [(ROAD_HALF_WIDTH + 1.1) * side, 0, z],
      // The arm reaches out over the road, so it has to know which way that is.
      rotation: side === -1 ? 0 : Math.PI,
      scale: 1,
    });
    side = side === -1 ? 1 : -1;
    z -= 15;
  }
  return out;
})();

/**
 * Street trees hug the kerb and skip the storefronts. Planted mid-pavement at
 * full size they sat directly in front of the signage — the block looked
 * lovely and you couldn't tell one restaurant from another.
 */
export const TREES: StreetProp[] = (() => {
  const doors = PLACEMENTS.map((p) => ({ z: p.door[2], side: p.side }));
  const out: StreetProp[] = [];

  for (const side of [-1, 1] as const) {
    const sideName = side === -1 ? "left" : "right";
    let z = BLOCK_NEAR - between(3, 9);
    while (z > BLOCK_FAR + 12) {
      const shadesAShopfront = doors.some(
        (d) => d.side === sideName && Math.abs(d.z - z) < 7
      );
      if (!shadesAShopfront) {
        out.push({
          position: [(ROAD_HALF_WIDTH + between(0.9, 1.8)) * side, 0, z],
          rotation: between(0, Math.PI * 2),
          scale: between(0.62, 0.95),
          color: pick(CITY.foliage),
        });
      }
      z -= between(11, 20);
    }
  }
  return out;
})();

export const BENCHES: StreetProp[] = (() => {
  const out: StreetProp[] = [];
  for (const side of [-1, 1] as const) {
    let z = BLOCK_NEAR - between(12, 26);
    while (z > BLOCK_FAR + 20) {
      out.push({
        position: [(ROAD_HALF_WIDTH + 2.4) * side, 0, z],
        rotation: side === -1 ? 0 : Math.PI,
        scale: 1,
      });
      z -= between(28, 46);
    }
  }
  return out;
})();

/**
 * Cars parked along the kerb, nose-to-tail with realistic gaps. They sit just
 * inside the road edge and never in front of a doorway, so the fly-in has a
 * clear run at every entrance.
 */
export const CARS: StreetProp[] = (() => {
  const doorZs = PLACEMENTS.map((p) => ({ z: p.door[2], side: p.side }));
  const out: StreetProp[] = [];

  for (const side of [-1, 1] as const) {
    const sideName = side === -1 ? "left" : "right";
    let z = BLOCK_NEAR - between(6, 14);
    while (z > BLOCK_FAR + 14) {
      const blocksADoor = doorZs.some(
        (d) => d.side === sideName && Math.abs(d.z - z) < 5
      );
      if (!blocksADoor) {
        out.push({
          position: [(ROAD_HALF_WIDTH - 1.9) * side, 0, z],
          rotation: side === -1 ? 0 : Math.PI,
          scale: 1,
          color: pick(CITY.car),
        });
      }
      z -= between(9, 19);
    }
  }

  return out;
})();
