// Circled number glyphs for ranked positions — a small visual detail that
// makes the ranking feel intentional rather than just a numbered list.
const ORDINALS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

export interface RankedItem {
  id: number;
  name: string;
  category: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  price: number;
}

export interface MealCombo {
  items: RankedItem[];
  total_calories: number;
  total_protein_g: number;
  total_fat_g: number;
  total_carbs_g: number;
  total_price: number;
}

interface Props {
  recommendations?: MealCombo[];
  topResults?: RankedItem[];
  accentColor: string;
}

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

export default function FixedResults({ recommendations, topResults, accentColor }: Props) {
  // ── Calorie-target mode: ranked meal combinations ──────────────────────────
  if (recommendations && recommendations.length > 0) {
    return (
      <div className="space-y-3">
        {recommendations.map((combo, idx) => (
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
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-stone-900 leading-snug">
                    {combo.items.map((i) => i.name).join(" + ")}
                  </p>
                  <span className="text-base font-bold text-stone-900 shrink-0">
                    ${combo.total_price.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <NutritionChip value={combo.total_calories} label="cal" dark />
                  <NutritionChip value={`${combo.total_protein_g}g`} label="protein" />
                  <NutritionChip value={`${combo.total_carbs_g}g`} label="carbs" />
                  <NutritionChip value={`${combo.total_fat_g}g`} label="fat" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── No calorie target: ranked individual items ─────────────────────────────
  if (topResults && topResults.length > 0) {
    return (
      <div className="space-y-2.5">
        {topResults.map((item, idx) => (
          <div
            key={item.id}
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
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-stone-900">{item.name}</p>
                    <span className="text-xs px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full capitalize">
                      {item.category}
                    </span>
                  </div>
                  <span className="text-base font-bold text-stone-900 shrink-0">
                    ${item.price.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <NutritionChip value={item.calories} label="cal" dark />
                  <NutritionChip value={`${item.protein_g}g`} label="protein" />
                  <NutritionChip value={`${item.carbs_g}g`} label="carbs" />
                  <NutritionChip value={`${item.fat_g}g`} label="fat" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <p className="text-stone-500 text-sm">No results found. Try a different query.</p>
  );
}
