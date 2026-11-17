"use client";

import { useId, useState, type FormEvent } from "react";

// ── The text box ─────────────────────────────────────────────────────────────
//
// Used twice: the big one on the home page, and the message box at the bottom
// of a storefront conversation. Text input stays out of the 3D layer on
// purpose — a real <input> can be tabbed to, styled, read by a screen reader,
// and will raise the keyboard on a phone. The same field expressed as geometry
// does none of those things.

export interface SearchFieldProps {
  /** Read aloud by screen readers; also the accessible name of the form. */
  label: string;
  placeholder: string;
  /** What the button says: "Find food", "Send". */
  action: string;
  busy: boolean;
  onSubmit: (text: string) => void;
  /** Keep the text after submitting (home) or clear it for the next message (chat). */
  clearOnSubmit?: boolean;
  size?: "large" | "compact";
  /** Lets a parent fill the box — clicking an example query. */
  value?: string;
  onChange?: (text: string) => void;
}

export default function SearchField({
  label,
  placeholder,
  action,
  busy,
  onSubmit,
  clearOnSubmit = false,
  size = "compact",
  value,
  onChange,
}: SearchFieldProps) {
  const [own, setOwn] = useState("");
  const id = useId();

  // Controlled if the parent passes a value, self-managed otherwise.
  const text = value ?? own;
  const setText = (next: string) => (onChange ? onChange(next) : setOwn(next));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    if (clearOnSubmit) setText("");
  }

  const large = size === "large";

  return (
    <form onSubmit={handleSubmit} role="search" aria-label={label} className="w-full">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        className={`field flex items-center gap-2 border border-hairline bg-card ${
          large ? "rounded-2xl p-1.5 shadow-lg" : "rounded-xl p-1"
        }`}
      >
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          maxLength={200}
          autoComplete="off"
          enterKeyHint={large ? "search" : "send"}
          className={`min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-soft/80 ${
            large ? "px-4 py-3 text-lg" : "px-3 py-2 text-base"
          }`}
          // The canvas listens for WASD to drive the camera. Without this,
          // typing "waffle" would walk you down the street.
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          type="submit"
          // aria-disabled rather than disabled: a disabled button drops out of
          // the tab order, so a keyboard user can't discover what it would do.
          aria-disabled={busy || !text.trim()}
          // Unavailable reads as plainly neutral, not as a faded version of the
          // brand colour — a washed-out button looks broken rather than waiting.
          className={`shrink-0 rounded-xl bg-brand font-bold text-brand-ink transition-[transform,background-color] active:scale-[0.97] aria-disabled:cursor-default aria-disabled:bg-sunk aria-disabled:text-ink-soft aria-disabled:active:scale-100 ${
            large ? "min-h-12 px-6 text-base" : "min-h-11 px-4 text-sm"
          }`}
        >
          {busy ? (
            <span className="thinking" aria-label="Searching">
              <span>•</span>
              <span>•</span>
              <span>•</span>
            </span>
          ) : (
            action
          )}
        </button>
      </div>
    </form>
  );
}
