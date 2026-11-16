"use client";

import { useCallback, useRef, useState } from "react";
import type { SearchResponse, SearchError } from "@/lib/searchResult";

// ── Talking to /api/search ───────────────────────────────────────────────────
//
// The endpoint is stateless and its shape is fixed (see lib/searchResult.ts).
// Everything this hook adds is client-side: request sequencing, and turning
// the three possible outcomes — a result, the API's own typed failure, and a
// network failure that never reached the API — into one state to render from.

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: SearchResponse }
  | { status: "error"; message: string; code?: SearchError["code"]; available?: string[] };

/** Whether a payload is the API's typed error rather than a result. */
const isError = (data: unknown): data is SearchError =>
  typeof data === "object" && data !== null && "code" in data;

export function useSearch() {
  const [state, setState] = useState<SearchState>({ status: "idle" });

  // Requests can overtake each other — type fast, hit enter twice, and the
  // first response may land after the second. Only the newest is allowed to
  // write to state.
  const latest = useRef(0);

  const run = useCallback(async (query: string): Promise<SearchResponse | null> => {
    const trimmed = query.trim();
    if (!trimmed) return null;

    const ticket = ++latest.current;
    setState({ status: "loading" });

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (ticket !== latest.current) return null;

      if (isError(data)) {
        // Branch on `code`, never on the prose — the message is free to change.
        setState({
          status: "error",
          message: data.error,
          code: data.code,
          available: data.available,
        });
        return null;
      }

      setState({ status: "ok", data: data as SearchResponse });
      return data as SearchResponse;
    } catch {
      if (ticket !== latest.current) return null;
      setState({
        status: "error",
        message: "Couldn't reach the kitchen — check your connection and try again.",
      });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    // Bump the ticket so any in-flight request is ignored when it lands.
    latest.current++;
    setState({ status: "idle" });
  }, []);

  return { state, run, reset };
}
