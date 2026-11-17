import type { MenuDocument } from "@/lib/menuDocument";
import chickFilA from "./chick-fil-a.json";
import mcdonalds from "./mcdonalds.json";
import chipotle from "./chipotle.json";
import tacoBell from "./taco-bell.json";
import pandaExpress from "./panda-express.json";
import raisingCanes from "./raising-canes.json";
import whataburger from "./whataburger.json";

// ── The seed ─────────────────────────────────────────────────────────────────
//
// Seven restaurants, one MenuDocument each. They are imported rather than read
// from disk so the bundler carries them into a serverless build — the app can
// seed an empty database without needing the filesystem at all.
//
// Array order is street order: the first restaurant stands nearest the camera.
//
// The cast is needed because TypeScript infers JSON literally ("fixed" becomes
// `string`). It is safe because every document is run through
// assertValidMenuDocument() before a single row is written, and db/seed is
// covered by a test that validates all of them.
export const SEED_DOCUMENTS = [
  chickFilA,
  mcdonalds,
  chipotle,
  tacoBell,
  pandaExpress,
  raisingCanes,
  whataburger,
] as unknown as MenuDocument[];
