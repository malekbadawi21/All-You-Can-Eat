// ── Restaurant identity, for the scene only ──────────────────────────────────
//
// This is presentation data: colour, roofline, where on the block a restaurant
// stands. The search API never returns any of it and never should — nutrition
// facts and architecture are different concerns. The two agree on one thing,
// `slug`, which is the stable identifier in the search contract, so the scene
// can react to a SearchResponse without either side importing the other.
//
// We have no right to use anyone's logo, so recognition is built from four
// layers instead, in descending order of how far away they work:
//
//   1. brand colour   — readable at the far end of the block
//   2. roofline       — readable once the silhouette resolves
//   3. sign + awning  — readable from the pavement
//   4. mascot prop    — readable at the door
//
// The rule to hold: (1) and (2) alone must be enough to tell any two
// restaurants apart. If you squint at the street and two buildings merge,
// that's a bug in this table, not in the renderer.

export type RoofStyle = "hip" | "flat" | "gable" | "pagoda" | "aframe";

/**
 * How a storefront looks. This is what the database stores per restaurant (as
 * JSON) and what a menu document may carry; everything about *where* it stands
 * is worked out separately by placeRestaurants() below.
 */
export interface StorefrontIdentity {
  /** Body and sign colour — the thing you recognise from a distance. */
  brand: string;
  /** Roof, awning and accent colour. */
  trim: string;
  /**
   * Lettering colour for the sign. Chosen per restaurant rather than derived,
   * because "is this background light or dark" is a judgement call at the
   * yellows — cream on #EFB33C is unreadable, near-black on #DD0031 is worse.
   */
  ink: string;
  roof: RoofStyle;
  /** Frontage along the street, in world units. */
  width: number;
  /** How far back from the pavement the building runs. */
  depth: number;
  height: number;
}

export interface RestaurantIdentity extends StorefrontIdentity {
  /** Matches the slug used by parseQuery and the restaurants table. */
  slug: string;
  name: string;
  side: "left" | "right";
}

// ── Street geometry ──────────────────────────────────────────────────────────
//
// The street runs along -Z: the camera looks from +Z into the scene, so
// "further down the block" is "more negative". Shared with CityScene so the
// road surface and the buildings can't drift apart.

export const ROAD_HALF_WIDTH = 7;
/** Pavement between kerb and building line. */
export const SIDEWALK_WIDTH = 4.5;
/** X coordinate of every building's front face (mirrored for the right side). */
export const BUILDING_LINE = ROAD_HALF_WIDTH + SIDEWALK_WIDTH;

/** Gap between consecutive buildings on the same side. */
const SPACING = 19;
/** How far the first building sits from the origin. */
const FIRST_Z = -6;
/**
 * Right-hand buildings are pushed half a spacing further down the block, so no
 * two buildings sit directly opposite each other. Facing pairs read as a
 * corridor; an offset reads as depth. This one number is most of why the
 * street looks like a street.
 */
const STAGGER = SPACING / 2;

export const RESTAURANTS: RestaurantIdentity[] = [
  {
    slug: "chick-fil-a",
    name: "Chick-fil-A",
    brand: "#DD0031",
    trim: "#FBF7F0",
    ink: "#FBF7F0",
    roof: "hip",
    side: "left",
    width: 13,
    depth: 11,
    height: 7,
  },
  {
    slug: "mcdonalds",
    name: "McDonald's",
    brand: "#EFB33C",
    trim: "#C0392B",
    ink: "#3A2A12",
    roof: "flat",
    side: "right",
    width: 14,
    depth: 12,
    height: 6.5,
  },
  {
    slug: "chipotle",
    name: "Chipotle",
    brand: "#8C2B22",
    trim: "#C9A227",
    ink: "#F5E9D0",
    roof: "flat",
    side: "left",
    width: 12,
    depth: 11,
    height: 8,
  },
  {
    slug: "taco-bell",
    name: "Taco Bell",
    brand: "#702082",
    trim: "#F0E4CE",
    ink: "#F7EFDF",
    roof: "gable",
    side: "right",
    width: 13,
    depth: 11,
    height: 6,
  },
  {
    slug: "panda-express",
    name: "Panda Express",
    brand: "#C8102E",
    trim: "#3A3A3A",
    ink: "#FBF7F0",
    roof: "pagoda",
    side: "left",
    width: 13,
    depth: 11,
    height: 6,
  },
  {
    slug: "raising-canes",
    name: "Raising Cane's",
    brand: "#E8B22B",
    trim: "#C0392B",
    ink: "#3A2A12",
    roof: "hip",
    side: "right",
    width: 12,
    depth: 11,
    height: 6.5,
  },
  {
    slug: "whataburger",
    name: "Whataburger",
    brand: "#EA580C",
    trim: "#FBF7F0",
    ink: "#FFF6EC",
    roof: "aframe",
    side: "left",
    width: 13,
    depth: 12,
    height: 5,
  },
];

export interface RestaurantPlacement extends RestaurantIdentity {
  /** World position of the building's centre, at ground level. */
  position: [number, number, number];
  /** Y rotation — right-hand buildings are the same model turned around. */
  rotation: number;
  /** World position of the doorway, used later for the camera fly-in. */
  door: [number, number, number];
}

/**
 * Positions are computed from each restaurant's index down its own side of the
 * street rather than written by hand, so the layout stays consistent and
 * adding a restaurant means adding a row above and nothing else.
 */
export const PLACEMENTS: RestaurantPlacement[] = (() => {
  let leftCount = 0;
  let rightCount = 0;

  return RESTAURANTS.map((r) => {
    const isLeft = r.side === "left";
    const index = isLeft ? leftCount++ : rightCount++;

    const z = FIRST_Z - index * SPACING - (isLeft ? 0 : STAGGER);
    // The building line is the front face, so the centre sits half a depth back.
    const x = (BUILDING_LINE + r.depth / 2) * (isLeft ? -1 : 1);
    const doorX = BUILDING_LINE * (isLeft ? -1 : 1);

    return {
      ...r,
      position: [x, 0, z] as [number, number, number],
      rotation: isLeft ? 0 : Math.PI,
      door: [doorX, 0, z] as [number, number, number],
    };
  });
})();

export const bySlug = (slug: string): RestaurantPlacement | undefined =>
  PLACEMENTS.find((p) => p.slug === slug);
