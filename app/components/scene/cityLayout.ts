import { CITY } from "./palette";
import { ROAD_HALF_WIDTH, BUILDING_LINE, type RestaurantPlacement } from "@/lib/restaurants";

// ── Where everything that isn't a restaurant goes ────────────────────────────
//
// The block is generated from a *seeded* random number generator. Two reasons
// it isn't `Math.random()`:
//
//   1. The city must look identical on every load. Comparing two screenshots is
//      how we tell whether a change improved anything, and that only works if
//      the only difference between them is the change.
//   2. Generating during render would rebuild the city on every re-render and
//      make the street visibly shuffle itself.
//
// buildCity() is a pure function of where the restaurants stand: same
// placements in, same city out. It used to run once at module load against a
// hardcoded list of seven; it now takes the list as an argument, which is what
// lets the street grow when a restaurant is ingested. With the original seven
// it produces exactly the street it always did, because the generator is
// re-seeded on every call and the draws happen in the same order.

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

const SEED = 20260811;

/**
 * Nearest end of the block. Deliberately *in front of* the establishing camera
 * rather than around it: filler standing level with the camera flanks the shot
 * like a pair of blinders and hides the street it is supposed to frame.
 */
export const BLOCK_NEAR = 16;

/** The far end is never nearer than this, however few restaurants there are. */
const MIN_BLOCK_FAR = -104;
/** Street left over beyond the last restaurant before the cross-street. */
const TAIL = 40;

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

export interface StreetProp {
  position: [number, number, number];
  rotation: number;
  scale: number;
  color?: string;
}

export interface City {
  /** Where the block ends and the cross-street runs. Always ≤ MIN_BLOCK_FAR. */
  blockFar: number;
  fillers: FillerBuilding[];
  lamps: StreetProp[];
  trees: StreetProp[];
  benches: StreetProp[];
  cars: StreetProp[];
}

