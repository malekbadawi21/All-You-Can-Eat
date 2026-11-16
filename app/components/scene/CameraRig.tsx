"use client";

/* eslint-disable react-hooks/immutability --
 * This file mutates the camera from `useThree()` inside `useFrame`, and the
 * canvas element's tabIndex inside an effect. The rule reads both as "mutating
 * a value derived from a hook after render" and suggests using state instead.
 *
 * That advice is right for React and wrong for react-three-fiber. `useFrame`
 * exists specifically to run imperative work once per rendered frame; routing
 * camera position through React state would re-render the entire scene sixty
 * times a second to express something the renderer reads directly off the
 * object anyway. The mutations here are confined to one camera that only this
 * component drives, so there is no shared value to become inconsistent.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { BUILDING_LINE } from "@/lib/restaurants";
import { BLOCK_NEAR, BLOCK_FAR } from "./cityLayout";
import { lookQuaternion, ROAM_HEIGHT, type CameraPose } from "./cameraPoses";
import { pointerState } from "./pointerState";

// ── One camera, four behaviours ──────────────────────────────────────────────
//
// Everything in the app shares a single camera. Swapping between separate
// cameras produces a hard cut, and cuts are the fastest way to make a scene
// feel cheap; with one camera and a mode switch, every transition can be a
// move instead.
//
//   home     parked at the street view, no input
//   roam     free movement on the street plane, drag to look
//   flying   following a curve; ignores input entirely
//   focused  parked in front of a storefront
//
// Nothing here is React state. Camera work happens every frame, and driving it
// through state would re-render the whole scene sixty times a second.

export type CameraMode = "home" | "roam" | "flying" | "focused";

interface Flight {
  curve: THREE.CatmullRomCurve3;
  fromQuat: THREE.Quaternion;
  toQuat: THREE.Quaternion;
  duration: number;
  elapsed: number;
}

interface Props {
  mode: CameraMode;
  /** Where to sit while parked. Ignored in roam and flying. */
  parked: CameraPose | null;
  /** Destination for the next flight. */
  flightTo: CameraPose | null;
  /**
   * Bumped by the parent to launch a flight. A counter rather than a boolean
   * so that flying to the same place twice still starts a second flight.
   */
  flightKey: number;
  /** Kept current every frame, so the parent can snapshot where to fly back to. */
  poseRef: RefObject<CameraPose>;
  onFlightComplete: () => void;
}

/** Slow at both ends, quick through the middle — the shape of a camera move. */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Frame-rate independent easing.
 *
 * A plain `lerp(a, b, 0.1)` moves ten percent of the way *per frame*, so the
 * camera arrives twice as fast on a 120Hz display as on a 60Hz one. Decaying
 * exponentially over elapsed time removes the frame rate from the result.
 */
const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

const ROAM_SPEED = 26;
const LOOK_SENSITIVITY = 0.0032;
/** Stops the roam camera pitching far enough to end up looking at its own feet. */
const MAX_PITCH = 0.55;
/** Keeps the roaming camera in the street rather than inside a wall. */
const ROAM_X_LIMIT = BUILDING_LINE - 1.5;

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACK_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);

// Scratch objects, allocated once at module scope. Building vectors inside
// useFrame means sixty allocations a second and a garbage collection pause you
// can see. Module scope rather than a ref because reading `ref.current` during
// render is exactly what the React compiler forbids — and only one rig ever
// exists, with every use confined to a single synchronous frame callback.
const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

