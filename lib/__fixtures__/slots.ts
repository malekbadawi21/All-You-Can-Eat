import type { Slot } from "../db";

// Build-your-own slot definitions, generated from the seeded database so the
// numbers match production exactly (see seedIfEmpty() in lib/db.ts).
//
// Three restaurants because each exercises a different part of buildOrder:
//   - Chipotle: optional "pick many" condiment slots, decided separately from
//     the joint search over core slots
//   - Panda Express: a base whose pick_counts dictates how many entrees the
//     entree slot must take (Bowl = 1, Plate = 2, Bigger Plate = 3)
//   - Raising Cane's: the same coupling on sides, plus an optional extra

export const CHIPOTLE_SLOTS: Slot[] = [
  {
    slot_name: "base",
    required: true,
    pick: "1",
    options: [
      { id: 1, name: "Bowl", calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sodium_mg: 0, price: 10.75 },
      { id: 2, name: "Burrito (Flour Tortilla)", calories: 320, protein_g: 8, fat_g: 9, carbs_g: 51, sodium_mg: 680, price: 10.75 },
      { id: 3, name: "Salad", calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sodium_mg: 0, price: 9.75 },
      { id: 4, name: "Tacos — Soft Flour (3)", calories: 270, protein_g: 6, fat_g: 6, carbs_g: 45, sodium_mg: 480, price: 10.75 },
      { id: 5, name: "Tacos — Crispy Corn (3)", calories: 180, protein_g: 3, fat_g: 3, carbs_g: 33, sodium_mg: 30, price: 10.75 },
    ],
  },
  {
    slot_name: "protein",
    required: true,
    pick: "1",
    options: [
      { id: 6, name: "Chicken", calories: 180, protein_g: 32, fat_g: 7, carbs_g: 1, sodium_mg: 310, price: 0.00 },
      { id: 7, name: "Steak", calories: 150, protein_g: 21, fat_g: 7, carbs_g: 1, sodium_mg: 290, price: 0.00 },
      { id: 8, name: "Barbacoa", calories: 165, protein_g: 24, fat_g: 7, carbs_g: 2, sodium_mg: 460, price: 0.00 },
      { id: 9, name: "Carnitas", calories: 200, protein_g: 23, fat_g: 12, carbs_g: 0, sodium_mg: 430, price: 0.00 },
      { id: 10, name: "Sofritas", calories: 145, protein_g: 8, fat_g: 10, carbs_g: 9, sodium_mg: 480, price: 0.00 },
      { id: 11, name: "Chicken (Double)", calories: 360, protein_g: 64, fat_g: 14, carbs_g: 2, sodium_mg: 620, price: 4.50 },
      { id: 12, name: "Steak (Double)", calories: 300, protein_g: 42, fat_g: 14, carbs_g: 2, sodium_mg: 580, price: 4.50 },
      { id: 13, name: "Barbacoa (Double)", calories: 330, protein_g: 48, fat_g: 14, carbs_g: 4, sodium_mg: 920, price: 4.50 },
      { id: 14, name: "Carnitas (Double)", calories: 400, protein_g: 46, fat_g: 24, carbs_g: 0, sodium_mg: 860, price: 4.50 },
      { id: 15, name: "Sofritas (Double)", calories: 290, protein_g: 16, fat_g: 20, carbs_g: 18, sodium_mg: 960, price: 4.50 },
    ],
  },
  {
    slot_name: "rice",
    required: false,
    pick: "1",
    options: [
      { id: 16, name: "White Rice", calories: 210, protein_g: 4, fat_g: 4, carbs_g: 40, sodium_mg: 400, price: 0.00 },
      { id: 17, name: "Brown Rice", calories: 210, protein_g: 5, fat_g: 4, carbs_g: 40, sodium_mg: 210, price: 0.00 },
      { id: 18, name: "White Rice (Double)", calories: 420, protein_g: 8, fat_g: 8, carbs_g: 80, sodium_mg: 800, price: 0.50 },
      { id: 19, name: "Brown Rice (Double)", calories: 420, protein_g: 10, fat_g: 8, carbs_g: 80, sodium_mg: 420, price: 0.50 },
    ],
  },
  {
    slot_name: "beans",
    required: false,
    pick: "1",
    options: [
      { id: 20, name: "Black Beans", calories: 130, protein_g: 8, fat_g: 1, carbs_g: 22, sodium_mg: 210, price: 0.00 },
      { id: 21, name: "Pinto Beans", calories: 130, protein_g: 8, fat_g: 1, carbs_g: 22, sodium_mg: 320, price: 0.00 },
      { id: 22, name: "Black Beans (Double)", calories: 260, protein_g: 16, fat_g: 2, carbs_g: 44, sodium_mg: 420, price: 0.00 },
      { id: 23, name: "Pinto Beans (Double)", calories: 260, protein_g: 16, fat_g: 2, carbs_g: 44, sodium_mg: 640, price: 0.00 },
    ],
  },
  {
    slot_name: "toppings",
    required: false,
    pick: "many",
    options: [
      { id: 24, name: "Cheese", calories: 110, protein_g: 6, fat_g: 9, carbs_g: 0, sodium_mg: 180, price: 0.00 },
      { id: 25, name: "Sour Cream", calories: 120, protein_g: 2, fat_g: 10, carbs_g: 6, sodium_mg: 30, price: 0.00 },
      { id: 26, name: "Guacamole", calories: 230, protein_g: 2, fat_g: 22, carbs_g: 8, sodium_mg: 220, price: 2.95 },
      { id: 27, name: "Queso Blanco", calories: 120, protein_g: 5, fat_g: 8, carbs_g: 8, sodium_mg: 490, price: 1.95 },
      { id: 28, name: "Fajita Veggies", calories: 20, protein_g: 1, fat_g: 1, carbs_g: 4, sodium_mg: 175, price: 0.00 },
      { id: 29, name: "Romaine Lettuce", calories: 5, protein_g: 0, fat_g: 0, carbs_g: 1, sodium_mg: 0, price: 0.00 },
    ],
  },
  {
    slot_name: "salsa",
    required: false,
    pick: "many",
    options: [
      { id: 30, name: "Fresh Tomato Salsa", calories: 25, protein_g: 1, fat_g: 0, carbs_g: 5, sodium_mg: 480, price: 0.00 },
      { id: 31, name: "Tomatillo Green-Chili Salsa", calories: 15, protein_g: 0, fat_g: 0, carbs_g: 3, sodium_mg: 230, price: 0.00 },
      { id: 32, name: "Tomatillo Red-Chili Salsa", calories: 30, protein_g: 1, fat_g: 0, carbs_g: 6, sodium_mg: 500, price: 0.00 },
      { id: 33, name: "Corn Salsa", calories: 80, protein_g: 3, fat_g: 1, carbs_g: 15, sodium_mg: 410, price: 0.00 },
    ],
  },
];

