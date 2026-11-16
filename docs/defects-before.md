# Engine output before the rewrite

Captured 2026-11-16 from the real `/api/search` route handler at commit
`7e2cafc` (the state of `main` when the finishing work began), before any
engine change. This is the "before" half of the before/after comparison the
project's workflow asks for: every defect in the handoff's table reproduces
here, plus a few it didn't list.

How to read a line:

```
[label] calories protein carbs fat $price :: items (slot in braces on build-your-own)
```

What to look for:

| Query | What's wrong in the output below |
|---|---|
| `lean mcdonalds ~500 cal` | "Double up" on Hamburger + cone + Side Salad — the salad is counted as a second main. |
| `whataburger under 800 calories` | An 810 cal result under an "under 800" query; 3x Hash Brown Sticks as a meal; Cinnamon Roll + fries as "Classic meal". |
| `low carb taco bell` | Cinnabon Delights in a low-carb order; breakfast tacos + Cinnabon labelled "Double up". |
| `cheapest high protein chipotle` | Best match is a 1,310 cal burrito with double rice and double beans (180g carbs). |
| `chipotle` | "Balanced" is a 1,145 cal sofritas burrito. |
| `high protein panda express` | "Most variety" has 31g protein against 114g for Best match. |
| `cheap meal at mcdonalds under $8` | The $8 cap is not parsed; results are apple slices twice. |
| `high protein wendys` | `no_restaurant` instead of `unknown_restaurant`. |
| `raising canes around 600 calories` | 830 cal with nothing telling the user 600 was unreachable. |
| any fixed menu | Five results with repeated labels; build-your-own returns three. |
| `low calorie mcdonalds` (not in the table) | A lone 15 cal Side Salad as "Just the main". |
| `cheapest burger under 500 calories McDonald's` (not in the table) | "burger" ignored: Sausage Biscuit and Hash Browns returned. |

