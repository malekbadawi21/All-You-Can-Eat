"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import Overlay from "./components/ui/Overlay";
import { useSearch } from "./components/ui/useSearch";
import { HOME_POSE, focusPose, type CameraPose } from "./components/scene/cameraPoses";
import type { CameraMode } from "./components/scene/CameraRig";
import type { OrderResult } from "@/lib/searchResult";
import { bySlug } from "@/lib/restaurants";

// The 3D layer is loaded on the client only, for two independent reasons:
//
//   1. three.js reaches for `window` and a WebGL context at import time, which
//      does not exist during a server render.
//   2. three + fiber + drei is a large bundle. Dynamic import keeps it out of
//      the initial payload so the page shell paints while it downloads.
//
// `ssr: false` is only legal inside a Client Component in this version of
// Next — hence the "use client" above.
const CityScene = dynamic(() => import("./components/scene/CityScene"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-[#B7DCEC]">
      <p className="text-white/80 font-semibold tracking-wide">Setting the table…</p>
    </div>
  ),
});

/** Boards show this until a search lands. */
const IDLE_BOARD = "Tell us what you're after";
const LOADING_BOARD = "Checking the kitchen…";

/**
 * The top three orders go on the three boards. The API returns at most a
 * handful; taking three is a presentation decision, not an API one.
 */
const BOARD_COUNT = 3;

export default function Home() {
  const { state, run, reset } = useSearch();

  const [mode, setMode] = useState<CameraMode>("home");
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const [results, setResults] = useState<OrderResult[] | null>(null);

  // Where a flight is heading, and a counter that launches it. A counter
  // rather than a boolean so flying to the same storefront twice still works.
  const [flightTo, setFlightTo] = useState<CameraPose | null>(null);
  const [flightKey, setFlightKey] = useState(0);

  // What the flight in progress is for. The rig reports "arrived" without
  // knowing which direction it was going, so the intent is recorded here and
  // read on arrival — rather than guessing from state, or timing it.
  const intentRef = useRef<"enter" | "exit">("enter");

  // Which mode to hand back to when the user backs out, and the exact pose to
  // return to. Roam can end anywhere, so the pose has to be captured rather
  // than recomputed.
  const originRef = useRef<{ mode: CameraMode; pose: CameraPose }>({
    mode: "home",
    pose: HOME_POSE,
  });

  // Kept current by the rig every frame.
  const poseRef = useRef<CameraPose>({
    position: new THREE.Vector3().copy(HOME_POSE.position),
    target: new THREE.Vector3().copy(HOME_POSE.target),
  });

  const focused = focusedSlug ? bySlug(focusedSlug) : undefined;

  const flyTo = useCallback((pose: CameraPose, intent: "enter" | "exit") => {
    intentRef.current = intent;
    setFlightTo(pose);
    setFlightKey((k) => k + 1);
    setMode("flying");
  }, []);

  /** Remember where we came from, so backing out retraces the way in. */
  const rememberOrigin = useCallback((from: CameraMode) => {
    originRef.current = {
      mode: from,
      pose: {
        position: poseRef.current.position.clone(),
        target: poseRef.current.target.clone(),
      },
    };
  }, []);

  // ── Home: one query does everything ───────────────────────────────────────
  //
  // The query names the restaurant *and* the food criteria, so a single call
  // both picks the destination and fills the boards. There is no second search
  // on arrival — the answer is already in hand before the camera moves.
  const handleHomeSearch = useCallback(
    async (query: string) => {
      const data = await run(query);
      if (!data) return; // useSearch has already surfaced the failure

      const placement = bySlug(data.restaurant.slug);
      if (!placement) return;

      rememberOrigin("home");
      setFocusedSlug(placement.slug);
      setResults(data.results.slice(0, BOARD_COUNT));
      flyTo(focusPose(placement), "enter");
    },
    [run, flyTo, rememberOrigin]
  );

  // ── Free roam: click a building ───────────────────────────────────────────
  const handleSelectRestaurant = useCallback(
    (slug: string) => {
      const placement = bySlug(slug);
      if (!placement) return;

      rememberOrigin("roam");
      setFocusedSlug(slug);
      // Arriving by click means no query has been asked yet, so the boards
      // wait in their idle state.
      setResults(null);
      reset();
      flyTo(focusPose(placement), "enter");
    },
    [flyTo, rememberOrigin, reset]
  );

  // ── At a storefront: criteria only ────────────────────────────────────────
  //
  // The bar here is restaurant-agnostic by design — you're standing in front
  // of the building. But /api/search infers the restaurant from the query
  // text, so the name is appended before sending.
  const handleStorefrontSearch = useCallback(
    async (criteria: string) => {
      if (!focused) return;

      const data = await run(`${criteria} ${focused.name}`);
      if (!data) return;

      // If the criteria happened to name a different chain, the parser may
      // have picked that one instead. Showing another restaurant's food on
      // these boards would be a lie about where you're standing.
      if (data.restaurant.slug !== focused.slug) {
        setResults(null);
        return;
      }

      setResults(data.results.slice(0, BOARD_COUNT));
    },
    [focused, run]
  );

  const handleFlightComplete = useCallback(() => {
    if (intentRef.current === "enter") {
      setMode("focused");
      return;
    }
    // Backing out: hand the camera to whichever mode we came from, and only
    // now clear the focus. Clearing it at the moment the button was pressed
    // would blank the boards while the camera was still pulling away from them.
    setMode(originRef.current.mode);
    setFocusedSlug(null);
    setResults(null);
    reset();
  }, [reset]);

  const handleBack = useCallback(() => {
    if (mode === "roam") {
      // Roam has no flight to unwind — it hands straight back to the parked
      // home pose, which `parked` eases onto.
      setMode("home");
      reset();
      return;
    }
    flyTo(originRef.current.pose, "exit");
  }, [mode, reset, flyTo]);

  const handleExplore = useCallback(() => {
    reset();
    setMode("roam");
  }, [reset]);

  const parked =
    mode === "home"
      ? HOME_POSE
      : mode === "focused" && focused
        ? focusPose(focused)
        : null;

  const boardMessage =
    state.status === "loading"
      ? LOADING_BOARD
      : state.status === "error"
        ? "We don't have that here"
        : IDLE_BOARD;

  // Errors belong next to the box that caused them, and only while the user is
  // somewhere they can act on them.
  const errorMessage =
    state.status === "error" && (mode === "home" || mode === "focused")
      ? state.message
      : null;

  return (
    <main className="fixed inset-0 overflow-hidden">
      <CityScene
        mode={mode}
        focusedSlug={focusedSlug}
        parked={parked}
        flightTo={flightTo}
        flightKey={flightKey}
        poseRef={poseRef}
        onFlightComplete={handleFlightComplete}
        onSelectRestaurant={handleSelectRestaurant}
        results={results}
        boardMessage={boardMessage}
      />

      <Overlay
        mode={mode}
        busy={state.status === "loading"}
        errorMessage={errorMessage}
        available={state.status === "error" ? state.available : undefined}
        focusedName={focused?.name ?? null}
        focusedAccent={focused?.brand ?? "#059669"}
        onHomeSearch={handleHomeSearch}
        onStorefrontSearch={handleStorefrontSearch}
        onExplore={handleExplore}
        onBack={handleBack}
      />
    </main>
  );
}
