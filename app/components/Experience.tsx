"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CriteriaChip } from "@/lib/criteria";
import { placeRestaurants, type StreetRestaurant } from "@/lib/restaurants";
import type { SearchResponse } from "@/lib/searchResult";
import type { CameraMode } from "./scene/CameraRig";
import {
  HOME_POSE,
  NO_OBSTRUCTION,
  focusPose,
  frameShift,
  type CameraPose,
  type Obstruction,
} from "./scene/cameraPoses";
import HomePanel, { type HomeError } from "./ui/HomePanel";
import Joystick from "./ui/Joystick";
import StaticStreet from "./ui/StaticStreet";
import StorefrontPanel from "./ui/StorefrontPanel";
import { requestSearch, type Turn } from "./ui/conversation";
import {
  useCoarsePointer,
  useIsDesktop,
  useReducedMotion,
  useViewport,
  useWebGLSupport,
} from "./ui/hooks";

// ── The whole app, as one component ──────────────────────────────────────────
//
// Both pages — the street ("/") and a storefront ("/restaurant/[slug]") —
// render this. They differ only in where it starts. That matters because of
// the canvas: moving between a storefront and the street must not tear down
// and rebuild the 3D scene, so those moves happen *inside* this component and
// the address bar is updated to match with history.pushState, which Next's
// router understands without swapping the page.
//
// What lives here is the choreography between three things that otherwise know
// nothing about each other:
//
//   the URL          where you are, linkably
//   the camera       one camera, four modes (see scene/CameraRig.tsx)
//   the conversation what you asked and what came back (see ui/conversation.ts)
//
// The 3D scene is an enhancement over a page that already works. It is loaded
// separately, on the client only, and everything below is written so that the
// same clicks do the same things when it is absent.

// three + fiber + drei is a large bundle, and three reaches for `window` at
// import time. Dynamic import with `ssr: false` keeps it out of both the server
// render and the initial payload; the page shell paints while it downloads.
const CityScene = dynamic(() => import("./scene/CityScene"), { ssr: false, loading: () => null });

export interface ExperienceProps {
  /** Every restaurant on the street, in street order. */
  restaurants: StreetRestaurant[];
  /** Set when the page was opened at a storefront: where, and its first answer. */
  initial: { slug: string; response: SearchResponse; said: string | null } | null;
}

/** Width of the docked panel plus its margin, in CSS pixels. Matches StorefrontPanel. */
const PANEL_WIDTH = 27.5 * 16 + 32;
/** Height of the phone sheet, raised and tucked. Matches StorefrontPanel. */
const SHEET_OPEN = 0.62;
const SHEET_PEEK_PX = 164;

const urlFor = (slug: string, canonical?: string) =>
  `/restaurant/${encodeURIComponent(slug)}${canonical ? `?q=${encodeURIComponent(canonical)}` : ""}`;

const slugIn = (pathname: string): string | null => {
  const match = /^\/restaurant\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
};

