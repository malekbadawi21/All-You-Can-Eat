"use client";

import { useMemo, useState } from "react";
import * as THREE from "three";
import type { RestaurantPlacement, RoofStyle } from "@/lib/restaurants";
import type { OrderResult } from "@/lib/searchResult";
import { useSignTexture } from "./signTexture";
import { wasDrag } from "./pointerState";
import ShopfrontGlass, { glassLayout } from "./ShopfrontGlass";

// ── One restaurant building ──────────────────────────────────────────────────
//
// Authored entirely in local space with the front face pointing toward +X, so
// the same component serves both sides of the street: left-hand buildings drop
// in as-is, right-hand ones are the identical model turned 180°. Writing a
// mirrored variant would double the maintenance for no visual gain.
//
// Local axes, consistently:
//   +X  out toward the road (the front)
//   +Y  up
//   ±Z  along the street (so `width` is the frontage)

const GLASS = "#BCD9E8";
const DOOR_FRAME = "#4A3C33";

/** Height of the lettering panel on a sign board, in world units. */
const SIGN_PANEL_HEIGHT = 1.45;

/**
 * A four-sided pyramid, scaled to a rectangular footprint.
 *
 * A cone with 4 radial segments is a pyramid with a square base whose corners
 * sit on the circumscribed circle. Turning it 45° lines those corners up with
 * the building's own axes, and because the base side is then `radius * √2`,
 * dividing by √2 makes the scale factors read as plain spans.
 */
function PyramidRoof({
  spanX,
  spanZ,
  rise,
  base,
  color,
  overhang = 1.12,
}: {
  spanX: number;
  spanZ: number;
  rise: number;
  base: number;
  color: string;
  overhang?: number;
}) {
  return (
    <mesh
      position={[0, base + rise / 2, 0]}
      rotation={[0, Math.PI / 4, 0]}
      scale={[
        (spanX * overhang) / Math.SQRT2,
        rise,
        (spanZ * overhang) / Math.SQRT2,
      ]}
      castShadow
      receiveShadow
    >
      <coneGeometry args={[1, 1, 4]} />
      <meshStandardMaterial color={color} roughness={1} metalness={0} flatShading />
    </mesh>
  );
}

/**
 * A closed triangular prism — the gable and the A-frame.
 *
 * Built by extruding a triangle rather than by tilting two boxes, because an
 * extrusion is a solid: it comes with its end caps already on. Two tilted
 * boxes leave a triangular hole at each end that you can see straight through
 * from further down the street.
 *
 * The shape is drawn in XY and extruded along +Z, so the mesh is turned -90°
 * about Y to send that extrusion down the building's depth instead. The result
 * is a gable whose triangle faces the street — the classic storefront front,
 * and far more recognisable in silhouette than a ridge seen end-on.
 */
function TriangularRoof({
  span,
  rise,
  length,
  base,
  color,
}: {
  span: number;
  rise: number;
  length: number;
  base: number;
  color: string;
}) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-span / 2, 0);
    s.lineTo(span / 2, 0);
    s.lineTo(0, rise);
    s.closePath();
    return s;
  }, [span, rise]);

  return (
    <mesh
      // Extrusion runs from local z=0 to z=length, and the -90° turn maps
      // local +Z onto world -X. So the prism grows *backwards* from its anchor,
      // and the anchor has to start half a length forward to end up centred.
      position={[length / 2, base, 0]}
      rotation={[0, -Math.PI / 2, 0]}
      castShadow
      receiveShadow
    >
      <extrudeGeometry args={[shape, { depth: length, bevelEnabled: false }]} />
      <meshStandardMaterial color={color} roughness={1} metalness={0} flatShading />
    </mesh>
  );
}

