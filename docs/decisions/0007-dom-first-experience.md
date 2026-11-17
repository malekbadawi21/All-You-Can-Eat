# 0007 — The page works without the 3D scene; the scene is an enhancement

**Status:** accepted · 2026-11-16

## The problem

Results existed only as pixels on WebGL textures. A screen reader could not
reach them, the text could not be selected, there was no item detail, results
4–5 were never shown, and nothing worked without WebGL. The storefront search
replaced the previous search instead of refining it, and a storefront had no
URL.

## The decision

**1. Everything is DOM first.** The order cards in the panel are the result.
The boards in the storefront windows show the first three of the same orders,
as a visual echo; nothing is *only* in the 3D layer. Hovering or focusing a
card lights the matching window, which is the one link between the two.

**2. The scene is optional, and loaded as such.** A flat SVG street
(`StaticStreet`) is always rendered underneath. It is the loading state while
the 3D bundle downloads, the fallback when WebGL is unavailable or the context
is lost, and the picture in the server-rendered HTML. Every flow — search,
visit, refine, go back — is written to work when the camera does not exist.

**3. Both pages render one client component** (`Experience`). `/` and
`/restaurant/[slug]` differ only in where it starts. Moving between them
happens inside the component, with `history.pushState` keeping the address bar
in step (Next's router understands this without swapping the page). That is
what lets the camera *fly* between a storefront and the street instead of the
canvas being torn down and rebuilt.

**4. `/restaurant/[slug]?q=…` runs its search on the server.** The orders are
in the HTML that arrives, so a link works for a crawler, a screen reader and a
browser with JavaScript off. `q` is the canonical criteria text (ADR 0004), so
a link restores a search exactly.

**5. The conversation is a panel, not a modal.** Docked right on a wide screen,
a bottom sheet on a phone that can be lowered to look at the building. What is
in force is always visible as removable chips. The camera frames the storefront
in whatever space the panel leaves, using a *lens shift* rather than by aiming
off-centre, so the building stays square.

**6. The canvas renders on demand.** A parked camera looking at a static street
redraws nothing. Frames are drawn only while something moves.

**7. Reduced motion means arriving, not travelling.** With
`prefers-reduced-motion`, flights complete instantly and CSS animation is off.

## Alternatives rejected

- **Results as HTML projected into the scene** (drei `<Html>`). Accessible in
  principle, but positioned by the camera: on a phone the boards are 60px wide.
- **Separate pages with full navigation.** Simple, and loses the flight, which
  is the product's one piece of theatre.
- **A modal chat over the scene.** Hides the storefront the conversation is
  about.

## What it costs

`Experience` is a large component: it is the one place where the URL, the
camera and the conversation meet. The pieces it coordinates are each small and
know nothing of each other.