export const PANDA_SLOTS: Slot[] = [
  {
    slot_name: "base",
    required: true,
    pick: "1",
    options: [
      { id: 34, name: "Bowl (1 Entree + 1 Side)", calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sodium_mg: 0, price: 9.99, pick_counts: {"entree": 1} },
      { id: 35, name: "Plate (2 Entrees + 1 Side)", calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sodium_mg: 0, price: 11.99, pick_counts: {"entree": 2} },
      { id: 36, name: "Bigger Plate (3 Entrees + 1 Side)", calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sodium_mg: 0, price: 13.99, pick_counts: {"entree": 3} },
    ],
  },
  {
    slot_name: "entree",
    required: true,
    pick: "many",
    count_from: "base",
    options: [
      { id: 37, name: "Orange Chicken", calories: 490, protein_g: 26, fat_g: 22, carbs_g: 51, sodium_mg: 830, price: 0.00 },
      { id: 38, name: "SweetFire Chicken Breast", calories: 380, protein_g: 17, fat_g: 12, carbs_g: 52, sodium_mg: 370, price: 0.00 },
      { id: 39, name: "String Bean Chicken Breast", calories: 190, protein_g: 14, fat_g: 9, carbs_g: 15, sodium_mg: 730, price: 0.00 },
      { id: 40, name: "Mushroom Chicken", calories: 220, protein_g: 13, fat_g: 12, carbs_g: 17, sodium_mg: 810, price: 0.00 },
      { id: 41, name: "Kung Pao Chicken", calories: 290, protein_g: 18, fat_g: 18, carbs_g: 14, sodium_mg: 840, price: 0.00 },
      { id: 42, name: "Grilled Teriyaki Chicken", calories: 300, protein_g: 36, fat_g: 13, carbs_g: 8, sodium_mg: 530, price: 0.00 },
      { id: 43, name: "Broccoli Beef", calories: 150, protein_g: 9, fat_g: 7, carbs_g: 14, sodium_mg: 530, price: 0.00 },
      { id: 44, name: "Beijing Beef", calories: 470, protein_g: 14, fat_g: 26, carbs_g: 47, sodium_mg: 690, price: 0.00 },
      { id: 45, name: "Honey Walnut Shrimp", calories: 360, protein_g: 14, fat_g: 23, carbs_g: 26, sodium_mg: 490, price: 1.50 },
      { id: 46, name: "Black Pepper Sirloin Steak", calories: 180, protein_g: 19, fat_g: 9, carbs_g: 9, sodium_mg: 1010, price: 1.50 },
      { id: 47, name: "Eggplant Tofu", calories: 340, protein_g: 7, fat_g: 24, carbs_g: 26, sodium_mg: 640, price: 0.00 },
    ],
  },
  {
    slot_name: "side",
    required: true,
    pick: "1",
    options: [
      { id: 48, name: "Fried Rice", calories: 620, protein_g: 13, fat_g: 21, carbs_g: 88, sodium_mg: 940, price: 0.00 },
      { id: 49, name: "Chow Mein", calories: 600, protein_g: 13, fat_g: 23, carbs_g: 87, sodium_mg: 980, price: 0.00 },
      { id: 50, name: "White Steamed Rice", calories: 380, protein_g: 7, fat_g: 0, carbs_g: 86, sodium_mg: 0, price: 0.00 },
      { id: 51, name: "Brown Steamed Rice", calories: 380, protein_g: 9, fat_g: 1, carbs_g: 83, sodium_mg: 15, price: 0.00 },
      { id: 52, name: "Super Greens", calories: 90, protein_g: 6, fat_g: 3, carbs_g: 13, sodium_mg: 360, price: 0.00 },
    ],
  },
];

