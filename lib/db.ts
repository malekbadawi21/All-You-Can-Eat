import Database from "better-sqlite3";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var __restaurantDb: Database.Database | undefined;
}

function getDb(): Database.Database {
  if (!global.__restaurantDb) {
    const db = new Database(path.join(process.cwd(), "data", "restaurant.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    seedIfEmpty(db);
    global.__restaurantDb = db;
  }
  return global.__restaurantDb;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface RestaurantInfo {
  id: number;
  name: string;
  slug: string;
  type: "fixed" | "build-your-own";
}

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  price: number; // USD — approximate, varies by market
}

export interface ComponentOption {
  id: number;
  name: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  // For the base slot this is the full meal starting price.
  // For all other slots this is the extra charge on top of that base.
  price: number;
  // When set, picking this option fixes how many items one or more other
  // slots must pick — keyed by slot_name (e.g. Panda's "Bowl" option sets
  // { entree: 1 }; Cane's "Caniac Combo" option could set { side: 3 } if it
  // had more than one slot depending on it).
  pick_counts?: Record<string, number>;
}

export interface Slot {
  slot_name: string;
  required: boolean;
  pick: string;
  options: ComponentOption[];
  // Name of another slot in the same restaurant whose selected option's
  // pick_counts[this slot's name] dictates exactly how many items this slot
  // must pick.
  count_from?: string;
}

// ── Public query functions ────────────────────────────────────────────────────

export function getRestaurant(slug: string): RestaurantInfo | undefined {
  return getDb()
    .prepare("SELECT * FROM restaurants WHERE slug = ?")
    .get(slug) as RestaurantInfo | undefined;
}

export function getAllRestaurants(): RestaurantInfo[] {
  return getDb()
    .prepare("SELECT * FROM restaurants ORDER BY name")
    .all() as RestaurantInfo[];
}

export function getMenuItems(restaurantId: number): MenuItem[] {
  return getDb()
    .prepare(
      `SELECT id, name, category, calories, protein_g, fat_g, carbs_g, sodium_mg, price
       FROM menu_items
       WHERE restaurant_id = ?
       ORDER BY category, name`
    )
    .all(restaurantId) as MenuItem[];
}

export function getSlots(restaurantId: number): Slot[] {
  const db = getDb();
  const slotRows = db
    .prepare(
      "SELECT * FROM component_slots WHERE restaurant_id = ? ORDER BY id"
    )
    .all(restaurantId) as {
    id: number;
    slot_name: string;
    required: number;
    pick: string;
    count_from: string | null;
  }[];

  return slotRows.map((slot) => ({
    slot_name: slot.slot_name,
    required: slot.required === 1,
    pick: slot.pick,
    ...(slot.count_from ? { count_from: slot.count_from } : {}),
    options: (
      db
        .prepare(
          `SELECT id, name, calories, protein_g, fat_g, carbs_g, sodium_mg, price, pick_counts
           FROM components
           WHERE slot_id = ?
           ORDER BY name`
        )
        .all(slot.id) as (ComponentOption & { pick_counts: string | null })[]
    ).map((o) => ({
      ...o,
      pick_counts: o.pick_counts ? JSON.parse(o.pick_counts) : undefined,
    })),
  }));
}

// ── Schema ────────────────────────────────────────────────────────────────────

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL,
      slug TEXT    NOT NULL UNIQUE,
      type TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
      name          TEXT    NOT NULL,
      category      TEXT    NOT NULL,
      calories      INTEGER NOT NULL,
      protein_g     REAL    NOT NULL,
      fat_g         REAL    NOT NULL,
      carbs_g       REAL    NOT NULL,
      sodium_mg     INTEGER NOT NULL,
      price         REAL    NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS component_slots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
      slot_name     TEXT    NOT NULL,
      required      INTEGER NOT NULL DEFAULT 0,
      pick          TEXT    NOT NULL,
      count_from    TEXT
    );

    CREATE TABLE IF NOT EXISTS components (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id    INTEGER NOT NULL REFERENCES component_slots(id),
      name       TEXT    NOT NULL,
      calories   INTEGER NOT NULL,
      protein_g  REAL    NOT NULL,
      fat_g      REAL    NOT NULL,
      carbs_g    REAL    NOT NULL,
      sodium_mg  INTEGER NOT NULL,
      price      REAL    NOT NULL DEFAULT 0,
      pick_counts TEXT
    );
  `);
}

// ── Seed data ─────────────────────────────────────────────────────────────────
// Nutrition from official restaurant nutrition pages.
//
// PRICES — US national averages, audited August 2026.
//
// Read these as estimates, not quotes. Fast food pricing varies by market by
// well over a dollar (Chipotle chicken bowls range roughly $7.81–$12.70 across
// locations), and airport and delivery menus are higher again. Anything the UI
// says about price should be presented as approximate.
//
// The audit corrected three things that were changing what the optimizer
// recommended, not just what it displayed:
//
//   1. Chipotle bases were priced unequally — Salad $1.00 under Bowl. Bowls,
//      burritos, salads and tacos all cost the same for a given protein, and
//      because Bowl and Salad are nutritionally identical here (both 0/0/0),
//      that phantom dollar decided every tie. Chipotle results were *always*
//      salads and a Bowl could never be recommended.
//
//   2. Chipotle proteins were all $0.00, so steak, barbacoa and carnitas looked
//      like free upgrades over chicken. They carry real upcharges (+$1.89,
//      +$1.89, +$0.74), which matters most for "cheapest" queries — exactly the
//      queries where being wrong is most visible.
//
//   3. Panda and Cane's headline prices were $0.70–$2.70 high across the board.
//
// Sources disagree, especially for Raising Cane's, where combo prices differ by
// about $1.40 between aggregators; those use midpoints. The Cane's Sandwich
// Combo is an ESTIMATE — no source consulted published it.
//
// This is the shape of the problem the project's pricing goal has to solve
// properly: prices need a source, a market and a fetch date stored alongside
// them, so staleness is visible rather than assumed. Hardcoding a national
// average is a placeholder for that, not a solution to it.

// [name, category, cal, protein, fat, carbs, sodium, price]
type ItemRow = [string, string, number, number, number, number, number, number];

// [name, cal, protein, fat, carbs, sodium, price]
type ComponentRow = [string, number, number, number, number, number, number];

function seedIfEmpty(db: Database.Database): void {
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM restaurants")
    .get() as { count: number };
  if (count > 0) return;

  const addRestaurant = db.prepare(
    "INSERT INTO restaurants (name, slug, type) VALUES (?, ?, ?)"
  );
  const addItem = db.prepare(
    `INSERT INTO menu_items
       (restaurant_id, name, category, calories, protein_g, fat_g, carbs_g, sodium_mg, price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const addSlot = db.prepare(
    `INSERT INTO component_slots (restaurant_id, slot_name, required, pick, count_from)
     VALUES (?, ?, ?, ?, ?)`
  );
  const addComponent = db.prepare(
    `INSERT INTO components (slot_id, name, calories, protein_g, fat_g, carbs_g, sodium_mg, price, pick_counts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    // ── Chick-fil-A ──────────────────────────────────────────────────────────
    const cfaId = addRestaurant.run("Chick-fil-A", "chick-fil-a", "fixed")
      .lastInsertRowid;

    const cfaItems: ItemRow[] = [
      // Breakfast
      ["Chicken Biscuit",                "breakfast", 440, 19, 20, 48, 1070, 3.99],
      ["Spicy Chicken Biscuit",          "breakfast", 450, 19, 20, 49, 1090, 4.09],
      ["Bacon, Egg & Cheese Biscuit",    "breakfast", 460, 20, 22, 45, 1120, 4.45],
      ["Sausage, Egg & Cheese Biscuit",  "breakfast", 610, 21, 37, 46, 1290, 4.99],
      ["Egg White Grill",                "breakfast", 290, 26,  7, 30,  970, 4.65],
      ["Greek Yogurt Parfait",           "breakfast", 230, 14,  5, 34,   90, 3.35],
      ["Hash Browns",                    "breakfast", 270,  3, 14, 35,  560, 1.39],
      // Sandwiches
      ["Chick-fil-A Chicken Sandwich",   "sandwich",  440, 28, 19, 40, 1350, 5.45],
      ["Chick-fil-A Deluxe Sandwich",    "sandwich",  490, 30, 22, 41, 1390, 6.35],
      ["Spicy Chicken Sandwich",         "sandwich",  450, 28, 19, 41, 1370, 5.55],
      ["Spicy Deluxe Sandwich",          "sandwich",  550, 31, 26, 49, 1540, 6.15],
      ["Grilled Chicken Sandwich",       "sandwich",  320, 29,  6, 36,  800, 5.75],
      ["Grilled Chicken Club Sandwich",  "sandwich",  430, 38, 15, 37, 1140, 7.35],
      ["Grilled Cool Wrap",              "wrap",      350, 42, 13, 29, 1070, 8.25],
      // Nuggets & Strips
      ["Chick-fil-A Nuggets (8 ct)",     "entree",    260, 26, 12, 11, 1010, 4.95],
      ["Chick-fil-A Nuggets (12 ct)",    "entree",    390, 38, 18, 17, 1460, 6.85],
      ["Grilled Nuggets (8 ct)",         "entree",    140, 25,  4,  2,  500, 5.35],
      ["Grilled Nuggets (12 ct)",        "entree",    200, 38,  5,  2,  740, 7.09],
      ["Chick-n-Strips (3 ct)",          "entree",    310, 23, 14, 24,  800, 6.35],
      ["Chick-n-Strips (4 ct)",          "entree",    400, 30, 18, 31, 1080, 8.19],
      // Salads (no dressing)
      ["Cobb Salad — Grilled Chicken",           "salad", 430, 38, 22, 18, 1010, 10.25],
      ["Spicy Southwest Salad — Grilled Chicken","salad", 400, 30, 19, 30,  950, 10.25],
      ["Market Salad",                           "salad", 340, 28, 13, 26,  700, 10.25],
      ["Side Salad",                             "salad",  80,  5,  5,  7,  150,  3.75],
      // Sides
      ["Waffle Potato Fries (Small)",  "side", 310, 4, 15, 41, 200, 2.49],
      ["Waffle Potato Fries (Medium)", "side", 420, 5, 21, 52, 280, 3.09],
      ["Waffle Potato Fries (Large)",  "side", 530, 7, 26, 66, 390, 3.49],
      ["Mac & Cheese (Small)",         "side", 300, 11, 14, 35, 660, 2.99],
      ["Mac & Cheese (Medium)",        "side", 450, 15, 20, 54, 920, 3.79],
      ["Fruit Cup (Small)",            "side",  45,  0,  0, 11,   0, 2.15],
      ["Fruit Cup (Medium)",           "side",  70,  1,  0, 18,   0, 2.65],
      ["Kale Crunch Side",             "side", 120,  2,  9, 10, 160, 2.65],
      // Desserts
      ["Chocolate Chunk Cookie",       "dessert", 360,  4, 17, 50, 310, 1.79],
      ["Chocolate Fudge Brownie",      "dessert", 370,  3, 19, 50, 210, 2.09],
      ["Vanilla Milkshake (Small)",    "dessert", 590, 13, 24, 83, 300, 4.45],
      ["Chocolate Milkshake (Small)",  "dessert", 570, 13, 24, 77, 270, 4.45],
      ["Strawberry Milkshake (Small)", "dessert", 670, 13, 26, 99, 340, 4.45],
      ["Icedream Cone",                "dessert", 170,  4,  4, 28,  90, 1.55],
    ];

    for (const [name, cat, cal, pro, fat, carbs, sodium, price] of cfaItems) {
      addItem.run(cfaId, name, cat, cal, pro, fat, carbs, sodium, price);
    }

    // ── McDonald's ────────────────────────────────────────────────────────────
    const mcdId = addRestaurant.run("McDonald's", "mcdonalds", "fixed")
      .lastInsertRowid;

    const mcdItems: ItemRow[] = [
      // Burgers
      ["Hamburger",                           "burger",    250, 13,  9, 31,  510, 1.69],
      ["Cheeseburger",                        "burger",    300, 15, 13, 32,  680, 1.99],
      ["McDouble",                            "burger",    400, 22, 20, 34,  840, 3.49],
      ["Double Cheeseburger",                 "burger",    450, 25, 24, 34, 1050, 3.99],
      ["Big Mac",                             "burger",    550, 25, 30, 46, 1010, 5.99],
      ["Quarter Pounder with Cheese",         "burger",    530, 30, 27, 42, 1090, 6.79],
      ["Double Quarter Pounder with Cheese",  "burger",    740, 48, 42, 43, 1360, 8.39],
      // Chicken & Fish
      ["McChicken",                    "sandwich",  400, 14, 22, 39,  590, 2.49],
      ["Crispy Chicken Sandwich",      "sandwich",  530, 27, 26, 49, 1200, 5.99],
      ["Deluxe Crispy Chicken Sandwich","sandwich", 530, 27, 26, 50, 1210, 6.49],
      ["Filet-O-Fish",                 "sandwich",  390, 17, 19, 38,  580, 5.69],
      // Nuggets
      ["Chicken McNuggets (4 pc)",  "entree", 170,  9, 10, 10,  310, 2.19],
      ["Chicken McNuggets (6 pc)",  "entree", 250, 14, 15, 15,  470, 3.79],
      ["Chicken McNuggets (10 pc)", "entree", 420, 23, 25, 25,  770, 5.69],
      ["Chicken McNuggets (20 pc)", "entree", 830, 45, 49, 50, 1560, 10.49],
      // Breakfast
      ["Egg McMuffin",                     "breakfast", 310, 17, 13, 30,  740, 4.99],
      ["Sausage McMuffin",                 "breakfast", 400, 14, 23, 30,  730, 2.39],
      ["Sausage McMuffin with Egg",        "breakfast", 480, 21, 28, 30,  870, 4.49],
      ["Sausage McGriddle",                "breakfast", 430, 12, 21, 48, 1030, 3.59],
      ["Sausage, Egg & Cheese McGriddle",  "breakfast", 550, 20, 29, 48, 1290, 5.29],
      ["Bacon, Egg & Cheese Biscuit",      "breakfast", 460, 19, 26, 39, 1280, 5.49],
      ["Sausage Biscuit",                  "breakfast", 430, 10, 26, 36, 1010, 2.19],
      ["Hotcakes (3 ct)",                  "breakfast", 350,  8,  9, 61,  590, 3.49],
      ["Hash Browns",                      "breakfast", 150,  1,  9, 15,  310, 1.89],
      // Sides & Salads
      ["World Famous Fries (Small)",  "side",  230, 3, 11, 30, 180, 1.89],
      ["World Famous Fries (Medium)", "side",  320, 4, 15, 43, 400, 3.19],
      ["World Famous Fries (Large)",  "side",  490, 7, 23, 65, 580, 4.09],
      ["Side Salad",                  "salad",  15, 1,  0,  3,  10, 1.99],
      ["Apple Slices",                "side",   15, 0,  0,  4,   0, 0.99],
      // Desserts
      ["Baked Apple Pie",                      "dessert", 240,  2, 11,  33,  95, 1.29],
      ["McFlurry with Oreo Cookies (Regular)", "dessert", 510, 13, 17,  79, 280, 4.29],
      ["McFlurry with M&M's (Regular)",        "dessert", 660, 14, 23, 102, 270, 4.29],
      ["Vanilla Soft Serve Cone",              "dessert", 200,  5,  5,  34, 140, 1.29],
      ["Chocolate Shake (Medium)",             "dessert", 630, 15, 17, 107, 260, 3.99],
      ["Vanilla Shake (Medium)",               "dessert", 570, 14, 14,  97, 260, 3.99],
      ["Strawberry Shake (Medium)",            "dessert", 620, 14, 14, 105, 250, 3.99],
    ];

    for (const [name, cat, cal, pro, fat, carbs, sodium, price] of mcdItems) {
      addItem.run(mcdId, name, cat, cal, pro, fat, carbs, sodium, price);
    }

    // ── Chipotle ──────────────────────────────────────────────────────────────
    const chipotleId = addRestaurant.run("Chipotle", "chipotle", "build-your-own")
      .lastInsertRowid;

    const chipotleSlots: {
      name: string;
      required: number;
      pick: string;
      components: ComponentRow[];
    }[] = [
      {
        name: "base",
        required: 1,
        pick: "1",
        // Price here is the full meal starting price (bowl/burrito/etc.)
        components: [
          ["Bowl",                        0, 0, 0,  0,   0, 9.79],
          ["Burrito (Flour Tortilla)",   320, 8, 9, 51, 680, 9.79],
          ["Salad",                        0, 0, 0,  0,   0,  9.79],
          ["Tacos — Soft Flour (3)",     270, 6, 6, 45, 480, 9.79],
          ["Tacos — Crispy Corn (3)",    180, 3, 3, 33,  30, 9.79],
        ],
      },
      {
        name: "protein",
        required: 1,
        pick: "1",
        // Standard proteins are included in the base price.
        // Double portions cost extra and provide 2× nutrition.
        components: [
          ["Chicken",          180, 32,  7,  1, 310, 0.00],
          ["Steak",            150, 21,  7,  1, 290, 1.89],
          ["Barbacoa",         165, 24,  7,  2, 460, 1.89],
          ["Carnitas",         200, 23, 12,  0, 430, 0.74],
          ["Sofritas",         145,  8, 10,  9, 480, 0.00],
          ["Chicken (Double)", 360, 64, 14,  2, 620, 4.60],
          ["Steak (Double)",   300, 42, 14,  2, 580, 6.49],
          ["Barbacoa (Double)",330, 48, 14,  4, 920, 6.49],
          ["Carnitas (Double)",400, 46, 24,  0, 860, 5.34],
          ["Sofritas (Double)",290, 16, 20, 18, 960, 4.60],
        ],
      },
      {
        name: "rice",
        required: 0,
        pick: "1",
        components: [
          ["White Rice",          210,  4, 4, 40, 400, 0.00],
          ["Brown Rice",          210,  5, 4, 40, 210, 0.00],
          ["White Rice (Double)", 420,  8, 8, 80, 800, 0.00],
          ["Brown Rice (Double)", 420, 10, 8, 80, 420, 0.00],
        ],
      },
      {
        name: "beans",
        required: 0,
        pick: "1",
        components: [
          ["Black Beans",          130,  8, 1, 22, 210, 0.00],
          ["Pinto Beans",          130,  8, 1, 22, 320, 0.00],
          ["Black Beans (Double)", 260, 16, 2, 44, 420, 0.00],
          ["Pinto Beans (Double)", 260, 16, 2, 44, 640, 0.00],
        ],
      },
      {
        name: "toppings",
        required: 0,
        pick: "many",
        // Guacamole and Queso Blanco carry an extra charge.
        components: [
          ["Cheese",         110, 6,  9, 0, 180, 0.00],
          ["Sour Cream",     120, 2, 10, 6,  30, 0.00],
          ["Guacamole",      230, 2, 22, 8, 220, 2.95],
          ["Queso Blanco",   120, 5,  8, 8, 490, 1.95],
          ["Fajita Veggies",  20, 1,  1, 4, 175, 0.00],
          ["Romaine Lettuce",  5, 0,  0, 1,   0, 0.00],
        ],
      },
      {
        name: "salsa",
        required: 0,
        pick: "many",
        components: [
          ["Fresh Tomato Salsa",       25, 1, 0,  5, 480, 0.00],
          ["Tomatillo Green-Chili Salsa", 15, 0, 0, 3, 230, 0.00],
          ["Tomatillo Red-Chili Salsa",30, 1, 0,  6, 500, 0.00],
          ["Corn Salsa",               80, 3, 1, 15, 410, 0.00],
        ],
      },
    ];

    for (const slot of chipotleSlots) {
      const slotId = addSlot.run(
        chipotleId,
        slot.name,
        slot.required,
        slot.pick,
        null
      ).lastInsertRowid;
      for (const [name, cal, pro, fat, carbs, sodium, price] of slot.components) {
        addComponent.run(slotId, name, cal, pro, fat, carbs, sodium, price, null);
      }
    }

    // ── Taco Bell ─────────────────────────────────────────────────────────────
    const tbId = addRestaurant.run("Taco Bell", "taco-bell", "fixed").lastInsertRowid;
    const tbItems: ItemRow[] = [
      // Tacos
      ["Crunchy Taco",                     "taco",       170,  8,  9, 13,  310, 1.99],
      ["Soft Taco (Beef)",                 "taco",       180,  9,  8, 19,  490, 1.99],
      ["Crunchy Taco Supreme",             "taco",       200, 10, 11, 15,  360, 2.49],
      ["Supreme Soft Taco (Beef)",         "taco",       220, 10, 10, 22,  580, 2.49],
      ["Spicy Potato Soft Taco",           "taco",       220,  5, 10, 30,  420, 1.99],
      ["Crispy Chicken Taco",              "taco",       190,  9,  9, 18,  380, 2.49],
      ["Doritos Locos Taco (Nacho Cheese)","taco",       170,  8,  9, 14,  350, 2.29],
      ["Doritos Locos Taco Supreme",       "taco",       200,  9, 11, 16,  390, 2.99],
      // Burritos
      ["Bean & Cheese Burrito",            "burrito",    380, 13, 11, 56, 1000, 2.29],
      ["Beefy 5-Layer Burrito",            "burrito",    490, 18, 19, 63, 1250, 4.49],
      ["Burrito Supreme (Beef)",           "burrito",    420, 15, 17, 53, 1120, 3.99],
      ["Chicken Chipotle Ranch Burrito",   "burrito",    540, 22, 22, 61, 1460, 5.99],
      ["Spicy Double Beef Burrito",        "burrito",    430, 15, 19, 52, 1090, 3.29],
      // Specialties
      ["Crunchwrap Supreme",               "specialty",  530, 16, 21, 69, 1190, 6.49],
      ["Mexican Pizza",                    "specialty",  540, 20, 28, 52,  960, 5.49],
      ["Chalupa Supreme (Beef)",           "chalupa",    340, 13, 17, 35,  510, 4.99],
      ["Chalupa Supreme (Chicken)",        "chalupa",    350, 17, 16, 36,  650, 4.99],
      ["Chicken Quesadilla",               "quesadilla", 510, 26, 24, 49, 1150, 6.49],
      ["Steak Quesadilla",                 "quesadilla", 490, 23, 23, 49, 1210, 6.99],
      ["Nachos BellGrande",                "nachos",     730, 20, 36, 82, 1280, 5.99],
      ["Nachos Supreme",                   "nachos",     430, 13, 20, 53,  800, 4.29],
      ["Chips & Nacho Cheese Sauce",       "side",       220,  3, 11, 29,  470, 2.99],
      // Bowls
      ["Chicken Power Bowl",               "bowl",       470, 26, 19, 53, 1500, 7.99],
      ["Veggie Power Bowl",                "bowl",       420, 13, 16, 55, 1190, 7.99],
      // Breakfast
      ["Breakfast Crunchwrap (Sausage)",   "breakfast",  670, 25, 37, 61, 1360, 4.49],
      ["Breakfast Crunchwrap (Bacon)",     "breakfast",  640, 23, 34, 62, 1370, 4.49],
      ["Grande Scrambler Burrito (Sausage)","breakfast", 660, 27, 36, 62, 1630, 5.49],
      ["Breakfast Soft Taco (Egg)",        "breakfast",  170,  6,  8, 18,  330, 2.49],
      ["Cinnabon Delights (2 pc)",         "dessert",    160,  2, 10, 17,   80, 1.99],
    ];
    for (const [name, cat, cal, pro, fat, carbs, sodium, price] of tbItems) {
      addItem.run(tbId, name, cat, cal, pro, fat, carbs, sodium, price);
    }

    // ── Panda Express (build-your-own) ────────────────────────────────────────
    const pandaId = addRestaurant.run("Panda Express", "panda-express", "build-your-own")
      .lastInsertRowid;
    const pandaSlots: {
      name: string; required: number; pick: string; countFrom?: string;
      components: ComponentRow[]; pickCounts?: Record<string, number>[];
    }[] = [
      {
        // pickCounts[i] says how many entrees the i-th base option allows —
        // the "entree" slot below reads this via countFrom to stay in sync.
        name: "base", required: 1, pick: "1",
        pickCounts: [{ entree: 1 }, { entree: 2 }, { entree: 3 }],
        components: [
          ["Bowl (1 Entree + 1 Side)",         0, 0, 0, 0, 0,  9.30],
          ["Plate (2 Entrees + 1 Side)",        0, 0, 0, 0, 0, 11.10],
          ["Bigger Plate (3 Entrees + 1 Side)", 0, 0, 0, 0, 0, 12.90],
        ],
      },
      {
        name: "entree", required: 1, pick: "many", countFrom: "base",
        components: [
          ["Orange Chicken",              490, 26, 22, 51,  830, 0.00],
          ["SweetFire Chicken Breast",    380, 17, 12, 52,  370, 0.00],
          ["String Bean Chicken Breast",  190, 14,  9, 15,  730, 0.00],
          ["Mushroom Chicken",            220, 13, 12, 17,  810, 0.00],
          ["Kung Pao Chicken",            290, 18, 18, 14,  840, 0.00],
          ["Grilled Teriyaki Chicken",    300, 36, 13,  8,  530, 0.00],
          ["Broccoli Beef",               150,  9,  7, 14,  530, 0.00],
          ["Beijing Beef",                470, 14, 26, 47,  690, 0.00],
          ["Honey Walnut Shrimp",         360, 14, 23, 26,  490, 1.50],
          ["Black Pepper Sirloin Steak",  180, 19,  9,  9, 1010, 1.50],
          ["Eggplant Tofu",               340,  7, 24, 26,  640, 0.00],
        ],
      },
      {
        name: "side", required: 1, pick: "1",
        components: [
          ["Fried Rice",         620, 13, 21, 88, 940, 0.00],
          ["Chow Mein",          600, 13, 23, 87, 980, 0.00],
          ["White Steamed Rice", 380,  7,  0, 86,   0, 0.00],
          ["Brown Steamed Rice", 380,  9,  1, 83,  15, 0.00],
          ["Super Greens",        90,  6,  3, 13, 360, 0.00],
        ],
      },
    ];
    for (const slot of pandaSlots) {
      const slotId = addSlot.run(
        pandaId, slot.name, slot.required, slot.pick, slot.countFrom ?? null
      ).lastInsertRowid;
      slot.components.forEach(([name, cal, pro, fat, carbs, sodium, price], i) => {
        const counts = slot.pickCounts?.[i];
        addComponent.run(
          slotId, name, cal, pro, fat, carbs, sodium, price,
          counts ? JSON.stringify(counts) : null
        );
      });
    }

    // ── Raising Cane's (build-your-own) ───────────────────────────────────────
    // Combos set the chicken quantity, base price, and how many sides come
    // with it (coupled to the "side" slot via pick_counts, same mechanism
    // Panda Express uses for its Bowl/Plate/Bigger Plate -> entree count).
    //
    // Sauce isn't modeled as a pickable slot: there's only one flavor in the
    // catalog, so "1 sauce" vs "2 sauces" is a quantity, not a choice — it's
    // baked directly into each combo's own nutrition numbers below, the same
    // way Chipotle bakes "Black Beans (Double)" into a single line item
    // instead of making you pick beans twice.
    const SAUCE = { calories: 190, protein_g: 0, fat_g: 20, carbs_g: 4, sodium_mg: 340 };
    const withSauce = (
      [name, cal, pro, fat, carbs, sodium, price]: ComponentRow,
      sauceCount: number
    ): ComponentRow => [
      name,
      cal + SAUCE.calories * sauceCount,
      pro + SAUCE.protein_g * sauceCount,
      fat + SAUCE.fat_g * sauceCount,
      carbs + SAUCE.carbs_g * sauceCount,
      sodium + SAUCE.sodium_mg * sauceCount,
      price,
    ];

    const canesId = addRestaurant.run("Raising Cane's", "raising-canes", "build-your-own")
      .lastInsertRowid;
    const canesSlots: {
      name: string; required: number; pick: string; countFrom?: string;
      components: ComponentRow[]; pickCounts?: Record<string, number>[];
    }[] = [
      {
        name: "combo", required: 1, pick: "1",
        // Nutrition = chicken fingers + baked-in sauce; sides are picked
        // separately below, count fixed per combo via pickCounts.
        pickCounts: [{ side: 2 }, { side: 3 }, { side: 3 }, { side: 1 }],
        components: [
          withSauce(["3 Finger Combo",         360, 36, 18, 15,  870, 10.29], 1),
          withSauce(["Box Combo (4 Fingers)",  480, 48, 24, 20, 1160, 12.29], 1),
          withSauce(["Caniac Combo (6 Fingers)",720, 72, 36, 30, 1740, 16.49], 2),
          withSauce(["Sandwich Combo",         530, 29, 18, 56,  900, 11.49], 1),
        ],
      },
      {
        // Real choice between distinct sides — count is fixed by the combo
        // above, but which sides fill those slots is genuinely optimizable.
        name: "side", required: 1, pick: "many", countFrom: "combo",
        components: [
          ["Crinkle-Cut Fries", 290,  4, 10, 46, 330, 0.00],
          ["Texas Toast",       150,  4,  6, 21, 260, 0.00],
          ["Coleslaw",          140,  1,  8, 18,  95, 0.00],
        ],
      },
      {
        // Extra chicken = costs money; anything else is just a free sub.
        name: "extra", required: 0, pick: "many",
        components: [
          ["Extra Chicken Finger", 120, 12, 6, 5, 290, 1.99],
        ],
      },
    ];
    for (const slot of canesSlots) {
      const slotId = addSlot.run(
        canesId, slot.name, slot.required, slot.pick, slot.countFrom ?? null
      ).lastInsertRowid;
      slot.components.forEach(([name, cal, pro, fat, carbs, sodium, price], i) => {
        const counts = slot.pickCounts?.[i];
        addComponent.run(
          slotId, name, cal, pro, fat, carbs, sodium, price,
          counts ? JSON.stringify(counts) : null
        );
      });
    }

    // ── Whataburger ───────────────────────────────────────────────────────────
    const wbId = addRestaurant.run("Whataburger", "whataburger", "fixed").lastInsertRowid;
    const wbItems: ItemRow[] = [
      // Burgers
      ["Whataburger",                      "burger",    580, 29, 25, 63, 1110, 6.89],
      ["Whataburger Jr.",                  "burger",    340, 16, 14, 38,  630, 3.99],
      ["Double Whataburger",               "burger",    840, 48, 42, 66, 1390, 8.99],
      ["Triple Whataburger",               "burger",   1080, 67, 60, 68, 1670, 11.99],
      ["Patty Melt",                       "burger",    870, 41, 52, 59, 1430, 8.49],
      ["Avocado Bacon Burger",             "burger",    670, 32, 36, 55, 1160, 8.49],
      ["Mushroom Swiss Burger",            "burger",    760, 37, 41, 64, 1140, 8.49],
      ["Bacon Whataburger",                "burger",    640, 32, 31, 65, 1360, 8.49],
      ["Jalapeño & Cheese Whataburger",    "burger",    620, 30, 28, 67, 1230, 7.49],
      // Chicken & Fish
      ["Grilled Chicken Sandwich",         "sandwich",  380, 36, 10, 39,  910, 6.49],
      ["Spicy Chicken Sandwich",           "sandwich",  480, 28, 18, 52, 1300, 6.49],
      ["Crispy Chicken Sandwich",          "sandwich",  590, 27, 28, 57, 1320, 6.49],
      ["Honey BBQ Chicken Strip Sandwich", "sandwich",  770, 38, 30, 90, 1790, 7.49],
      ["Chicken Strips (3 pc)",            "entree",    370, 24, 14, 38,  970, 6.99],
      ["Chicken Strips (5 pc)",            "entree",    620, 40, 23, 63, 1610, 9.99],
      // Sides
      ["French Fries (Small)",             "side",      280,  4, 13, 37,  310, 2.49],
      ["French Fries (Medium)",            "side",      380,  5, 18, 50,  430, 3.49],
      ["French Fries (Large)",             "side",      560,  8, 26, 74,  620, 3.99],
      ["Onion Rings (Medium)",             "side",      430,  5, 22, 53,  600, 3.79],
      ["Apple Slices",                     "side",       30,  0,  0,  8,    0, 1.49],
      // Breakfast
      ["Breakfast on a Bun (Egg & Cheese)","breakfast", 370, 18, 21, 29,  830, 4.99],
      ["Breakfast on a Bun (Sausage)",     "breakfast", 530, 22, 34, 31, 1050, 5.49],
      ["Taquito with Egg & Cheese",        "breakfast", 380, 14, 17, 43,  900, 4.99],
      ["Pancakes (3 ct)",                  "breakfast", 580, 14, 18, 90, 1570, 5.99],
      ["Hash Brown Sticks (6 ct)",         "breakfast", 270,  3, 15, 32,  830, 2.99],
      ["Cinnamon Roll",                    "breakfast", 490,  8, 14, 82,  490, 3.49],
      // Dessert
      ["Hot Apple Pie",                    "dessert",   230,  2, 11, 33,  240, 1.99],
    ];
    for (const [name, cat, cal, pro, fat, carbs, sodium, price] of wbItems) {
      addItem.run(wbId, name, cat, cal, pro, fat, carbs, sodium, price);
    }
  })();
}
