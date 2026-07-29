// Maps the raw slot_name from the API to something display-friendly.
const SLOT_LABELS: Record<string, string> = {
  base: "Format",
  protein: "Protein",
  rice: "Rice",
  beans: "Beans",
  toppings: "Toppings",
  salsa: "Salsa",
};

interface SelectedComponent {
  id: number;
  name: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  price: number;
}

interface SlotResult {
  slot_name: string;
  selected: SelectedComponent[];
}

export interface ChipotleOption {
  label: string;
  total_price: number;
  order: SlotResult[];
}

interface Props {
  options: ChipotleOption[];
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

export default function ChipotleResults({ options, accentColor }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {options.map((option, idx) => {
        const totalCal = option.order.reduce(
          (sum, slot) => sum + slot.selected.reduce((s, o) => s + o.calories, 0),
          0
        );
        const totalPro = option.order.reduce(
          (sum, slot) => sum + slot.selected.reduce((s, o) => s + o.protein_g, 0),
          0
        );
        const totalCarbs = option.order.reduce(
          (sum, slot) => sum + slot.selected.reduce((s, o) => s + o.carbs_g, 0),
          0
        );
        const totalFat = option.order.reduce(
          (sum, slot) => sum + slot.selected.reduce((s, o) => s + o.fat_g, 0),
          0
        );

        const isValue = idx === 1;
        const savings =
          isValue && options.length > 1
            ? (options[0].total_price - option.total_price).toFixed(2)
            : null;

        return (
          <div
            key={option.label}
            className="bg-white rounded-2xl border border-orange-100 overflow-hidden shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all flex flex-col anim-up"
            style={{ animationDelay: `${idx * 150}ms` }}
          >
            {/* Colored top stripe — uses the restaurant's brand color */}
            <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: accentColor }} />

            {/* Header */}
            <div className="px-5 pt-4 pb-3 border-b border-stone-100 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                  {isValue ? "Best Value" : "Best Match"}
                </p>
                <p className="text-2xl font-extrabold text-stone-900 mt-0.5">
                  ${option.total_price.toFixed(2)}
                </p>
              </div>
              {savings && parseFloat(savings) > 0 && (
                <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full shrink-0 mt-1">
                  Saves ${savings}
                </span>
              )}
            </div>

            {/* Slot-by-slot breakdown */}
            <div className="px-5 py-4 space-y-2.5 flex-1">
              {option.order
                .filter((slot) => slot.selected.length > 0)
                .map((slot) => (
                  <div key={slot.slot_name} className="flex gap-3 text-sm">
                    <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-400 pt-0.5">
                      {SLOT_LABELS[slot.slot_name] ?? slot.slot_name}
                    </span>
                    <span className="text-stone-700 leading-snug">
                      {slot.selected.map((o) => o.name).join(", ")}
                    </span>
                  </div>
                ))}
            </div>

            {/* Nutrition summary */}
            <div className="px-5 pb-5 flex flex-wrap gap-1.5">
              <NutritionChip value={Math.round(totalCal)} label="cal" dark />
              <NutritionChip value={`${totalPro.toFixed(0)}g`} label="protein" />
              <NutritionChip value={`${totalCarbs.toFixed(0)}g`} label="carbs" />
              <NutritionChip value={`${totalFat.toFixed(0)}g`} label="fat" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