export function buildCity(placements: RestaurantPlacement[]): City {
  const rand = mulberry32(SEED);
  /** Random float in [min, max). */
  const between = (min: number, max: number) => min + rand() * (max - min);
  /** Random element of a list. */
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

  const furthest = placements.reduce((z, p) => Math.min(z, p.position[2] - p.width / 2), 0);
  const blockFar = Math.min(MIN_BLOCK_FAR, Math.floor(furthest - TAIL));

  const makeFiller = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    side: -1 | 1
  ): FillerBuilding => ({
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
  });

  /**
   * Filler that sits on the same building line as the restaurants, filling the
   * gaps between them. Without these the block reads as objects placed on a
   * plane; with them it reads as a street that happens to contain restaurants.
   */
  const gapFillers = (): FillerBuilding[] => {
    const out: FillerBuilding[] = [];

    for (const side of [-1, 1] as const) {
      const sideName = side === -1 ? "left" : "right";
      const occupied = placements
        .filter((p) => p.side === sideName)
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
      edges.push({ from: cursor, to: blockFar + 8 });

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
              makeFiller((BUILDING_LINE + depth / 2) * side, z - width / 2, width, depth, height, side)
            );
            z -= width + between(0.8, 2.2);
          } else {
            break;
          }
        }
      }
    }

    return out;
  };

  /**
   * Rows set back behind the shopfronts. These never face the street directly —
   * they exist to give the block a skyline and to stop the eye from running off
   * the edge of the ground plane.
   */
  const backdropRows = (): FillerBuilding[] => {
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
        while (z > blockFar - 16) {
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
  };

  /**
   * The far end of the street. A solid wall of buildings straight across would
   * read as a dead end, so a perpendicular road runs through first and the
   * buildings sit beyond it — the vista closes without feeling boxed in.
   */
  const crossStreetRow = (): FillerBuilding[] => {
    const out: FillerBuilding[] = [];
    let x = -78;
    while (x < 78) {
      const width = between(10, 18);
      const depth = between(11, 16);
      out.push({
        position: [x + width / 2, 0, blockFar - 12 - depth / 2],
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
  };

  // Order matters: every call to rand() advances the generator, so these run
  // in a fixed sequence to keep the street reproducible.
  const fillers = [...gapFillers(), ...backdropRows(), ...crossStreetRow()];

  /** Lamp posts alternate sides, so the block never looks like a runway. */
  const lamps: StreetProp[] = [];
  {
    let z = BLOCK_NEAR - 6;
    let side: -1 | 1 = -1;
    while (z > blockFar + 10) {
      lamps.push({
        position: [(ROAD_HALF_WIDTH + 1.1) * side, 0, z],
        // The arm reaches out over the road, so it has to know which way that is.
        rotation: side === -1 ? 0 : Math.PI,
        scale: 1,
      });
      side = side === -1 ? 1 : -1;
      z -= 15;
    }
  }
  // Lamps are placed on a fixed rhythm, then any standing in front of a
  // shopfront are taken out (below, once the shopfronts are known).

  const doors = placements.map((p) => ({ z: p.door[2], side: p.side, half: p.width / 2 }));
  /**
   * Is this spot on the pavement in front of a restaurant? Nothing tall or
   * solid is placed there: the camera parks across the street looking at the
   * windows, and a lamp post, a bench or a parked van between the two is the
   * one thing on the block guaranteed to be in the way.
   */
  const fronts = (sideName: "left" | "right", z: number, margin: number) =>
    doors.some((d) => d.side === sideName && Math.abs(d.z - z) < d.half + margin);

  /**
   * Street trees hug the kerb and skip the storefronts. Planted mid-pavement at
   * full size they sat directly in front of the signage — the block looked
   * lovely and you couldn't tell one restaurant from another.
   */
  const trees: StreetProp[] = [];
  for (const side of [-1, 1] as const) {
    const sideName = side === -1 ? "left" : "right";
    let z = BLOCK_NEAR - between(3, 9);
    while (z > blockFar + 12) {
      const shadesAShopfront = fronts(sideName, z, 2.5);
      if (!shadesAShopfront) {
        trees.push({
          position: [(ROAD_HALF_WIDTH + between(0.9, 1.8)) * side, 0, z],
          rotation: between(0, Math.PI * 2),
          scale: between(0.62, 0.95),
          color: pick(CITY.foliage),
        });
      }
      z -= between(11, 20);
    }
  }

  const benches: StreetProp[] = [];
  for (const side of [-1, 1] as const) {
    let z = BLOCK_NEAR - between(12, 26);
    const sideName = side === -1 ? "left" : "right";
    while (z > blockFar + 20) {
      if (!fronts(sideName, z, 1.5)) {
        benches.push({
          position: [(ROAD_HALF_WIDTH + 2.4) * side, 0, z],
          rotation: side === -1 ? 0 : Math.PI,
          scale: 1,
        });
      }
      z -= between(28, 46);
    }
  }

  /**
   * Cars parked along the kerb, nose-to-tail with realistic gaps. They sit just
   * inside the road edge and never in front of a doorway, so the fly-in has a
   * clear run at every entrance.
   */
  const cars: StreetProp[] = [];
  for (const side of [-1, 1] as const) {
    const sideName = side === -1 ? "left" : "right";
    let z = BLOCK_NEAR - between(6, 14);
    while (z > blockFar + 14) {
      const blocksADoor = fronts(sideName, z, 2.5);
      if (!blocksADoor) {
        cars.push({
          position: [(ROAD_HALF_WIDTH - 1.9) * side, 0, z],
          rotation: side === -1 ? 0 : Math.PI,
          scale: 1,
          color: pick(CITY.car),
        });
      }
      z -= between(9, 19);
    }
  }

  const clearLamps = lamps.filter(
    (lamp) => !fronts(lamp.position[0] < 0 ? "left" : "right", lamp.position[2], 0.5)
  );

  return { blockFar, fillers, lamps: clearLamps, trees, benches, cars };
}
