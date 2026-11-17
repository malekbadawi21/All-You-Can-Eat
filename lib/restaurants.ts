// ── Restaurant identity, for the scene only ──────────────────────────────────
//
// This is presentation data: colour, roofline, where on the block a restaurant
// stands. The search API never returns any of it and never should — nutrition
// facts and architecture are different concerns. The two agree on one thing,
// `slug`, so the scene can react to a search result without either side
// importing the other.
//
// We have no right to use anyone's logo, so recognition is built from layers
// instead, in descending order of how far away they work:
//
//   1. brand colour   — readable at the far end of the block
//   2. roofline       — readable once the silhouette resolves
//   3. sign + awning  — readable from the pavement
//
// WHERE THE DATA LIVES NOW: a restaurant's identity is stored with it in the
// database (the `identity` column; see db/seed/*.json for the seven
// hand-authored ones). This file no longer lists restaurants at all. It does
// two things for *any* list it is handed:
//
//   identityFor()      gives a storefront to a restaurant that has none —
//                      which is every dynamically ingested one
//   placeRestaurants() decides where each stands on the street
//
// That is what lets the street work for N restaurants instead of seven.

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

/** A restaurant as the scene needs it: who, and what it looks like. */
export interface StreetRestaurant {
  slug: string;
  name: string;
  identity: StorefrontIdentity;
}

// ── A storefront for a restaurant nobody has designed one for ────────────────
//
// Generated from the slug, so the same restaurant always gets the same
// building — on every load, on every machine, and before and after a redeploy.
// The palette is hand-picked rather than computed: every pair of colours here
// was chosen so the sign lettering stays readable, which a random hue cannot
// promise. None of them is anyone's trade dress; a newly ingested restaurant
// gets *a* distinct building, not an imitation of its real one.

const PALETTE: Pick<StorefrontIdentity, "brand" | "trim" | "ink">[] = [
  { brand: "#2F6DB5", trim: "#F3ECDD", ink: "#FBF7F0" }, // blue
  { brand: "#2E8B57", trim: "#F5E6A8", ink: "#FBF7F0" }, // green
  { brand: "#1F8A8A", trim: "#F2E9D8", ink: "#F7FBFA" }, // teal
  { brand: "#B5527A", trim: "#F6E9DC", ink: "#FFF7F2" }, // rose
  { brand: "#3B4A6B", trim: "#E9B44C", ink: "#F6EFE0" }, // navy and gold
  { brand: "#6F8F2F", trim: "#F4EBD0", ink: "#FBF7F0" }, // olive
  { brand: "#C96A3D", trim: "#2F6F73", ink: "#FFF6EC" }, // terracotta
  { brand: "#5B4A9C", trim: "#F0D9A8", ink: "#F7F2FF" }, // indigo
  { brand: "#E3A72F", trim: "#2E5E8C", ink: "#2A2410" }, // amber and blue
  { brand: "#4E8FA8", trim: "#F7E3C4", ink: "#F7FBFD" }, // sky
];

const ROOFS: RoofStyle[] = ["flat", "hip", "gable", "flat", "hip"];

/** FNV-1a: a small, stable string hash. Not cryptographic, and needn't be. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function identityFor(slug: string, stored: StorefrontIdentity | null): StorefrontIdentity {
  if (stored) return stored;

  const h = hash(slug);
  // Different bits of the hash drive different choices, so two restaurants
  // that land on the same colour needn't also share a roof and a size.
  return {
    ...PALETTE[h % PALETTE.length],
    roof: ROOFS[(h >>> 8) % ROOFS.length],
    width: 12 + ((h >>> 12) % 3),
    depth: 11 + ((h >>> 16) % 2),
    height: 6 + ((h >>> 20) % 4) * 0.5,
  };
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

export interface RestaurantPlacement extends StorefrontIdentity {
  slug: string;
  name: string;
  side: "left" | "right";
  /** World position of the building's centre, at ground level. */
  position: [number, number, number];
  /** Y rotation — right-hand buildings are the same model turned around. */
  rotation: number;
  /** World position of the doorway, used for the camera fly-in. */
  door: [number, number, number];
}

/**
 * Where each restaurant stands. Sides alternate down the list — first on the
 * left, second on the right — and each side fills from the near end, so adding
 * a restaurant extends the street rather than rearranging it. Nothing here
 * knows how many restaurants there are.
 */
export function placeRestaurants(restaurants: StreetRestaurant[]): RestaurantPlacement[] {
  return restaurants.map((r, i) => {
    const isLeft = i % 2 === 0;
    const index = Math.floor(i / 2);
    const { identity } = r;

    const z = FIRST_Z - index * SPACING - (isLeft ? 0 : STAGGER);
    // The building line is the front face, so the centre sits half a depth back.
    const x = (BUILDING_LINE + identity.depth / 2) * (isLeft ? -1 : 1);
    const doorX = BUILDING_LINE * (isLeft ? -1 : 1);

    return {
      ...identity,
      slug: r.slug,
      name: r.name,
      side: isLeft ? "left" : "right",
      position: [x, 0, z],
      rotation: isLeft ? 0 : Math.PI,
      door: [doorX, 0, z],
    };
  });
}
