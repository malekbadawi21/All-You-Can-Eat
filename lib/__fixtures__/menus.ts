import type { MenuItem } from "../db";

// A realistic slice of the seeded Chick-fil-A menu (real nutrition numbers,
// copied from seedIfEmpty() in lib/db.ts).
//
// Why a fixture instead of reading the real database:
//   1. lib/db.ts pulls in better-sqlite3, a native module that opens a file on
//      disk. Tests that touch it are slow, order-dependent, and break whenever
//      the seed data is edited for unrelated reasons.
//   2. The optimizer is a pure function of the items handed to it, so a fixed
//      input set is all it needs — and a fixed input set means a failure points
//      at the algorithm, never at the data.
//
// This slice is chosen to reproduce the two composition defects we found by
// querying the live API:
//   - high-protein mains that crowd out every side (stacked-mains defect)
//   - breakfast items that combine with all-day mains (daypart defect)
export const CHICK_FIL_A: MenuItem[] = [
  // ── breakfast (only served until ~10:30am) ────────────────────────────────
  { id: 1,  name: "Egg White Grill",               category: "breakfast", calories: 290, protein_g: 26, fat_g:  7, carbs_g: 30, sodium_mg:  970, price: 4.65 },
  { id: 2,  name: "Greek Yogurt Parfait",          category: "breakfast", calories: 230, protein_g: 14, fat_g:  5, carbs_g: 34, sodium_mg:   90, price: 3.35 },
  { id: 3,  name: "Hash Browns",                   category: "breakfast", calories: 270, protein_g:  3, fat_g: 14, carbs_g: 35, sodium_mg:  560, price: 1.39 },

  // ── all-day mains ─────────────────────────────────────────────────────────
  { id: 4,  name: "Chick-fil-A Chicken Sandwich",  category: "sandwich",  calories: 440, protein_g: 28, fat_g: 19, carbs_g: 40, sodium_mg: 1350, price: 5.45 },
  { id: 5,  name: "Grilled Chicken Sandwich",      category: "sandwich",  calories: 320, protein_g: 29, fat_g:  6, carbs_g: 36, sodium_mg:  800, price: 5.75 },
  { id: 6,  name: "Grilled Chicken Club Sandwich", category: "sandwich",  calories: 430, protein_g: 38, fat_g: 15, carbs_g: 37, sodium_mg: 1140, price: 7.35 },
  { id: 7,  name: "Grilled Cool Wrap",             category: "wrap",      calories: 350, protein_g: 42, fat_g: 13, carbs_g: 29, sodium_mg: 1070, price: 8.25 },
  { id: 8,  name: "Chick-fil-A Nuggets (12 ct)",   category: "entree",    calories: 390, protein_g: 38, fat_g: 18, carbs_g: 17, sodium_mg: 1460, price: 6.85 },
  { id: 9,  name: "Grilled Nuggets (12 ct)",       category: "entree",    calories: 200, protein_g: 38, fat_g:  5, carbs_g:  2, sodium_mg:  740, price: 7.09 },
  { id: 10, name: "Cobb Salad — Grilled Chicken",  category: "salad",     calories: 430, protein_g: 38, fat_g: 22, carbs_g: 18, sodium_mg: 1010, price: 10.25 },

  // ── sides ─────────────────────────────────────────────────────────────────
  { id: 11, name: "Waffle Potato Fries (Medium)",  category: "side",      calories: 420, protein_g:  5, fat_g: 21, carbs_g: 52, sodium_mg:  280, price: 3.09 },
  { id: 12, name: "Mac & Cheese (Small)",          category: "side",      calories: 300, protein_g: 11, fat_g: 14, carbs_g: 35, sodium_mg:  660, price: 2.99 },
  { id: 13, name: "Fruit Cup (Medium)",            category: "side",      calories:  70, protein_g:  1, fat_g:  0, carbs_g: 18, sodium_mg:    0, price: 2.65 },

  // ── dessert ───────────────────────────────────────────────────────────────
  { id: 14, name: "Icedream Cone",                 category: "dessert",   calories: 170, protein_g:  4, fat_g:  4, carbs_g: 28, sodium_mg:   90, price: 1.55 },
];

