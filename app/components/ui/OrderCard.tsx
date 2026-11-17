"use client";

import { useId, useState } from "react";
import type { Goal } from "@/lib/criteria";
import type { OrderItem, OrderResult } from "@/lib/searchResult";

// ── One order ────────────────────────────────────────────────────────────────
//
// The card is the real result. The board in the storefront window shows the
// same order, but as pixels on a texture: it can't be selected, read by a
// screen reader, or expanded. Everything that matters is here, in DOM.
//
// Two levels of detail. The face of the card answers "what is it and is it
// what I asked for": the items, the calories, the three macros, the price. One
// tap further is the full table — every item's own numbers — for anyone who
// wants to check the arithmetic or see where the sodium is coming from.

const SHAPE_NAMES: Record<OrderResult["shape"], string> = {
  classic: "Main + side",
  single: "No sides",
  stack: "Double up",
  build: "Built to order",
};

const money = (n: number) => `$${n.toFixed(2)}`;
const grams = (n: number) => `${Math.round(n)}g`;

function Stat({
  label,
  value,
  emphasised,
}: {
  label: string;
  value: string;
  /** True when this is a number the user asked about. */
  emphasised: boolean;
}) {
  return (
    <div className="flex flex-col items-start">
      <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd
        className={`tabular text-base leading-tight ${
          emphasised ? "font-extrabold text-ink" : "font-semibold text-ink"
        }`}
      >
        {value}
        {emphasised && <span className="sr-only"> (one of your goals)</span>}
      </dd>
    </div>
  );
}

function ItemLine({ item }: { item: OrderItem }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <span className="min-w-0">
        {item.quantity > 1 && (
          <span className="tabular mr-1.5 font-extrabold text-ink">{item.quantity}×</span>
        )}
        <span className="font-semibold text-ink">{item.name}</span>
        {item.group && (
          // The slot on build-your-own orders: "protein", "salsa". It reads as
          // a quiet label after the name rather than as a heading above it,
          // which keeps a nine-line burrito bowl from doubling in height.
          <span className="ml-1.5 text-xs font-medium text-ink-soft">{item.group}</span>
        )}
      </span>
      <span className="tabular shrink-0 text-sm text-ink-soft">
        {item.calories * item.quantity} cal
      </span>
    </li>
  );
}