function Roof({
  style,
  width,
  depth,
  height,
  color,
}: {
  style: RoofStyle;
  width: number;
  depth: number;
  height: number;
  color: string;
}) {
  switch (style) {
    case "hip":
      return (
        <PyramidRoof spanX={depth} spanZ={width} rise={2.6} base={height} color={color} />
      );

    case "flat":
      // A parapet: a thin slab a touch wider than the body, which is what
      // gives a flat-roofed box its crisp shadow line along the top.
      return (
        <mesh position={[0, height + 0.35, 0]} castShadow receiveShadow>
          <boxGeometry args={[depth * 1.06, 0.7, width * 1.06]} />
          <meshStandardMaterial color={color} roughness={1} metalness={0} flatShading />
        </mesh>
      );

    case "gable":
      return (
        <TriangularRoof
          span={width * 1.06}
          rise={3}
          length={depth * 1.06}
          base={height}
          color={color}
        />
      );

    case "pagoda":
      // Two shallow tiers. The stack, not the pitch, is what reads as pagoda.
      return (
        <group>
          <PyramidRoof
            spanX={depth}
            spanZ={width}
            rise={1.5}
            base={height}
            color={color}
            overhang={1.3}
          />
          <PyramidRoof
            spanX={depth * 0.62}
            spanZ={width * 0.62}
            rise={1.4}
            base={height + 1.7}
            color={color}
            overhang={1.3}
          />
        </group>
      );

    case "aframe":
      // Whataburger's real architecture. The roof *is* the building, so it
      // starts at the ground and there is no box body underneath.
      return (
        <TriangularRoof
          span={width}
          rise={height * 2.1}
          length={depth}
          base={0}
          color={color}
        />
      );
  }
}

/** Width of the doorway, before `spread` narrows it. */
const DOOR_WIDTH = 3.4;

