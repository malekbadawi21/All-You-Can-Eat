import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ── The review loop's camera ─────────────────────────────────────────────────
//
//   npm run dev            (in one terminal)
//   npm run screenshots    (in another)
//
// Walks the app the way a person would and saves what it sees to
// .screenshots/, at desktop (1440×900) and phone (390×844) sizes. The point is
// to *look at the pictures*: tests can say the DOM is right, only eyes can say
// the page is.
//
// It drives your installed Chrome rather than a downloaded browser, because
// the street is WebGL and should be judged on a real GPU, not on a software
// renderer. The street is generated from a seeded PRNG, so two runs produce
// the same picture and any difference between them is a change you made.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SCREENSHOT_DIR ?? ".screenshots";

const SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

type SizeName = keyof typeof SIZES;

async function settle(page: Page, ms = 2600) {
  // Camera flights last up to 2.3s; this waits one out.
  await page.waitForTimeout(ms);
}

async function shoot(page: Page, size: SizeName, name: string) {
  const file = join(OUT, `${size}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${file}`);
}

async function walk(browser: Browser, size: SizeName) {
  const context = await browser.newContext({
    viewport: SIZES[size],
    deviceScaleFactor: 2,
    hasTouch: size === "mobile",
    isMobile: size === "mobile",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  console.log(`\n${size} (${SIZES[size].width}×${SIZES[size].height})`);

  // 1 ── Home
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await settle(page, 2000);
  await shoot(page, size, "01-home");

  // 2 ── A search from home: the fly-in, caught mid-air and on arrival
  await page.getByRole("textbox").first().fill("high protein Chick-fil-A around 800 calories");
  await page.getByRole("button", { name: "Find food" }).click();
  await page.waitForTimeout(900);
  await shoot(page, size, "02-flight");
  await settle(page);
  await shoot(page, size, "03-storefront");

  // 3 ── Item-level detail
  await page.getByRole("button", { name: "Item-by-item breakdown" }).first().click();
  await page.waitForTimeout(400);
  await shoot(page, size, "04-breakdown");
  await page.getByRole("button", { name: "Hide the breakdown" }).first().click();

  // 4 ── Refinement keeps context
  const box = page.getByRole("textbox").first();
  await box.fill("under $12, no fries");
  await box.press("Enter");
  await settle(page, 1500);
  await shoot(page, size, "05-refined");

  // 5 ── A target that can't be met, said honestly
  await page.goto(`${BASE}/restaurant/raising-canes?q=around%20600%20cal`, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await settle(page, 2200);
  await shoot(page, size, "06-notice");

  // 6 ── Phone: the sheet tucked down to see the building
  if (size === "mobile") {
    await page.getByRole("button", { name: /Lower the panel/ }).click();
    await settle(page, 1200);
    await shoot(page, size, "07-sheet-lowered");
  }

  // 7 ── Build-your-own, opened from a link
  await page.goto(`${BASE}/restaurant/chipotle?q=high%20protein%2C%20under%20%2411`, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await settle(page, 2200);
  await shoot(page, size, "08-build");

  // 8 ── Back out, then walk the street
  await page.getByRole("button", { name: "Home" }).click();
  await settle(page);
  await page.getByRole("button", { name: "Walk the street" }).click();
  await settle(page, 1200);
  await shoot(page, size, "09-roam");

  // 9 ── An error on the home page
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.getByRole("textbox").first().fill("high protein wendys");
  await page.getByRole("button", { name: "Find food" }).click();
  await settle(page, 1200);
  await shoot(page, size, "10-unknown-restaurant");

  // 10 ── Not found
  await page.goto(`${BASE}/restaurant/nowhere`, { waitUntil: "networkidle" });
  await shoot(page, size, "11-not-found");

  await context.close();

  // 11 ── No WebGL at all: the same page with the 3D layer refused
  const flat = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 2 });
  await flat.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  const flatPage = await flat.newPage();
  await flatPage.goto(BASE, { waitUntil: "networkidle" });
  await flatPage.waitForTimeout(800);
  await shoot(flatPage, size, "12-no-webgl-home");
  await flatPage.goto(`${BASE}/restaurant/taco-bell?q=low%20carb`, { waitUntil: "networkidle" });
  await flatPage.waitForTimeout(800);
  await shoot(flatPage, size, "13-no-webgl-storefront");
  await flat.close();

  if (errors.length > 0) {
    console.log(`  ⚠ ${errors.length} console error(s):`);
    for (const e of [...new Set(errors)].slice(0, 8)) console.log(`    ${e.slice(0, 200)}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    // Your installed Chrome, so WebGL runs on the real GPU. Set
    // SCREENSHOT_CHANNEL=chromium to use Playwright's own browser instead.
    channel: process.env.SCREENSHOT_CHANNEL === "chromium" ? undefined : "chrome",
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });

  const only = process.argv[2] as SizeName | undefined;
  for (const size of Object.keys(SIZES) as SizeName[]) {
    if (!only || only === size) await walk(browser, size);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