function DetailTable({ result }: { result: OrderResult }) {
  const hasPrices = result.total_price !== null;
  const cell = "px-2 py-1.5 text-right tabular";

  return (
    <div className="quiet-scroll overflow-x-auto">
      <table className="w-full min-w-[26rem] border-collapse text-sm">
        <caption className="sr-only">
          Nutrition for each item in this order. Amounts are for the quantity shown.
        </caption>
        <thead>
          <tr className="text-[0.7rem] uppercase tracking-wide text-ink-soft">
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">Item</th>
            <th scope="col" className={`${cell} font-semibold`}>Cal</th>
            <th scope="col" className={`${cell} font-semibold`}>Protein</th>
            <th scope="col" className={`${cell} font-semibold`}>Carbs</th>
            <th scope="col" className={`${cell} font-semibold`}>Fat</th>
            <th scope="col" className={`${cell} font-semibold`}>Sodium</th>
            {hasPrices && <th scope="col" className={`${cell} font-semibold`}>Price</th>}
          </tr>
        </thead>
        <tbody>
          {result.items.map((item, i) => (
            <tr key={`${item.id}-${i}`} className="border-t border-hairline">
              <th scope="row" className="px-2 py-1.5 text-left font-medium text-ink">
                {item.quantity > 1 ? `${item.quantity}× ` : ""}
                {item.name}
              </th>
              <td className={cell}>{item.calories * item.quantity}</td>
              <td className={cell}>{grams(item.protein_g * item.quantity)}</td>
              <td className={cell}>{grams(item.carbs_g * item.quantity)}</td>
              <td className={cell}>{grams(item.fat_g * item.quantity)}</td>
              <td className={cell}>{item.sodium_mg * item.quantity}mg</td>
              {hasPrices && (
                <td className={cell}>
                  {item.price === null ? "—" : item.price === 0 ? "incl." : money(item.price * item.quantity)}
                  {item.price_estimated && <span title="Estimated"> *</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink/30 font-bold text-ink">
            <th scope="row" className="px-2 py-1.5 text-left">Total</th>
            <td className={cell}>{result.total_calories}</td>
            <td className={cell}>{grams(result.total_protein_g)}</td>
            <td className={cell}>{grams(result.total_carbs_g)}</td>
            <td className={cell}>{grams(result.total_fat_g)}</td>
            <td className={cell}>{result.total_sodium_mg}mg</td>
            {hasPrices && <td className={cell}>~{money(result.total_price!)}</td>}
          </tr>
        </tfoot>
      </table>
      {result.price_estimated && (
        <p className="mt-1.5 px-2 text-xs text-ink-soft">
          * No source publishes this price; it is an estimate.
        </p>
      )}
    </div>
  );
}

export interface OrderCardProps {
  result: OrderResult;
  /** The goals in force, so the numbers that were asked about stand out. */
  goals: Goal[];
  /** 1–3 when this order is also showing in a storefront window. */
  windowNumber?: number;
  /** Tells the scene which window to light up while this card has attention. */
  onAttention?: (active: boolean) => void;
}

export default function OrderCard({ result, goals, windowNumber, onAttention }: OrderCardProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const detailId = useId();

  const wants = (nutrient: Goal["nutrient"]) => goals.some((g) => g.nutrient === nutrient);
  const isBest = result.label === "Best match" || result.label === "Closest match";

  return (
    <article
      aria-labelledby={titleId}
      className="rise rounded-2xl border border-hairline bg-card px-4 pb-1.5 pt-4 shadow-[0_1px_0_rgb(42_35_30/0.04)]"
      onPointerEnter={() => onAttention?.(true)}
      onPointerLeave={() => onAttention?.(false)}
      onFocus={() => onAttention?.(true)}
      onBlur={() => onAttention?.(false)}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3
          id={titleId}
          className={`rounded-full px-3 py-0.5 text-sm font-bold ${
            isBest ? "bg-brand text-brand-ink" : "bg-sunk text-ink"
          }`}
        >
          {result.label}
        </h3>
        {/* What the order *is*, where the label doesn't already say so. */}
        {SHAPE_NAMES[result.shape] !== result.label && result.kind === "meal" && (
          <span className="text-xs font-medium text-ink-soft">{SHAPE_NAMES[result.shape]}</span>
        )}
        {windowNumber && (
          <span className="ml-auto hidden text-xs font-medium text-ink-soft min-[900px]:inline">
            Window {windowNumber}
          </span>
        )}
      </header>

      <ul className="mb-3">
        {result.items.map((item, i) => (
          <ItemLine key={`${item.id}-${i}`} item={item} />
        ))}
      </ul>

      <dl className="flex items-end gap-5 border-t border-hairline pt-3">
        <div className="mr-auto flex flex-col">
          <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
            Calories
          </dt>
          <dd className="tabular text-3xl font-extrabold leading-none text-ink">
            {result.total_calories}
          </dd>
        </div>
        <Stat label="Protein" value={grams(result.total_protein_g)} emphasised={wants("protein_g")} />
        <Stat label="Carbs" value={grams(result.total_carbs_g)} emphasised={wants("carbs_g")} />
        <Stat label="Fat" value={grams(result.total_fat_g)} emphasised={wants("fat_g")} />
        {result.total_price !== null && (
          <div className="flex flex-col items-end">
            <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
              About
            </dt>
            <dd className="tabular text-base font-semibold leading-tight text-ink">
              {money(result.total_price)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {open ? "Hide the breakdown" : "Item-by-item breakdown"}
        </button>
        <div id={detailId} hidden={!open} className="mb-2.5 mt-1">
          {open && <DetailTable result={result} />}
        </div>
      </div>
    </article>
  );
}
