import * as THREE from "three";
import type { RestaurantPlacement } from "@/lib/restaurants";

// ── Where the camera is allowed to be ────────────────────────────────────────
//
// Every pose in the app is defined here as a position plus a look-at target,
// rather than as position plus rotation. Targets compose: you can interpolate
// between "looking at the far end of the street" and "looking at Chipotle's
// door" and get something sensible the whole way. Interpolating raw Euler
// angles gives you gimbal wobble and occasional 350° spins.

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Vertical field of view, degrees. */
  fov: number;
}

/** The lens everything uses unless a pose says otherwise. */
export const DEFAULT_FOV = 50;

/** The parked street view. Home mode never leaves this. */
export const HOME_POSE: CameraPose = {
  position: new THREE.Vector3(0, 8, 26),
  target: new THREE.Vector3(0, 5.6, -14),
  fov: DEFAULT_FOV,
};

/** Roaming height, fixed — a camera that can also fly up gets lost instantly. */
export const ROAM_HEIGHT = 6;

/**
 * How much of the viewport the panel covers, as fractions of its width and
 * height. The storefront has to be framed in what is left.
 *
 *   desktop  the panel is docked to the right: { right: 0.3, bottom: 0 }
 *   phone    the sheet rises from the bottom:  { right: 0, bottom: 0.55 }
 */
export interface Obstruction {
  right: number;
  bottom: number;
}

export const NO_OBSTRUCTION: Obstruction = { right: 0, bottom: 0 };

/**
 * How far to slide the picture so its centre sits in the middle of the free
 * area, as fractions of the viewport: x < 0 is left, y > 0 is up.
 *
 * This is applied as a *lens shift* (see CameraRig), not by aiming the camera
 * somewhere else. Turning the camera to push a building off-centre makes its
 * verticals lean; shifting the lens moves it sideways and keeps it square,
 * which is how an architectural photographer does the same job.
 */
export const frameShift = (o: Obstruction) => ({ x: -o.right / 2, y: o.bottom / 2 });

/** The far kerb is 23 units from a facade; beyond this the camera is in a wall. */
const MAX_FOCUS_DISTANCE = 20.5;

/**
 * Camera pose for standing in front of a restaurant.
 *
 * The distance is worked out rather than fixed, because how much fits depends
 * on the shape of the free area. Two constraints, whichever needs more room:
 *
 *   width   the whole frontage must fit across the free width
 *   height  ground to roofline must fit in the free height
 *
 * On a wide desktop window height binds and the camera sits about 13 away. On
 * a phone held upright the free area is narrow and the frontage would need the
 * camera on the far side of the street — so the lens goes wider there instead,
 * and the distance is capped at the kerb.
 */
export function focusPose(
  p: RestaurantPlacement,
  viewport: { width: number; height: number },
  obstruction: Obstruction = NO_OBSTRUCTION
): CameraPose {
  const outward = p.side === "left" ? 1 : -1;
  const faceX = p.door[0];
  const z = p.door[2];

  const aspect = viewport.width / Math.max(viewport.height, 1);
  const freeWidth = 1 - obstruction.right;
  const freeHeight = 1 - obstruction.bottom;

  // An A-frame's roof is its whole building, and rises well above `height`.
  const roofline = p.roof === "aframe" ? p.height * 2.1 : p.height + 3;
  const tall = roofline + 3.5;

  const tanV = (fov: number) => Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const widthNeeds = (frontage: number, fov: number) => frontage / 2 / (tanV(fov) * aspect * freeWidth);

  // Room to breathe: a storefront that exactly fills the free area reads as
  // cropped. The roof overhangs the walls, and a little street either side is
  // what makes it a building on a street rather than a texture.
  const generous = p.width * 1.3 + 3;
  // …but on a phone there is no room to be generous. The bare frontage — sign
  // and all three windows — is what must fit.
  const bare = p.width + 1;

  let fov = DEFAULT_FOV;
  let frontage = generous;
  if (widthNeeds(generous, fov) > MAX_FOCUS_DISTANCE) {
    // Too narrow to fit from this side of the street with the normal lens.
    // Drop the margins, then widen the lens just as far as it takes — up to
    // about 70°, past which low-poly buildings start to stretch at the edges.
    frontage = bare;
    const needed = THREE.MathUtils.radToDeg(
      2 * Math.atan(bare / 2 / (MAX_FOCUS_DISTANCE * aspect * freeWidth))
    );
    fov = THREE.MathUtils.clamp(needed, DEFAULT_FOV, 70);
  }

  const forWidth = widthNeeds(frontage, fov);
  const forHeight = tall / 2 / (tanV(fov) * freeHeight);
  const distance = Math.min(MAX_FOCUS_DISTANCE, Math.max(forWidth, forHeight, 11));

  // Aim at the middle of what has to be seen, a little below centre so the
  // boards — the point of being here — sit in the comfortable part of the frame.
  const aimY = roofline * 0.46;

  return {
    position: new THREE.Vector3(faceX + outward * distance, aimY + 1.6, z),
    target: new THREE.Vector3(faceX, aimY, z),
    fov,
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const scratch = new THREE.Matrix4();

/**
 * The orientation a camera at `position` needs in order to look at `target`.
 *
 * `Matrix4.lookAt` builds a basis whose -Z points at the target, which is
 * exactly the convention three.js cameras use, so the result drops straight
 * into `camera.quaternion` and can be slerped.
 */
export function lookQuaternion(
  position: THREE.Vector3,
  target: THREE.Vector3,
  out = new THREE.Quaternion()
): THREE.Quaternion {
  scratch.lookAt(position, target, UP);
  return out.setFromRotationMatrix(scratch);
}