export const CANES_SLOTS: Slot[] = [
  {
    slot_name: "combo",
    required: true,
    pick: "1",
    options: [
      { id: 53, name: "3 Finger Combo", calories: 550, protein_g: 36, fat_g: 38, carbs_g: 19, sodium_mg: 1210, price: 11.99, pick_counts: {"side": 2} },
      { id: 54, name: "Box Combo (4 Fingers)", calories: 670, protein_g: 48, fat_g: 44, carbs_g: 24, sodium_mg: 1500, price: 14.99, pick_counts: {"side": 3} },
      { id: 55, name: "Caniac Combo (6 Fingers)", calories: 1100, protein_g: 72, fat_g: 76, carbs_g: 38, sodium_mg: 2420, price: 18.99, pick_counts: {"side": 3} },
      { id: 56, name: "Sandwich Combo", calories: 720, protein_g: 29, fat_g: 38, carbs_g: 60, sodium_mg: 1240, price: 12.99, pick_counts: {"side": 1} },
    ],
  },
  {
    slot_name: "side",
    required: true,
    pick: "many",
    count_from: "combo",
    options: [
      { id: 57, name: "Crinkle-Cut Fries", calories: 290, protein_g: 4, fat_g: 10, carbs_g: 46, sodium_mg: 330, price: 0.00 },
      { id: 58, name: "Texas Toast", calories: 150, protein_g: 4, fat_g: 6, carbs_g: 21, sodium_mg: 260, price: 0.00 },
      { id: 59, name: "Coleslaw", calories: 140, protein_g: 1, fat_g: 8, carbs_g: 18, sodium_mg: 95, price: 0.00 },
    ],
  },
  {
    slot_name: "extra",
    required: false,
    pick: "many",
    options: [
      { id: 60, name: "Extra Chicken Finger", calories: 120, protein_g: 12, fat_g: 6, carbs_g: 5, sodium_mg: 290, price: 2.49 },
    ],
  },
];

