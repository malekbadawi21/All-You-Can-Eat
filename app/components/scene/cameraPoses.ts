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
}

/** The parked street view. Home mode never leaves this. */
export const HOME_POSE: CameraPose = {
  position: new THREE.Vector3(0, 8, 26),
  target: new THREE.Vector3(0, 5.6, -14),
};

/**
 * How far back from a facade the camera parks.
 *
 * A storefront is about 13 wide and 10 tall including its roof. With a 50°
 * vertical field of view, height is the binding constraint: fitting 10 units
 * needs (10/2)/tan(25°) ≈ 10.7. Thirteen leaves margin for the roofline above
 * and the menu boards below without the facade drifting to postage-stamp size.
 */
const FOCUS_DISTANCE = 13;
/** Slightly above eye level, so the boards are read looking gently down. */
const FOCUS_HEIGHT = 7;
/** Aim between the sign and the door, which centres the whole shopfront. */
const FOCUS_TARGET_Y = 4.6;

/** Roaming height, fixed — a camera that can also fly up gets lost instantly. */
export const ROAM_HEIGHT = 6;

/**
 * Camera pose for standing in front of a restaurant.
 *
 * `door[0]` is already the front face's X — negative for the left-hand side of
 * the street, positive for the right — so stepping *outward* toward the road
 * is just the opposite sign.
 */
export function focusPose(p: RestaurantPlacement): CameraPose {
  const outward = p.side === "left" ? 1 : -1;
  const faceX = p.door[0];
  const z = p.door[2];

  return {
    position: new THREE.Vector3(faceX + outward * FOCUS_DISTANCE, FOCUS_HEIGHT, z),
    target: new THREE.Vector3(faceX, FOCUS_TARGET_Y, z),
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
