const NUTRIENT_LABELS: Record<string, string> = {
  protein_g: "Protein",
  fat_g: "Fat",
  carbs_g: "Carbs",
  calories: "Calories",
  sodium_mg: "Sodium",
};

interface Goal {
  nutrient: string;
  direction: "high" | "low";
}

export default function GoalChip({ goal }: { goal: Goal }) {
  const label = NUTRIENT_LABELS[goal.nutrient] ?? goal.nutrient;
  const isHigh = goal.direction === "high";

  return (
    <span
      className={`inline-flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold border ${
        isHigh
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-sky-50 text-sky-700 border-sky-200"
      }`}
    >
      {label} {isHigh ? "↑" : "↓"}
    </span>
  );
}