/** Door, glazing, awning and signage — everything that sits on the front face. */
function Facade({
  name,
  width,
  depth,
  height,
  brand,
  trim,
  ink,
  results,
  boardMessage,
  spread = 1,
}: {
  name: string;
  width: number;
  depth: number;
  height: number;
  brand: string;
  trim: string;
  ink: string;
  results: OrderResult[] | null;
  boardMessage: string;
  /**
   * Shrinks everything laterally. An A-frame's front is a triangle, so a
   * full-width shopfront would push straight out through its sloping sides —
   * pulling it in keeps everything inside the silhouette.
   */
  spread?: number;
}) {
  // Everything here is pushed a little proud of the wall. Coplanar surfaces
  // z-fight: the depth buffer can't rank them, so they flicker as you move.
  const face = depth / 2;
  const frontage = width * spread;
  const doorWidth = DOOR_WIDTH * spread;
  const signWidth = width * 0.6 * spread;
  const letterWidth = signWidth * 0.87;

  // The door takes one end of the frontage and the glazed bays fill the rest.
  // A centred door leaves two gaps, and three results need three surfaces —
  // pushing it to the end is both the layout that works and the way actual
  // shopfronts are built.
  const doorZ = -frontage / 2 + doorWidth / 2 + 0.4;
  const layout = glassLayout(frontage, doorWidth);

  // The texture is cut to the quad's proportions so the name is never stretched.
  const signTexture = useSignTexture(name, ink, letterWidth / SIGN_PANEL_HEIGHT);

  return (
    <group>
      {/* Doorway surround */}
      <mesh position={[face + 0.05, 1.75, doorZ]} castShadow>
        <boxGeometry args={[0.3, 3.5, doorWidth]} />
        <meshStandardMaterial color={DOOR_FRAME} roughness={1} metalness={0} />
      </mesh>
      {/* Glass in the door */}
      <mesh position={[face + 0.22, 1.75, doorZ]}>
        <boxGeometry args={[0.12, 2.9, doorWidth * 0.79]} />
        <meshStandardMaterial color={GLASS} roughness={0.4} metalness={0} />
      </mesh>

      {/* The three glazed bays that carry search results. */}
      <ShopfrontGlass
        layout={layout}
        faceX={face}
        brand={brand}
        ink={ink}
        results={results}
        message={boardMessage}
      />

      {/* Awning — a slab tipped forward over the shopfront. The tilt is what
          reads as "awning" rather than "ledge". Sits above the glazing so it
          shades the bays instead of cutting across them. */}
      <mesh
        position={[face + 0.7, layout.y + layout.height / 2 + 0.55, 0]}
        rotation={[0, 0, 0.32]}
        castShadow
      >
        <boxGeometry args={[1.7, 0.26, frontage * 0.92]} />
        <meshStandardMaterial color={trim} roughness={1} metalness={0} flatShading />
      </mesh>

      {/* Sign board: a trim-coloured surround with a brand-coloured face. */}
      <mesh position={[face + 0.2, height * 0.74, 0]} castShadow>
        <boxGeometry args={[0.35, 1.9, signWidth]} />
        <meshStandardMaterial color={trim} roughness={1} metalness={0} flatShading />
      </mesh>
      <mesh position={[face + 0.42, height * 0.74, 0]}>
        <boxGeometry args={[0.12, SIGN_PANEL_HEIGHT, letterWidth]} />
        <meshStandardMaterial color={brand} roughness={1} metalness={0} flatShading />
      </mesh>

      {/* The name. A plane is authored facing +Z, so a quarter turn about Y
          aims it out at the road — which also lands its +U direction along -Z,
          exactly where a viewer standing on the road has their right hand, so
          the lettering reads forwards rather than mirrored.

          `toneMapped={false}` keeps the ink at the colour it was authored;
          basic material because a sign should not darken in shadow. */}
      {signTexture && (
        <mesh position={[face + 0.5, height * 0.74, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[letterWidth, SIGN_PANEL_HEIGHT]} />
          <meshBasicMaterial map={signTexture} transparent toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

interface StorefrontProps {
  placement: RestaurantPlacement;
  /** Only free roam lets you click a building; home mode ignores the scene. */
  selectable: boolean;
  onSelect: (slug: string) => void;
  /** Orders to show on this restaurant's boards, or null while idle. */
  results: OrderResult[] | null;
  /** Board text when there is nothing to show. */
  boardMessage: string;
}

export default function Storefront({
  placement,
  selectable,
  onSelect,
  results,
  boardMessage,
}: StorefrontProps) {
  const { name, brand, trim, ink, roof, width, depth, height, position, rotation } =
    placement;
  const [hovered, setHovered] = useState(false);

  // An A-frame has no walls to speak of — its roof reaches the ground — so it
  // skips the body box entirely rather than hiding one inside.
  const hasBody = roof !== "aframe";

  // Hover is a cursor change plus a slight lift in the body colour. Emissive
  // rather than a scale change: nudging the geometry would make the building
  // visibly detach from its own shadow.
  const highlight = selectable && hovered;

  return (
    <group
      position={position}
      rotation={[0, rotation, 0]}
      onPointerOver={(e) => {
        if (!selectable) return;
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        if (!selectable) return;
        // Dragging to look around ends in a `click` just like a tap does, so
        // without this guard every look-around flies you into a building.
        if (wasDrag()) return;
        e.stopPropagation();
        document.body.style.cursor = "";
        onSelect(placement.slug);
      }}
    >
      {hasBody && (
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[depth, height, width]} />
          <meshStandardMaterial
            color={brand}
            roughness={1}
            metalness={0}
            flatShading
            emissive={brand}
            emissiveIntensity={highlight ? 0.32 : 0}
          />
        </mesh>
      )}

      <Roof
        style={roof}
        width={width}
        depth={depth}
        height={height}
        color={roof === "aframe" ? brand : trim}
      />

      <Facade
        name={name}
        width={width}
        depth={depth}
        height={hasBody ? height : height * 1.2}
        brand={brand}
        trim={trim}
        ink={ink}
        results={results}
        boardMessage={boardMessage}
        // The A-frame narrows as it rises, so its shopfront has to pull in
        // further than the awning alone needed — the outer bays would
        // otherwise poke through the sloping sides.
        spread={hasBody ? 1 : 0.5}
      />
    </group>
  );
}
