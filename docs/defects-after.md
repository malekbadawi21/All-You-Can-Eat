# Engine output after the rewrite

The same eighteen queries as `docs/defects-before.md`, run through the
rewritten engine (parser → menu matching → `recommend()` → selection) against
the seed menus. Compare the two files side by side.

How to read a line:

```
Q: the query   [restaurant] {the criteria it understood}
  ! notice_code: what it could not do
  [label/shape] calories protein carbs fat $price :: items
```

What changed, row by row:

| Query | Before | After |
|---|---|---|
| `lean mcdonalds ~500 cal` | Side Salad counted as a main → "Double up" | Side Salad is a side; "Double up" is two hamburgers |
| `whataburger under 800 calories` | 810 cal result; 3x Hash Brown Sticks; Cinnamon Roll meal | every result ≤ 800; every result has a real main |
| `low carb taco bell` | Cinnabon Delights; breakfast tacos | tacos only, all-day menu, no dessert |
| `cheapest high protein chipotle` | 1,310 cal double-rice burrito | 680 cal chicken bowl at the base price |
| `chipotle` | 1,145 cal sofritas burrito as "Balanced" | three ordinary ~700 cal orders |
| `high protein panda express` | "Most variety" 31g vs 114g | every alternative within reach on protein |
| `cheap meal at mcdonalds under $8` | cap ignored; apple slices twice | `under $8` parsed and held |
| `high protein wendys` | `no_restaurant` | `unknown_restaurant` |
| `raising canes around 600 calories` | 830 cal, silently | notice: nearest is 830 |
| any | 5 results with repeated labels vs 3 | 3–5 results, unique labels, both types |

Regenerate with the engine tests' helper (`lib/__fixtures__/ask.ts`) or by
querying `/api/search` on a running dev server.