export default function Experience({ restaurants, initial }: ExperienceProps) {
  const placements = useMemo(() => placeRestaurants(restaurants), [restaurants]);
  const bySlug = useCallback((slug: string) => placements.find((p) => p.slug === slug), [placements]);

  // ── Device ────────────────────────────────────────────────────────────────
  const viewport = useViewport();
  const isDesktop = useIsDesktop();
  const reducedMotion = useReducedMotion();
  const coarsePointer = useCoarsePointer();
  const webgl = useWebGLSupport();
  const [contextLost, setContextLost] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const sceneOn = webgl === "yes" && !contextLost;

  // ── Where we are ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<CameraMode>(initial ? "focused" : "home");
  const [focusedSlug, setFocusedSlug] = useState<string | null>(initial?.slug ?? null);
  /** True while the camera is pulling away from a storefront. */
  const [leaving, setLeaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [activeBoard, setActiveBoard] = useState<number | null>(null);
  /** Where "back" leads from a storefront: the home view, or the street walk. */
  const [backLabel, setBackLabel] = useState<"Home" | "Street">("Home");

  // ── The conversation ──────────────────────────────────────────────────────
  const [turns, setTurns] = useState<Turn[]>(
    initial ? [{ id: 1, said: initial.said, status: "ok", response: initial.response }] : []
  );
  const [homeBusy, setHomeBusy] = useState(false);
  const [homeError, setHomeError] = useState<HomeError | null>(null);

  // ── The camera ────────────────────────────────────────────────────────────
  //
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
  const originRef = useRef<{ mode: "home" | "roam"; pose: CameraPose }>({ mode: "home", pose: HOME_POSE });

  // Kept current by the rig every frame.
  const poseRef = useRef<CameraPose>({
    position: HOME_POSE.position.clone(),
    target: HOME_POSE.target.clone(),
    fov: HOME_POSE.fov,
  });

  // Mirrors of state for use inside callbacks that must not go stale: the
  // restaurant the user means to be at (set *before* the URL changes, so the
  // URL effect can tell our own navigation from the back button), a ticket for
  // discarding late responses, and the request in flight.
  const targetSlugRef = useRef<string | null>(initial?.slug ?? null);
  const modeRef = useRef(mode);
  const turnTicket = useRef(1);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const focused = focusedSlug ? bySlug(focusedSlug) : undefined;
  const focusedRestaurant = focusedSlug ? restaurants.find((r) => r.slug === focusedSlug) : undefined;

  // How much of the screen the panel covers, which decides how the storefront
  // is framed. Desktop: a column on the right. Phone: a sheet from the bottom.
  const obstructionFor = useCallback(
    (sheet: boolean): Obstruction =>
      isDesktop
        ? { right: Math.min(0.5, PANEL_WIDTH / Math.max(viewport.width, 1)), bottom: 0 }
        : { right: 0, bottom: sheet ? SHEET_OPEN : Math.min(0.5, SHEET_PEEK_PX / Math.max(viewport.height, 1)) },
    [isDesktop, viewport.width, viewport.height]
  );

  const atStorefront = Boolean(focused) && !leaving;
  const obstruction = atStorefront ? obstructionFor(sheetOpen) : NO_OBSTRUCTION;
  const shift = useMemo(() => frameShift(obstruction), [obstruction.right, obstruction.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  const parked = useMemo<CameraPose | null>(() => {
    if (mode === "home") return HOME_POSE;
    if (mode === "focused" && focused) return focusPose(focused, viewport, obstruction);
    return null;
    // `obstruction` is a fresh object each render; its two numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, focused, viewport, obstruction.right, obstruction.bottom]);

  // ── Flights ───────────────────────────────────────────────────────────────

  const handleFlightComplete = useCallback(() => {
    if (intentRef.current === "enter") {
      setMode("focused");
      return;
    }
    // Backing out: hand the camera to whichever mode we came from, and only
    // now clear the focus. Clearing it when the button was pressed would blank
    // the boards while the camera was still pulling away from them.
    setMode(originRef.current.mode);
    setFocusedSlug(null);
    setTurns([]);
    setLeaving(false);
    setActiveBoard(null);
  }, []);

  const flyTo = useCallback(
    (pose: CameraPose, intent: "enter" | "exit") => {
      intentRef.current = intent;
      if (!sceneOn) {
        // No camera to move. The destination is simply where we now are.
        handleFlightComplete();
        return;
      }
      setFlightTo(pose);
      setFlightKey((k) => k + 1);
      setMode("flying");
    },
    [sceneOn, handleFlightComplete]
  );

  // ── Asking ────────────────────────────────────────────────────────────────

  const enterRestaurantRef = useRef<(slug: string, options?: EnterOptions) => void>(() => {});

  const runTurn = useCallback(
    async (slug: string, turn: { said: string | null; action?: string; q: string; context: string | null }) => {
      const id = ++turnTicket.current;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setTurns((prev) => [...prev, { id, said: turn.said, action: turn.action, status: "loading" }]);

      let outcome;
      try {
        outcome = await requestSearch({ q: turn.q, restaurant: slug, context: turn.context }, controller.signal);
      } catch {
        return; // Aborted: a newer request has taken over.
      }
      // Requests can overtake each other. Only the newest may write.
      if (id !== turnTicket.current) return;

      if (!outcome.ok) {
        const { error } = outcome;
        setTurns((prev) =>
          prev.map((t) => (t.id === id ? { ...t, status: "error", error: { message: error.error, code: error.code } } : t))
        );
        return;
      }

      const { response } = outcome;

      // "what about taco bell" — said while standing somewhere else. Go there,
      // taking the question along as the first thing asked.
      if (response.restaurant.slug !== slug) {
        enterRestaurantRef.current(response.restaurant.slug, {
          seed: [{ id, said: turn.said, status: "ok", response }],
        });
        return;
      }

      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, status: "ok", response } : t)));
      // Keep the address bar pointing at exactly this search, without adding a
      // history entry per message.
      if (targetSlugRef.current === slug) {
        window.history.replaceState(null, "", urlFor(slug, response.criteria.canonical));
      }
    },
    []
  );

  interface EnterOptions {
    /** Turns to start the conversation with, when the answer is already in hand. */
    seed?: Turn[];
    /** A query to ask on arrival, when it isn't. */
    ask?: string;
    /** False when the URL already says so (back/forward). */
    push?: boolean;
  }

  const enterRestaurant = useCallback(
    (slug: string, options: EnterOptions = {}) => {
      const placement = bySlug(slug);
      if (!placement) return;

      // Hopping from one storefront to another keeps the original way out.
      const from = modeRef.current;
      if (from === "home" || from === "roam") {
        setBackLabel(from === "roam" ? "Street" : "Home");
        originRef.current = {
          mode: from,
          pose: {
            position: poseRef.current.position.clone(),
            target: poseRef.current.target.clone(),
            fov: poseRef.current.fov,
          },
        };
      }

      targetSlugRef.current = slug;
      setLeaving(false);
      setFocusedSlug(slug);
      setSheetOpen(true);
      setActiveBoard(null);
      setHomeError(null);

      if (options.seed) {
        turnTicket.current = Math.max(turnTicket.current, ...options.seed.map((t) => t.id));
        inFlight.current?.abort();
        setTurns(options.seed);
      } else {
        // Nothing asked yet: show what we'd order, so a storefront is never an
        // empty panel in front of blank windows.
        setTurns([]);
        void runTurn(slug, { said: options.ask || null, q: options.ask ?? "", context: null });
      }

      if (options.push !== false) {
        const canonical = options.seed?.at(-1)?.response?.criteria.canonical;
        window.history.pushState(null, "", urlFor(slug, canonical));
      }

      flyTo(focusPose(placement, viewport, obstructionFor(true)), "enter");
    },
    [bySlug, flyTo, obstructionFor, runTurn, viewport]
  );
  useEffect(() => {
    enterRestaurantRef.current = enterRestaurant;
  }, [enterRestaurant]);

  const leaveRestaurant = useCallback(
    (push = true) => {
      targetSlugRef.current = null;
      inFlight.current?.abort();
      setLeaving(true);
      if (push) window.history.pushState(null, "", "/");

      const origin = originRef.current;
      flyTo(origin.mode === "home" ? HOME_POSE : origin.pose, "exit");
    },
    [flyTo]
  );

  // ── The URL as a source of truth ──────────────────────────────────────────
  //
  // Our own navigation sets targetSlugRef *before* touching history, so by the
  // time this runs the two agree and nothing happens. They only disagree when
  // the browser moved us — back, forward — and then we follow.
  const pathname = usePathname();
  useEffect(() => {
    const inUrl = slugIn(pathname);
    if (inUrl === targetSlugRef.current) return;

    // Syncing React to an external system (browser history) is what effects
    // are for; the state changes below are the sync.
    if (inUrl && bySlug(inUrl)) {
      const q = new URLSearchParams(window.location.search).get("q") ?? "";
      enterRestaurant(inUrl, { ask: q, push: false });
    } else if (targetSlugRef.current) {
      leaveRestaurant(false);
    }
  }, [pathname, bySlug, enterRestaurant, leaveRestaurant]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleHomeSearch = useCallback(
    async (query: string) => {
      setHomeBusy(true);
      setHomeError(null);
      let outcome;
      try {
        outcome = await requestSearch({ q: query });
      } finally {
        setHomeBusy(false);
      }

      if (!outcome.ok) {
        const { error } = outcome;
        setHomeError({
          message: error.error,
          code: error.code,
          requested: "requested" in error ? error.requested : undefined,
        });
        return;
      }

      // The query named the restaurant *and* the criteria, so one call both
      // picks the destination and fills the boards. The answer is in hand
      // before the camera moves.
      const { response } = outcome;
      enterRestaurant(response.restaurant.slug, {
        seed: [{ id: ++turnTicket.current, said: query, status: "ok", response }],
      });
    },
    [enterRestaurant]
  );

  const settled = [...turns].reverse().find((t) => t.response)?.response;
  const busy = turns.at(-1)?.status === "loading";

  const handleSend = useCallback(
    (message: string) => {
      if (!focusedSlug) return;
      void runTurn(focusedSlug, { said: message, q: message, context: settled?.criteria.canonical ?? null });
    },
    [focusedSlug, runTurn, settled]
  );

  const handleRemoveChip = useCallback(
    (chip: CriteriaChip) => {
      if (!focusedSlug) return;
      // The server already worked out what the search is without this chip.
      void runTurn(focusedSlug, { said: null, action: `Removed: ${chip.label}`, q: chip.without, context: null });
    },
    [focusedSlug, runTurn]
  );

  const handleExplore = useCallback(() => {
    setHomeError(null);
    setMode("roam");
  }, []);

  const handleContextLost = useCallback(() => {
    setContextLost(true);
    // Whatever the camera was doing, it has stopped. Settle the state as if
    // the move had finished.
    if (modeRef.current === "flying") handleFlightComplete();
    else if (modeRef.current === "roam") setMode("home");
  }, [handleFlightComplete]);

  // ── What the windows show ─────────────────────────────────────────────────
  const boards = settled && settled.restaurant.slug === focusedSlug ? settled.results.slice(0, 3) : null;
  const boardMessage = !boards && busy ? "Checking the kitchen…" : "";

  const showHome = mode === "home" && !focusedSlug;
  const showPanel = Boolean(focusedRestaurant) && !leaving;

  return (
    <main className="fixed inset-0 overflow-hidden">
      {/* Always there, underneath: the loading state, and the fallback. */}
      <StaticStreet restaurants={restaurants} focusedSlug={showPanel ? focusedSlug : null} />

      {sceneOn && (
        <div className={`absolute inset-0 transition-opacity duration-700 ${sceneReady ? "opacity-100" : "opacity-0"}`}>
          <CityScene
            placements={placements}
            mode={mode}
            focusedSlug={focusedSlug}
            parked={parked}
            flightTo={flightTo}
            flightKey={flightKey}
            poseRef={poseRef}
            onFlightComplete={handleFlightComplete}
            onSelectRestaurant={enterRestaurant}
            results={boards}
            boardMessage={boardMessage}
            activeBoard={activeBoard}
            initialPose={parked ?? HOME_POSE}
            shift={shift}
            instant={reducedMotion}
            onContextLost={handleContextLost}
            onReady={() => setSceneReady(true)}
          />
        </div>
      )}

      {(webgl === "no" || contextLost) && (
        <p
          role="status"
          className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-ink/85 px-4 py-1.5 text-center text-xs font-semibold text-paper"
        >
          {contextLost ? "The 3D street stopped — showing the flat version." : "3D isn't available here — showing the flat version."}
        </p>
      )}

      {showHome && (
        <HomePanel
          restaurants={restaurants}
          busy={homeBusy}
          error={homeError}
          onSearch={handleHomeSearch}
          onVisit={(slug) => enterRestaurant(slug)}
          onExplore={handleExplore}
          canExplore={sceneOn}
        />
      )}

      {mode === "roam" && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <button
            type="button"
            onClick={() => setMode("home")}
            className="pointer-events-auto absolute left-4 top-4 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-hairline bg-paper/95 px-4 text-sm font-bold text-ink shadow-lg backdrop-blur-sm"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
              <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Home
          </button>
          <p className="absolute left-1/2 top-[4.5rem] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-ink/80 px-4 py-2 text-center text-sm font-semibold leading-snug text-paper backdrop-blur-sm min-[900px]:top-4">
            {coarsePointer
              ? "Use the pad to walk · drag to look · tap a restaurant"
              : "W A S D or arrow keys to walk · drag to look · click a restaurant"}
          </p>
          {coarsePointer && <Joystick />}
        </div>
      )}

      {showPanel && focusedRestaurant && (
        <StorefrontPanel
          restaurant={focusedRestaurant}
          turns={turns}
          busy={busy}
          onSend={handleSend}
          onRemoveChip={handleRemoveChip}
          onBack={() => leaveRestaurant()}
          backLabel={backLabel}
          onAttention={setActiveBoard}
          sheetOpen={sheetOpen}
          onToggleSheet={() => setSheetOpen((v) => !v)}
        />
      )}
    </main>
  );
}
