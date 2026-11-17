import type { StorefrontIdentity, StreetRestaurant } from "@/lib/restaurants";

// ── The street, flat ─────────────────────────────────────────────────────────
//
// A drawing of the street in SVG and CSS. It does three jobs:
//
//   1. It is what you see while the 3D scene is still downloading, so the page
//      is never an empty blue rectangle.
//   2. It is what you see *instead* of the 3D scene when there is no WebGL, or
//      the GPU takes the context away.
//   3. It is in the server-rendered HTML, so the page has a picture before any
//      JavaScript has run.
//
// It is decoration (aria-hidden): the restaurants are listed, as links, in the
// panel in front of it. No component here has state or effects, so it can be
// rendered on the server.

const GLASS = "#BCD9E8";
const FRAME = "#4A3C33";

/** One storefront, drawn face-on. The same recognition cues as the 3D model:
 *  body colour, roofline, and a sign with the name. No logos. */
function FlatStorefront({ name, identity }: { name: string; identity: StorefrontIdentity }) {
  const { brand, trim, ink, roof } = identity;

  const roofShape = {
    hip: <polygon points="6,62 194,62 160,30 40,30" fill={trim} />,
    flat: <rect x="2" y="50" width="196" height="12" rx="2" fill={trim} />,
    gable: <polygon points="2,62 198,62 100,18" fill={trim} />,
    pagoda: (
      <>
        <polygon points="0,62 200,62 168,44 32,44" fill={trim} />
        <polygon points="36,44 164,44 140,24 60,24" fill={trim} />
      </>
    ),
    // The A-frame's roof is its whole building.
    aframe: <polygon points="-6,160 206,160 100,6" fill={brand} />,
  }[roof];

  return (
    <svg viewBox="0 0 200 160" className="h-full w-full overflow-visible" preserveAspectRatio="xMidYMax meet">
      {roof !== "aframe" && <rect x="10" y="60" width="180" height="100" fill={brand} />}
      {roofShape}

      {/* Sign */}
      <rect x="40" y={roof === "aframe" ? 70 : 68} width="120" height="24" rx="3" fill={roof === "aframe" ? trim : brand} stroke={trim} strokeWidth="3" />
      <text
        x="100"
        y={roof === "aframe" ? 87 : 85}
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill={roof === "aframe" ? brand : ink}
        style={{ fontFamily: "var(--font-baloo), sans-serif" }}
      >
        {name}
      </text>

      {/* Awning */}
      <rect x="30" y="100" width="140" height="6" fill={trim} />

      {/* Door, then three windows — the bays that hold the boards in 3D. */}
      <rect x="36" y="110" width="24" height="50" fill={FRAME} />
      <rect x="40" y="114" width="16" height="42" fill={GLASS} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={68 + i * 34} y="110" width="30" height="40" fill={FRAME} />
          <rect x={71 + i * 34} y="113" width="24" height="34" fill={GLASS} />
        </g>
      ))}
    </svg>
  );
}

export default function StaticStreet({
  restaurants,
  focusedSlug,
}: {
  restaurants: StreetRestaurant[];
  /** When set, that storefront is shown large; otherwise the whole row. */
  focusedSlug: string | null;
}) {
  const focused = focusedSlug ? restaurants.find((r) => r.slug === focusedSlug) : undefined;

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-[#B7DCEC]">
      {/* Haze toward the horizon, then pavement and road. */}
      <div className="absolute inset-x-0 top-0 h-[68%] bg-gradient-to-b from-[#B7DCEC] to-[#D6E6EC]" />
      <div className="absolute inset-x-0 bottom-0 h-[32%] bg-[#DED3C4]" />
      <div className="absolute inset-x-0 bottom-0 h-[14%] bg-[#9E958A]" />
      <div className="absolute inset-x-0 bottom-[14%] h-[1.2%] bg-[#C7BCAC]" />

      {/* A far skyline of plain blocks, the same drained colours as the 3D filler. */}
      <div className="absolute inset-x-0 bottom-[32%] flex h-[26%] items-end justify-center gap-[1.2%] opacity-70">
        {[62, 88, 54, 100, 70, 46, 92, 60, 78, 50, 96, 66, 84, 58].map((h, i) => (
          <div
            key={i}
            className="w-[6%] rounded-t-sm"
            style={{ height: `${h}%`, background: ["#C9BFB2", "#B4AA9E", "#D3C9BC", "#BCB3A6"][i % 4] }}
          />
        ))}
      </div>

      {focused ? (
        // One storefront, placed where the 3D camera would frame it: in the
        // space the panel leaves free.
        <div className="absolute inset-x-0 bottom-[30%] top-[6%] flex items-end justify-center px-6 min-[900px]:bottom-[14%] min-[900px]:right-[29rem] min-[900px]:top-[14%]">
          <div className="h-full max-h-[30rem] w-full max-w-[38rem]">
            <FlatStorefront name={focused.name} identity={focused.identity} />
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-[14%] flex h-[30%] items-end justify-center gap-[1.5%] px-[2%]">
          {restaurants.slice(0, 9).map((r) => (
            <div key={r.slug} className="h-full min-w-0 flex-1" style={{ maxWidth: "13rem" }}>
              <FlatStorefront name={r.name} identity={r.identity} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
