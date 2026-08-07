import type { OrderResult } from "@/lib/searchResult";

// Replaces FixedResults and ChipotleResults, which existed because the API used
// to answer in three different shapes. It answers in one now, so one component
// renders all of it — a fixed-menu meal and a Chipotle build differ only in
// whether their items carry a `group`.
//
// This is a stopgap for the UI revamp, not the destination: it exists so the
// site works against the new contract, and it surfaces the order labels, which
// the API has been returning and nothing has been showing.

// Circled number glyphs for ranked positions — a small visual detail that
// makes the ranking feel intentional rather than just a numbered list.
const ORDINALS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function NutritionChip({
  value,
  label,
  dark = false,
}: {
  value: string | number;
  label: string;
  dark?: boolean;
}) {
  return (
    <span
      className={`text-sm px-3 py-1.5 rounded-lg font-semibold ${
        dark ? "bg-orange-600 text-white" : "bg-orange-50 text-orange-900"
      }`}
    >
      {value} {label}
    </span>
  );
}

/** Build-your-own picks listed under their slot; fixed-menu items listed flat. */
function OrderContents({ result }: { result: OrderResult }) {
  if (result.kind === "meal") {
    return (
      <p className="font-semibold text-stone-900 leading-snug">
        {result.items.map((i) => i.name).join(" + ")}
      </p>
    );
  }

  // Preserve slot order as the API returned it, collapsing repeats into "2x".
  const groups: { name: string; picks: string[] }[] = [];
  for (const item of result.items) {
    const key = item.group ?? "";
    const existing = groups.find((g) => g.name === key);
    if (existing) existing.picks.push(item.name);
    else groups.push({ name: key, picks: [item.name] });
  }

  const summarise = (picks: string[]) => {
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, n]) => (n > 1 ? `${n}× ${name}` : name))
      .join(", ");
  };

  return (
    <div className="space-y-1">
      {groups.map((group) => (
        <div key={group.name} className="flex gap-2 text-sm leading-snug">
          <span className="text-stone-400 capitalize shrink-0 w-20">{group.name}</span>
          <span className="font-medium text-stone-900">{summarise(group.picks)}</span>
        </div>
      ))}
    </div>
  );
}

export default function OrderResults({
  results,
  accentColor,
}: {
  results: OrderResult[];
  accentColor: string;
}) {
  if (results.length === 0) {
    return (
      <p className="text-stone-500 text-sm">
        No orders matched that search. Try a wider calorie range.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result, idx) => (
        <div
          key={idx}
          className="bg-white rounded-xl border border-orange-100 px-5 py-4 shadow-md hover:shadow-2xl hover:-translate-y-1 transition-all anim-up"
          style={{ animationDelay: `${idx * 80}ms` }}
        >
          <div className="flex items-start gap-3">
            <span
              className="text-lg font-bold shrink-0 mt-0.5 leading-none"
              style={{ color: accentColor }}
            >
              {ORDINALS[idx] ?? `${idx + 1}.`}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: accentColor }}
                >
                  {result.label}
                </span>
                <span className="text-base font-bold text-stone-900 shrink-0">
                  ${result.total_price.toFixed(2)}
                </span>
              </div>

              <OrderContents result={result} />

              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <NutritionChip value={result.total_calories} label="cal" dark />
                <NutritionChip value={`${result.total_protein_g}g`} label="protein" />
                <NutritionChip value={`${result.total_carbs_g}g`} label="carbs" />
                <NutritionChip value={`${result.total_fat_g}g`} label="fat" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