```
Q: lean mcdonalds ~500 cal
  goals [{"nutrient":"fat_g","direction":"low"}] target 500 budget false
  [Classic meal] 465cal 18p 69c 14f $3.97 :: Hamburger + Vanilla Soft Serve Cone + Apple Slices
  [Double up] 465cal 19p 68c 14f $4.97 :: Hamburger + Vanilla Soft Serve Cone + Side Salad
  [Classic meal] 515cal 20p 70c 18f $4.27 :: Cheeseburger + Vanilla Soft Serve Cone + Apple Slices
  [Double up] 515cal 21p 69c 18f $5.27 :: Cheeseburger + Vanilla Soft Serve Cone + Side Salad
  [Just the main] 350cal 8p 61c 9f $3.49 :: Hotcakes (3 ct)
Q: whataburger under 800 calories
  goals [] target 800 budget false
  [Classic meal] 800cal 12p 127c 27f $7.47 :: Cinnamon Roll + Apple Slices + French Fries (Small)
  [Double up] 790cal 11p 122c 29f $7.97 :: Cinnamon Roll + Hash Brown Sticks (6 ct) + Apple Slices
  [Classic meal] 800cal 21p 99c 36f $9.27 :: Whataburger Jr. + Apple Slices + Onion Rings (Medium)
  [Double up] 810cal 9p 96c 45f $8.97 :: Hash Brown Sticks (6 ct) + Hash Brown Sticks (6 ct) + Hash Brown Sticks (6 ct)
  [Just the main] 770cal 38p 90c 30f $7.49 :: Honey BBQ Chicken Strip Sandwich
Q: low carb taco bell
  goals [{"nutrient":"carbs_g","direction":"low"}] target null budget false
  [Classic meal] 500cal 18p 43c 28f $5.97 :: Cinnabon Delights (2 pc) + Crunchy Taco + Crunchy Taco
  [Just the main] 170cal 8p 14c 9f $2.29 :: Doritos Locos Taco (Nacho Cheese)
  [Just the main] 340cal 16p 28c 18f $4.58 :: Doritos Locos Taco (Nacho Cheese) + Doritos Locos Taco (Nacho Cheese)
  [Classic meal] 560cal 22p 47c 32f $6.97 :: Cinnabon Delights (2 pc) + Crunchy Taco Supreme + Crunchy Taco Supreme
  [Double up] 500cal 14p 53c 26f $6.97 :: Breakfast Soft Taco (Egg) + Breakfast Soft Taco (Egg) + Cinnabon Delights (2 pc)
Q: cheapest high protein chipotle
  goals [{"nutrient":"protein_g","direction":"high"}] target null budget true
  [Best match] 1310cal 73p 180c 36f $9.79 :: Burrito (Flour Tortilla){base} + Chicken{protein} + Brown Rice (Double){rice} + Black Beans (Double){beans} + Cheese{toppings} + Fajita Veggies{toppings}
  [Balanced] 1350cal 98p 163c 37f $14.39 :: Tacos — Crispy Corn (3){base} + Chicken (Double){protein} + White Rice (Double){rice} + Pinto Beans (Double){beans} + Cheese{toppings} + Fajita Veggies{toppings}
  [Most variety] 940cal 49p 111c 33f $10.53 :: Tacos — Soft Flour (3){base} + Carnitas{protein} + Brown Rice{rice} + Black Beans{beans} + Cheese{toppings} + Fajita Veggies{toppings}
Q: chipotle
  goals [] target null budget false
  [Best match] 520cal 45p 63c 12f $9.79 :: Bowl{base} + Chicken{protein} + Brown Rice{rice} + Black Beans{beans}
  [Balanced] 1145cal 42p 184c 29f $9.79 :: Burrito (Flour Tortilla){base} + Sofritas{protein} + Brown Rice (Double){rice} + Black Beans (Double){beans}
  [Most variety] 540cal 35p 62c 17f $10.53 :: Salad{base} + Carnitas{protein} + White Rice{rice} + Pinto Beans{beans}
Q: high protein panda express
  goals [{"nutrient":"protein_g","direction":"high"}] target null budget false
  [Best match] 990cal 114p 37c 42f $12.9 :: Bigger Plate (3 Entrees + 1 Side){base} + Grilled Teriyaki Chicken{entree} + Grilled Teriyaki Chicken{entree} + Grilled Teriyaki Chicken{entree} + Super Greens{side}
  [Balanced] 1170cal 71p 142c 36f $11.1 :: Plate (2 Entrees + 1 Side){base} + Grilled Teriyaki Chicken{entree} + Orange Chicken{entree} + Brown Steamed Rice{side}
  [Most variety] 890cal 31p 101c 41f $9.3 :: Bowl (1 Entree + 1 Side){base} + Kung Pao Chicken{entree} + Chow Mein{side}
Q: cheap meal at mcdonalds under $8
  goals [] target null budget true
  [Classic meal] 280cal 13p 39c 9f $3.67 :: Hamburger + Apple Slices + Apple Slices
  [Classic meal] 330cal 15p 40c 13f $3.97 :: Cheeseburger + Apple Slices + Apple Slices
  [Double up] 315cal 2p 34c 18f $4.77 :: Hash Browns + Hash Browns + Apple Slices
  [Double up] 615cal 30p 68c 26f $4.97 :: Cheeseburger + Cheeseburger + Apple Slices
  [Just the main] 250cal 13p 31c 9f $1.69 :: Hamburger
Q: high protein wendys
  ERROR no_restaurant | No restaurant found in your search. Try something like 'high protein from Chick-fil-A'.
Q: raising canes around 600 calories
  goals [] target 600 budget false
  [Best match] 830cal 38p 55c 54f $10.29 :: 3 Finger Combo{combo} + Coleslaw{side} + Coleslaw{side}
  [Balanced] 840cal 41p 58c 52f $10.29 :: 3 Finger Combo{combo} + Coleslaw{side} + Texas Toast{side}
  [Most variety] 850cal 44p 61c 50f $10.29 :: 3 Finger Combo{combo} + Texas Toast{side} + Texas Toast{side}
Q: high protein chick-fil-a
  goals [{"nutrient":"protein_g","direction":"high"}] target null budget false
  [Just the main] 350cal 42p 29c 13f $8.25 :: Grilled Cool Wrap
  [Double up] 780cal 76p 34c 36f $13.7 :: Chick-fil-A Nuggets (12 ct) + Chick-fil-A Nuggets (12 ct)
  [Just the main] 200cal 38p 2c 5f $7.09 :: Grilled Nuggets (12 ct)
  [Double up] 400cal 76p 4c 10f $14.18 :: Grilled Nuggets (12 ct) + Grilled Nuggets (12 ct)
  [Classic meal] 800cal 57p 83c 33f $12.04 :: Mac & Cheese (Medium) + Grilled Cool Wrap
Q: high protein chick-fil-a around 800 calories
  goals [{"nutrient":"protein_g","direction":"high"}] target 800 budget false
  [Double up] 780cal 80p 66c 28f $15.6 :: Grilled Chicken Club Sandwich + Grilled Cool Wrap
  [Double up] 780cal 76p 34c 36f $13.7 :: Chick-fil-A Nuggets (12 ct) + Chick-fil-A Nuggets (12 ct)
  [Classic meal] 800cal 57p 83c 33f $12.04 :: Mac & Cheese (Medium) + Grilled Cool Wrap
  [Just the main] 430cal 38p 37c 15f $7.35 :: Grilled Chicken Club Sandwich
  [Classic meal] 790cal 51p 85c 29f $11.54 :: Vanilla Milkshake (Small) + Grilled Nuggets (12 ct)
Q: low fat whataburger around 700 calories
  goals [{"nutrient":"fat_g","direction":"low"}] target 700 budget false
  [Classic meal] 640cal 14p 106c 18f $8.97 :: Pancakes (3 ct) + Apple Slices + Apple Slices
  [Classic meal] 690cal 40p 84c 23f $10.47 :: Grilled Chicken Sandwich + Apple Slices + French Fries (Small)
  [Double up] 710cal 32p 84c 28f $9.47 :: Whataburger Jr. + Whataburger Jr. + Apple Slices
  [Double up] 680cal 17p 83c 32f $9.47 :: Hash Brown Sticks (6 ct) + Taquito with Egg & Cheese + Apple Slices
  [Just the main] 490cal 8p 82c 14f $3.49 :: Cinnamon Roll
Q: keto chipotle around 700 cal
  goals [{"nutrient":"carbs_g","direction":"low"}] target 700 budget false
  [Best match] 685cal 56p 17c 43f $15.13 :: Bowl{base} + Carnitas (Double){protein} + Cheese{toppings} + Sour Cream{toppings} + Tomatillo Red-Chili Salsa{salsa} + Fresh Tomato Salsa{salsa}
  [Balanced] 645cal 74p 19c 33f $14.39 :: Salad{base} + Chicken (Double){protein} + Cheese{toppings} + Sour Cream{toppings} + Tomatillo Red-Chili Salsa{salsa} + Fresh Tomato Salsa{salsa}
  [Most variety] 665cal 36p 50c 34f $10.53 :: Tacos — Crispy Corn (3){base} + Carnitas{protein} + Cheese{toppings} + Sour Cream{toppings} + Tomatillo Red-Chili Salsa{salsa} + Fresh Tomato Salsa{salsa}
Q: high protein mcdonalds
  goals [{"nutrient":"protein_g","direction":"high"}] target null budget false
  [Just the main] 740cal 48p 43c 42f $8.39 :: Double Quarter Pounder with Cheese
  [Just the main] 830cal 45p 50c 49f $10.49 :: Chicken McNuggets (20 pc)
  [Double up] 1360cal 75p 92c 76f $17.28 :: Quarter Pounder with Cheese + Chicken McNuggets (20 pc)
  [Classic meal] 1370cal 63p 150c 59f $12.38 :: Double Quarter Pounder with Cheese + Chocolate Shake (Medium)
  [Double up] 1060cal 60p 84c 54f $13.58 :: Quarter Pounder with Cheese + Quarter Pounder with Cheese
Q: taco bell
  goals [] target null budget false
  [Classic meal] 330cal 10p 30c 19f $3.98 :: Cinnabon Delights (2 pc) + Crunchy Taco
  [Just the main] 170cal 8p 13c 9f $1.99 :: Crunchy Taco
  [Just the main] 220cal 5p 30c 10f $1.99 :: Spicy Potato Soft Taco
  [Classic meal] 380cal 7p 47c 20f $3.98 :: Cinnabon Delights (2 pc) + Spicy Potato Soft Taco
  [Double up] 740cal 31p 94c 27f $6.27 :: Bean & Cheese Burrito + Soft Taco (Beef) + Soft Taco (Beef)
Q: low calorie mcdonalds
  goals [{"nutrient":"calories","direction":"low"}] target null budget false
  [Classic meal] 45cal 1p 11c 0f $3.97 :: Side Salad + Apple Slices + Apple Slices
  [Just the main] 15cal 1p 3c 0f $1.99 :: Side Salad
  [Classic meal] 200cal 9p 18c 10f $4.17 :: Chicken McNuggets (4 pc) + Apple Slices + Apple Slices
  [Double up] 315cal 2p 34c 18f $4.77 :: Hash Browns + Hash Browns + Apple Slices
  [Double up] 355cal 18p 24c 20f $5.37 :: Chicken McNuggets (4 pc) + Chicken McNuggets (4 pc) + Apple Slices
Q: high protein raising canes
  goals [{"nutrient":"protein_g","direction":"high"}] target null budget false
  [Best match] 1240cal 72p 92c 68f $14.28 :: Box Combo (4 Fingers){combo} + Texas Toast{side} + Texas Toast{side} + Texas Toast{side} + Extra Chicken Finger{extra}
  [Balanced] 1370cal 69p 114c 74f $14.28 :: Box Combo (4 Fingers){combo} + Coleslaw{side} + Crinkle-Cut Fries{side} + Texas Toast{side} + Extra Chicken Finger{extra}
  [Most variety] 1130cal 45p 111c 54f $13.48 :: Sandwich Combo{combo} + Crinkle-Cut Fries{side} + Extra Chicken Finger{extra}
Q: cheapest burger under 500 calories McDonald's
  goals [] target 500 budget true
  [Classic meal] 505cal 15p 68c 20f $3.97 :: Hamburger + Baked Apple Pie + Apple Slices
  [Classic meal] 515cal 20p 70c 18f $4.27 :: Cheeseburger + Vanilla Soft Serve Cone + Apple Slices
  [Double up] 515cal 26p 66c 18f $4.37 :: Hamburger + Hamburger + Apple Slices
  [Double up] 500cal 7p 64c 23f $5.07 :: Hash Browns + Hash Browns + Vanilla Soft Serve Cone
  [Just the main] 430cal 10p 36c 26f $2.19 :: Sausage Biscuit
```
