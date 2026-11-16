// ── The scene's shared colours ───────────────────────────────────────────────
//
// Kept in one module rather than inline in each component so the whole street
// can be re-graded in one place. The reference aesthetic is warm and pastel:
// nothing is pure white, nothing is pure black, and the "shadow" tones are
// desaturated versions of their surface rather than grey.

export const PALETTE = {
  /** Sky dome / canvas clear colour. */
  sky: "#B7DCEC",
  /** Fog colour — sits between sky and ground so the horizon has no hard seam. */
  haze: "#D6E6EC",

  /** Pavement either side of the road. */
  sidewalk: "#DED3C4",
  /** The road surface itself. */
  road: "#9E958A",
  /** Painted centre line. */
  roadLine: "#EFE6D6",
  /** Raised kerb between road and pavement. */
  kerb: "#C7BCAC",
  /** Planted strips and any greenery. */
  grass: "#8FB574",
} as const;

// ── Background city ──────────────────────────────────────────────────────────
//
// Everything here is deliberately drained of colour. The seven restaurants are
// the only saturated objects on the block, which is what lets the eye find them
// instantly in a street that is otherwise busy. If a filler building ever reads
// as more interesting than a storefront, desaturate it further — don't make the
// storefront louder.

export const CITY = {
  /** Bodies of the anonymous buildings that fill the block. */
  filler: [
    "#C9BFB2",
    "#B4AA9E",
    "#D3C9BC",
    "#A8A096",
    "#C2B6A8",
    "#BCB3A6",
    "#AEA598",
  ],
  /** Roof slabs and parapets. Darker than any body, so rooflines stay crisp. */
  fillerRoof: "#8B8378",
  /** Window bands. Cool against the warm masonry, which is what reads as glass. */
  window: "#8698A6",

  trunk: "#7A5A42",
  foliage: ["#7FA968", "#6B9455", "#8CB56F"],

  lampPost: "#4B4640",
  lampHead: "#F3E2B8",
  bench: "#8A6A4C",
  bin: "#5A5750",

  /** Parked cars. Muted too — a bright car pulls focus as hard as a sign. */
  car: ["#9AA6B0", "#B2A79C", "#8C9B93", "#A89293", "#7F8A96", "#C0B4A4"],
  tyre: "#33312E",
} as const;

/** Warm key light from the sky, cool-green bounce from the ground. */
export const LIGHT = {
  skyTint: "#FFF0DC",
  groundTint: "#9FB08A",
} as const;