// A slice of the seeded McDonald's menu. Kept separate from CHICK_FIL_A
// because it exposes a different defect: McDonald's has one item that towers
// over the rest on protein (the Double Quarter Pounder, 48g), so the top
// results collapse into variations on that single item. Chick-fil-A's menu is
// flatter and doesn't show the problem as sharply.
export const MCDONALDS: MenuItem[] = [
  // ── burgers ───────────────────────────────────────────────────────────────
  { id: 101, name: "Hamburger",                          category: "burger",    calories: 250, protein_g: 13, fat_g:  9, carbs_g: 31, sodium_mg:  510, price: 1.69 },
  { id: 102, name: "Cheeseburger",                       category: "burger",    calories: 300, protein_g: 15, fat_g: 13, carbs_g: 32, sodium_mg:  680, price: 1.99 },
  { id: 103, name: "McDouble",                           category: "burger",    calories: 400, protein_g: 22, fat_g: 20, carbs_g: 34, sodium_mg:  840, price: 3.49 },
  { id: 104, name: "Big Mac",                            category: "burger",    calories: 550, protein_g: 25, fat_g: 30, carbs_g: 46, sodium_mg: 1010, price: 5.99 },
  { id: 105, name: "Quarter Pounder with Cheese",        category: "burger",    calories: 530, protein_g: 30, fat_g: 27, carbs_g: 42, sodium_mg: 1090, price: 6.79 },
  { id: 106, name: "Double Quarter Pounder with Cheese", category: "burger",    calories: 740, protein_g: 48, fat_g: 42, carbs_g: 43, sodium_mg: 1360, price: 8.39 },

  // ── chicken & fish ────────────────────────────────────────────────────────
  { id: 107, name: "McChicken",                          category: "sandwich",  calories: 400, protein_g: 14, fat_g: 22, carbs_g: 39, sodium_mg:  590, price: 2.49 },
  { id: 108, name: "Crispy Chicken Sandwich",            category: "sandwich",  calories: 530, protein_g: 27, fat_g: 26, carbs_g: 49, sodium_mg: 1200, price: 5.99 },
  { id: 109, name: "Filet-O-Fish",                       category: "sandwich",  calories: 390, protein_g: 17, fat_g: 19, carbs_g: 38, sodium_mg:  580, price: 5.69 },

  // ── nuggets ───────────────────────────────────────────────────────────────
  { id: 110, name: "Chicken McNuggets (4 pc)",            category: "entree",   calories: 170, protein_g:  9, fat_g: 10, carbs_g: 10, sodium_mg:  310, price: 2.19 },
  { id: 111, name: "Chicken McNuggets (6 pc)",            category: "entree",   calories: 250, protein_g: 14, fat_g: 15, carbs_g: 15, sodium_mg:  470, price: 3.79 },
  { id: 112, name: "Chicken McNuggets (10 pc)",           category: "entree",   calories: 420, protein_g: 23, fat_g: 25, carbs_g: 25, sodium_mg:  770, price: 5.69 },
  { id: 113, name: "Chicken McNuggets (20 pc)",           category: "entree",   calories: 830, protein_g: 45, fat_g: 49, carbs_g: 50, sodium_mg: 1560, price: 10.49 },

  // ── sides ─────────────────────────────────────────────────────────────────
  { id: 114, name: "World Famous Fries (Small)",          category: "side",     calories: 230, protein_g:  3, fat_g: 11, carbs_g: 30, sodium_mg:  180, price: 1.89 },
  { id: 115, name: "World Famous Fries (Medium)",         category: "side",     calories: 320, protein_g:  4, fat_g: 15, carbs_g: 43, sodium_mg:  400, price: 3.19 },
  { id: 116, name: "Apple Slices",                        category: "side",     calories:  15, protein_g:  0, fat_g:  0, carbs_g:  4, sodium_mg:    0, price: 0.99 },

  // ── breakfast / dessert ───────────────────────────────────────────────────
  { id: 117, name: "Egg McMuffin",                        category: "breakfast", calories: 310, protein_g: 17, fat_g: 13, carbs_g: 30, sodium_mg:  740, price: 4.99 },
  { id: 118, name: "Baked Apple Pie",                     category: "dessert",   calories: 240, protein_g:  2, fat_g: 11, carbs_g: 33, sodium_mg:   95, price: 1.29 },
];