export default function CameraRig({
  mode,
  parked,
  flightTo,
  flightKey,
  poseRef,
  onFlightComplete,
}: Props) {
  const { camera, gl } = useThree();

  const flightRef = useRef<Flight | null>(null);
  const keysRef = useRef(new Set<string>());
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const draggingRef = useRef(false);

  // ── Launch a flight whenever the parent bumps flightKey ────────────────────
  useEffect(() => {
    if (flightKey === 0 || !flightTo) return;

    const from = camera.position.clone();
    const to = flightTo.position.clone();

    // Lift the midpoint so the camera arcs over the street rather than sliding
    // through it in a straight line — and, incidentally, over the parked cars.
    const mid = from.clone().lerp(to, 0.5);
    mid.y = Math.max(from.y, to.y) + 6;

    const distance = from.distanceTo(to);

    flightRef.current = {
      curve: new THREE.CatmullRomCurve3([from, mid, to], false, "catmullrom", 0.5),
      // Starting from the camera's *live* orientation is what makes flights
      // interruptible: re-triggering mid-flight simply builds a fresh curve
      // from wherever the camera currently is, with nothing to snap back from.
      fromQuat: camera.quaternion.clone(),
      toQuat: lookQuaternion(to, flightTo.target),
      duration: THREE.MathUtils.clamp(distance / 24, 1.1, 2.3),
      elapsed: 0,
    };
    // `camera` and `flightTo` are read at launch time on purpose; re-running
    // this effect when they change would restart the flight mid-air.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightKey]);

  // ── Roam input ────────────────────────────────────────────────────────────
  //
  // Listeners live on the canvas rather than the window so that typing in the
  // search overlay never walks the camera down the street.
  useEffect(() => {
    const canvas = gl.domElement;
    // The canvas needs to be focusable to receive key events at all.
    canvas.tabIndex = 0;

    const keys = keysRef.current;
    const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    /** Held keys would otherwise stay "pressed" forever after focus is lost. */
    const onBlur = () => keys.clear();

    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = true;
      pointerState.dragDistance = 0;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      pointerState.dragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (mode !== "roam") return;
      yawRef.current -= e.movementX * LOOK_SENSITIVITY;
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current - e.movementY * LOOK_SENSITIVITY,
        -MAX_PITCH,
        MAX_PITCH
      );
    };

    const onPointerUp = (e: PointerEvent) => {
      draggingRef.current = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };

    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("blur", onBlur);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, [gl, mode]);

  // Entering roam adopts whatever the camera is already doing, so the handover
  // from a parked pose to player control has no visible jump.
  useEffect(() => {
    if (mode !== "roam") {
      keysRef.current.clear();
      return;
    }
    tmpEuler.setFromQuaternion(camera.quaternion, "YXZ");
    yawRef.current = tmpEuler.y;
    pitchRef.current = THREE.MathUtils.clamp(tmpEuler.x, -MAX_PITCH, MAX_PITCH);
    gl.domElement.focus();
  }, [mode, camera, gl]);

  useFrame((_, rawDelta) => {
    // A backgrounded tab resumes with an enormous delta, which would teleport
    // the camera across the map on the first frame back.
    const dt = Math.min(rawDelta, 0.1);

    if (mode === "flying") {
      const flight = flightRef.current;
      if (flight) {
        flight.elapsed += dt;
        const t = THREE.MathUtils.clamp(flight.elapsed / flight.duration, 0, 1);
        const eased = easeInOutCubic(t);

        flight.curve.getPoint(eased, tmpVec);
        camera.position.copy(tmpVec);
        camera.quaternion.slerpQuaternions(flight.fromQuat, flight.toQuat, eased);

        if (t >= 1) {
          flightRef.current = null;
          onFlightComplete();
        }
      }
    } else if (mode === "roam") {
      const keys = keysRef.current;
      let forward = 0;
      let strafe = 0;
      for (const code of keys) {
        if (FORWARD_KEYS.has(code)) forward += 1;
        else if (BACK_KEYS.has(code)) forward -= 1;
        else if (LEFT_KEYS.has(code)) strafe -= 1;
        else if (RIGHT_KEYS.has(code)) strafe += 1;
      }

      if (forward !== 0 || strafe !== 0) {
        const yaw = yawRef.current;
        // Movement uses yaw only, ignoring pitch, so looking up at a sign does
        // not make you walk into the sky.
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const step = ROAM_SPEED * dt;

        camera.position.x += (-sin * forward + cos * strafe) * step;
        camera.position.z += (-cos * forward - sin * strafe) * step;

        camera.position.x = THREE.MathUtils.clamp(
          camera.position.x,
          -ROAM_X_LIMIT,
          ROAM_X_LIMIT
        );
        camera.position.z = THREE.MathUtils.clamp(
          camera.position.z,
          BLOCK_FAR + 18,
          BLOCK_NEAR + 12
        );
      }

      camera.position.y = ROAM_HEIGHT;
      tmpEuler.set(pitchRef.current, yawRef.current, 0, "YXZ");
      camera.quaternion.setFromEuler(tmpEuler);
    } else if (parked) {
      // home and focused: ease onto the parked pose. Easing rather than
      // snapping is what makes arriving from a flight, or being handed back
      // from roam, look like the camera settling instead of teleporting.
      const k = damp(7, dt);
      camera.position.lerp(parked.position, k);
      lookQuaternion(camera.position, parked.target, tmpQuat);
      camera.quaternion.slerp(tmpQuat, k);
    }

    // Publish the live pose so the parent can snapshot a return destination.
    poseRef.current.position.copy(camera.position);
    camera.getWorldDirection(tmpVec);
    poseRef.current.target
      .copy(camera.position)
      .addScaledVector(tmpVec, 20);
  });

  return (
    <PerspectiveCamera
      makeDefault
      position={[HOME_START.x, HOME_START.y, HOME_START.z]}
      fov={50}
      near={0.5}
      far={400}
    />
  );
}

/** Initial placement, before the first frame eases it onto the home pose. */
const HOME_START = new THREE.Vector3(0, 8, 26);