```
Q: lean mcdonalds ~500 cal   [mcdonalds] {low fat, around 500 cal}
  [Best match/classic] 465cal 18p 69c 14f $3.97 :: Hamburger + Apple Slices + Vanilla Soft Serve Cone
  [No sides/single] 530cal 27p 49c 26f $5.99 :: Crispy Chicken Sandwich
  [Double up/stack] 500cal 26p 62c 18f $3.38 :: 2x Hamburger
Q: whataburger under 800 calories   [whataburger] {under 800 cal}
  [Best match/classic] 660cal 40p 76c 23f $8.98 :: Grilled Chicken Sandwich + French Fries (Small)
  [No sides/single] 590cal 27p 57c 28f $6.49 :: Crispy Chicken Sandwich
  [Double up/stack] 720cal 52p 77c 24f $10.48 :: Whataburger Jr. + Grilled Chicken Sandwich
  [Budget pick/classic] 370cal 16p 46c 14f $5.48 :: Whataburger Jr. + Apple Slices
Q: low carb taco bell   [taco-bell] {low carb}
  [Best match/single] 710cal 34p 54c 38f $8.46 :: 3x Crunchy Taco + Crunchy Taco Supreme
  [Double up/stack] 710cal 31p 63c 37f $9.47 :: Crunchy Taco + Crunchy Taco Supreme + Chalupa Supreme (Beef)
  [Budget pick/single] 510cal 24p 42c 27f $6.87 :: 3x Doritos Locos Taco (Nacho Cheese)
  [Lighter option/single] 400cal 18p 32c 22f $5.98 :: 2x Doritos Locos Taco Supreme
Q: cheapest high protein chipotle   [chipotle] {high protein, cheap}
  [Best match/build] 680cal 59p 70c 20f $9.79 :: Bowl + Chicken + Black Beans (Double) + Cheese + Fajita Veggies + Romaine Lettuce + Corn Salsa + Fresh Tomato Salsa
  [Switch it up/build] 410cal 66p 12c 15f $14.39 :: Bowl + Chicken (Double) + Romaine Lettuce + Fajita Veggies + Fresh Tomato Salsa
  [Also good/build] 725cal 54p 80c 22f $9.79 :: Tacos — Crispy Corn (3) + Chicken + Black Beans + Cheese + Fajita Veggies + Corn Salsa + Fresh Tomato Salsa
Q: chipotle   [chipotle] {}
  [Best match/build] 715cal 51p 90c 18f $9.79 :: Burrito (Flour Tortilla) + Chicken + Black Beans + Romaine Lettuce + Corn Salsa
  [Switch it up/build] 700cal 54p 95c 14f $9.79 :: Bowl + Chicken + White Rice + Black Beans (Double) + Fajita Veggies + Romaine Lettuce + Fresh Tomato Salsa
  [Also good/build] 710cal 44p 96c 18f $9.79 :: Tacos — Soft Flour (3) + Chicken + White Rice + Fajita Veggies + Romaine Lettuce + Fresh Tomato Salsa
Q: high protein panda express   [panda-express] {high protein}
  [Best match/build] 690cal 78p 29c 29f $11.1 :: Plate (2 Entrees + 1 Side) + 2x Grilled Teriyaki Chicken + Super Greens
  [Most variety/build] 570cal 61p 30c 25f $12.6 :: Plate (2 Entrees + 1 Side) + Grilled Teriyaki Chicken + Black Pepper Sirloin Steak + Super Greens
  [Switch it up/build] 840cal 87p 43c 36f $12.9 :: Bigger Plate (3 Entrees + 1 Side) + 2x Grilled Teriyaki Chicken + Broccoli Beef + Super Greens
  [Budget pick/build] 680cal 45p 91c 14f $9.3 :: Bowl (1 Entree + 1 Side) + Grilled Teriyaki Chicken + Brown Steamed Rice
  [Lighter option/build] 500cal 33p 45c 24f $11.1 :: Plate (2 Entrees + 1 Side) + String Bean Chicken Breast + Mushroom Chicken + Super Greens
Q: cheap meal at mcdonalds under $8   [mcdonalds] {under $8, cheap}
  [Best match/stack] 500cal 26p 62c 18f $3.38 :: 2x Hamburger
  [Classic meal/classic] 450cal 18p 65c 14f $2.98 :: Hamburger + Vanilla Soft Serve Cone
  [No sides/single] 400cal 14p 39c 22f $2.49 :: McChicken
  [Lighter option/classic] 370cal 14p 44c 15f $3.48 :: Chicken McNuggets (4 pc) + Vanilla Soft Serve Cone
Q: high protein wendys
  -> unknown_restaurant Wendy's
Q: raising canes around 600 calories   [raising-canes] {around 600 cal}
  ! calorie_target_unreachable: Nothing at Raising Cane's lands near 600 calories — the closest is 830. Showing the nearest orders.
  [Best match/build] 840cal 41p 58c 52f $10.29 :: 3 Finger Combo + Texas Toast + Coleslaw
  [Switch it up/build] 870cal 33p 81c 44f $11.49 :: Sandwich Combo + Texas Toast
  [Also good/build] 860cal 30p 78c 46f $11.49 :: Sandwich Combo + Coleslaw
Q: high protein chick-fil-a   [chick-fil-a] {high protein}
  [Best match/stack] 400cal 76p 4c 10f $14.18 :: 2x Grilled Nuggets (12 ct)
  [Classic meal/classic] 350cal 44p 27c 10f $13.49 :: Grilled Nuggets (12 ct) + Side Salad + Fruit Cup (Medium)
  [No sides/single] 350cal 42p 29c 13f $8.25 :: Grilled Cool Wrap
Q: high protein chick-fil-a around 800 calories   [chick-fil-a] {high protein, around 800 cal}
  [Best match/stack] 700cal 87p 39c 24f $17.17 :: 2x Grilled Nuggets (12 ct) + Mac & Cheese (Small)
  [Classic meal/classic] 730cal 58p 63c 30f $14.63 :: Grilled Nuggets (12 ct) + Side Salad + Mac & Cheese (Medium)
  [Budget pick/stack] 710cal 67p 53c 24f $12.6 :: Grilled Chicken Sandwich + Chick-fil-A Nuggets (12 ct)
Q: low fat whataburger around 700 calories   [whataburger] {low fat, around 700 cal}
  [Best match/stack] 760cal 72p 78c 20f $12.98 :: 2x Grilled Chicken Sandwich
  [Classic meal/classic] 650cal 40p 71c 23f $11.48 :: Chicken Strips (5 pc) + Apple Slices
  [No sides/single] 770cal 38p 90c 30f $7.49 :: Honey BBQ Chicken Strip Sandwich
Q: keto chipotle around 700 cal   [chipotle] {low carb, around 700 cal}
  [Best match/build] 685cal 34p 19c 53f $13.48 :: Bowl + Carnitas + Cheese + Guacamole + Sour Cream + Fresh Tomato Salsa
  [Switch it up/build] 665cal 43p 20c 48f $12.74 :: Bowl + Chicken + Cheese + Guacamole + Sour Cream + Fresh Tomato Salsa
  [Also good/build] 655cal 55p 11c 43f $15.13 :: Bowl + Carnitas (Double) + Cheese + Sour Cream + Fresh Tomato Salsa
Q: high protein mcdonalds   [mcdonalds] {high protein}
  [Best match/single] 740cal 48p 43c 42f $8.39 :: Double Quarter Pounder with Cheese
  [Classic meal/classic] 545cal 31p 45c 27f $8.78 :: Quarter Pounder with Cheese + Side Salad
  [Double up/stack] 910cal 57p 53c 52f $10.58 :: Double Quarter Pounder with Cheese + Chicken McNuggets (4 pc)
  [Budget pick/stack] 700cal 38p 65c 33f $5.68 :: Hamburger + Double Cheeseburger
  [Lighter option/single] 450cal 25p 34c 24f $3.99 :: Double Cheeseburger
Q: taco bell   [taco-bell] {}
  [Best match/single] 690cal 35p 68c 32f $8.48 :: Soft Taco (Beef) + Chicken Quesadilla
  [Classic meal/classic] 710cal 21p 92c 30f $7.48 :: Beefy 5-Layer Burrito + Chips & Nacho Cheese Sauce
  [Double up/stack] 700cal 34p 68c 33f $8.97 :: Crunchy Taco + Soft Taco (Beef) + Chalupa Supreme (Chicken)
  [Budget pick/classic] 650cal 18p 81c 30f $6.28 :: Spicy Double Beef Burrito + Chips & Nacho Cheese Sauce
  [Lighter option/single] 550cal 21p 69c 20f $4.28 :: Crunchy Taco + Bean & Cheese Burrito
Q: low calorie mcdonalds   [mcdonalds] {low calorie}
  [Best match/classic] 415cal 22p 38c 20f $4.48 :: McDouble + Apple Slices
  [No sides/single] 450cal 25p 34c 24f $3.99 :: Double Cheeseburger
  [Double up/stack] 420cal 22p 41c 19f $3.88 :: Hamburger + Chicken McNuggets (4 pc)
  [Budget pick/classic] 315cal 15p 36c 13f $2.98 :: Cheeseburger + Apple Slices
  [Lighter option/classic] 265cal 13p 35c 9f $2.68 :: Hamburger + Apple Slices
Q: high protein raising canes   [raising-canes] {high protein}
  [Best match/build] 850cal 44p 61c 50f $10.29 :: 3 Finger Combo + 2x Texas Toast
  [Most variety/build] 840cal 41p 58c 52f $10.29 :: 3 Finger Combo + Texas Toast + Coleslaw
  [Switch it up/build] 870cal 33p 81c 44f $11.49 :: Sandwich Combo + Texas Toast
Q: cheapest burger under 500 calories McDonald's   [mcdonalds] {under 500 cal, with burger, cheap}
  [Best match/single] 250cal 13p 31c 9f $1.69 :: Hamburger
  [Classic meal/classic] 315cal 15p 36c 13f $2.98 :: Cheeseburger + Apple Slices
  [Double up/stack] 500cal 26p 62c 18f $3.38 :: 2x Hamburger
```
