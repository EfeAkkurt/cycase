/**
 * Office layout, in metres. One source of truth for the meshes and for the DOM
 * overlay that has to land exactly on the monitor screens.
 *
 * The camera is fixed and seated (docs/PROJECT_CONTEXT.md §3: no walking, no
 * free camera), so these numbers are chosen once for a readable composition
 * rather than tuned at runtime.
 */

export interface MonitorSpec {
  id: 'left' | 'center' | 'right';
  /** Centre of the screen plane. */
  position: [number, number, number];
  /** Y rotation in radians; side monitors toe in toward the seat. */
  rotationY: number;
  /** Visible screen size. */
  screen: { width: number; height: number };
  /** Bezel thickness around the screen. */
  bezel: number;
  /** Pixel size of the DOM surface mapped onto this screen. */
  dom: { width: number; height: number };
}

export const EYE_HEIGHT = 1.18;
export const SEAT_Z = 0.8;

/** Where the fixed camera sits, and what it looks at. */
export const CAMERA = {
  position: [0, EYE_HEIGHT, SEAT_Z] as [number, number, number],
  target: [0, 1.1, -0.42] as [number, number, number],
  /**
   * Wide enough that the room reads either side of the monitors — the scripted
   * colleague has to be visible when she arrives, and a tighter frame crops her
   * against the bezel.
   */
  fov: 54,
};

/**
 * The desk.
 *
 * `height` and `z` are the datum: `Prop` fits `metal_office_desk.glb` by height,
 * so the top surface lands exactly on `height`, and everything on the desk is
 * positioned against it.
 *
 * `width` and `depth` used to be 2.34 and 0.78, and both were wrong — they were
 * a description of a desk nobody had measured. Nothing reads them, so nothing
 * failed; comments derived from them did, and the monitor stands were placed
 * against the wrong back edge.
 *
 * These are the shipped model, measured: the GLB's POSITION accessors are
 * normalised int16 (`KHR_mesh_quantization`) with an identity node scale, so its
 * native size is 2.000 x 0.787 x 0.947 m, and the height fit multiplies that by
 * 0.74 / 0.787. The desk is therefore 1.880 m wide and 0.890 m deep, centred on
 * x = 0 and z = `DESK.z` — so it spans x ±0.940 and z −0.565..+0.325.
 *
 * They are still descriptive rather than load-bearing: the mesh is the GLB, not
 * these numbers. Swap the model and they must be re-measured.
 */
export const DESK = {
  width: 1.88,
  depth: 0.89,
  height: 0.74,
  z: -0.12,
};

/** The desk's back edge, in world z. Where anything standing on it has to stop. */
export const DESK_BACK_EDGE = DESK.z - DESK.depth / 2;

const TOE_IN = 0.42; // radians

/*
 * The monitor array came down 60 mm for the P0.4 staging pass, and it is worth
 * saying why a number this small is here at all.
 *
 * It is more correct: the eye sits at 1.18 m and the screens were centred at
 * 1.12–1.15, which is level with the eye rather than the 10–15 cm below it that
 * a real desk gives you. And it is load-bearing for the staging. The back wall
 * is almost entirely hidden behind these three panels — the only part of it the
 * seated player sees is the band above their top edge — so 60 mm of monitor is
 * about 33 px of extra visible wall right where the window, the shelf and the
 * server bay are, and it is the difference between the colleague's head sphere
 * clearing the right monitor's quad by 3 px and clearing it by 30.
 *
 * Everything downstream derives from these numbers rather than copying them:
 * the DOM projection (`projection.ts`), the spatial alarm (`src/audio/spatial.ts`)
 * and the clearance test all read `MONITORS`.
 */

export const MONITORS: MonitorSpec[] = [
  {
    id: 'left',
    position: [-0.75, 1.06, -0.46],
    rotationY: TOE_IN,
    screen: { width: 0.56, height: 0.33 },
    bezel: 0.016,
    dom: { width: 520, height: 306 },
  },
  {
    id: 'center',
    position: [0, 1.09, -0.54],
    rotationY: 0,
    screen: { width: 0.66, height: 0.385 },
    bezel: 0.018,
    /*
     * 570x333, down from 620x362.
     *
     * The audit's last visual finding is that "monitor content is sharp but too
     * small in the office shot to be the alarm focal point". The interface
     * itself belongs to `src/ui`, and the physical monitor cannot grow without
     * moving the camera and re-deriving every projection in the room — but the
     * DOM *surface* is mapped onto a screen of fixed physical size, so shrinking
     * the surface renders the same interface about 9% larger on the glass. One
     * number, no geometry moved, and a reflow failure is visible in a single
     * screenshot. Checked at 1280x720, where the incident panel is tightest.
     */
    dom: { width: 570, height: 333 },
  },
  {
    id: 'right',
    position: [0.75, 1.06, -0.46],
    rotationY: -TOE_IN,
    screen: { width: 0.56, height: 0.33 },
    bezel: 0.016,
    dom: { width: 520, height: 306 },
  },
];

export const MONITOR_BY_ID = new Map(MONITORS.map((monitor) => [monitor.id, monitor]));

/**
 * The chin, neck and base of one monitor, in that monitor's own local frame —
 * y = 0 at the centre of the screen plane, z = 0 on the glass.
 *
 * Derived here rather than in `Monitors.tsx` because two files need it: the
 * shell that draws the stand, and the cable run in `Workstation.tsx` that has to
 * start at the back of the neck and land on the desk beside the base. Those were
 * independent literals in the previous pass and disagreed by 9 cm, which is how
 * three cables came to hang off the back of the desk in mid-air.
 *
 * Everything is expressed against the two surfaces the stand actually joins: the
 * desk top and the bottom of the panel. Nothing here touches `bezel`,
 * `screen.width` or `screen.height` — the DOM projection, the alarm rim and the
 * focal-hierarchy quad all key off those, and they must not move.
 */
export interface MonitorStand {
  /** Depth of the lower rail below the frame. */
  chinHeight: number;
  /** Local y of the frame's lower edge. */
  panelBottom: number;
  /** Local y of the chin's lower edge — where the neck starts. */
  chinBottom: number;
  /** Local y of the desk surface. */
  deskLocal: number;
  baseHeight: number;
  /** Local y of the top of the base plate. */
  baseTop: number;
  neckHeight: number;
  neckWidth: number;
  neckDepth: number;
  /** Local z of the neck's centre. */
  neckZ: number;
  /** Local z of the base plate's centre; it runs forward of the panel. */
  baseZ: number;
  baseWidth: number;
  baseDepth: number;
  /** Where a cable leaves the back of the neck, in the monitor's local frame. */
  cableAnchor: [number, number, number];
}

export function monitorStand(monitor: MonitorSpec): MonitorStand {
  const outerHeight = monitor.screen.height + monitor.bezel * 2;
  const outerWidth = monitor.screen.width + monitor.bezel * 2;

  const chinHeight = 0.014;
  const panelBottom = -outerHeight / 2;
  const chinBottom = panelBottom - chinHeight;
  const deskLocal = DESK.height - monitor.position[1];
  const baseHeight = 0.013;
  const baseTop = deskLocal + baseHeight;

  /*
   * +0.062 is not a taste number. The base runs forward of the panel the way a
   * monitor base does, and here it has to: the centre monitor sits at z = −0.54
   * and the desk's back edge is at −0.565, so a base centred on the panel hangs
   * 71% of its depth off the back of the desk. At +0.062 with a 0.17 m depth the
   * deepest of the three spans −0.563..−0.393 and is entirely on the desk.
   */
  const baseZ = 0.062;
  const baseDepth = 0.17;
  const neckDepth = 0.03;

  /*
   * A real monitor's neck stands 40–60 mm behind the panel. This one cannot:
   * the centre display sits at z = −0.54 and the desk ends at −0.565, so a neck
   * set that far back is a neck standing in mid-air. −0.008 puts its rear face
   * exactly on the base plate's rear edge — the furthest back it can go and
   * still be supported — which leaves it 4 mm proud of the chin's front face.
   * At 1.3 m that is about 3 px, and it reads as the neck emerging from under
   * the chin rather than as an error.
   */
  const neckZ = baseZ - baseDepth / 2 + neckDepth / 2;

  return {
    chinHeight,
    panelBottom,
    chinBottom,
    deskLocal,
    baseHeight,
    baseTop,
    neckHeight: chinBottom - baseTop,
    neckWidth: 0.056,
    neckDepth,
    neckZ,
    baseZ,
    baseWidth: outerWidth * 0.36,
    baseDepth,
    /** Behind the neck, a little below the hinge. */
    cableAnchor: [0, chinBottom - 0.028, neckZ - neckDepth / 2 - 0.002],
  };
}

export const ROOM = {
  width: 5.2,
  depth: 5.6,
  /**
   * Dropped from 2.70 m for the P0.4 staging pass.
   *
   * 2.52 m is a real suspended-ceiling office height, and it is the difference
   * between a ceiling that exists and a ceiling anyone ever sees: with a 54°
   * vertical FOV from a seat at 1.18 m, the top of the frame climbs at roughly
   * half a metre per metre of depth, so a 2.70 m slab only entered the picture
   * beyond the back wall. At 2.52 m the grid, the troffers and the cable tray
   * are inside the seated cone.
   */
  height: 2.52,
  /** Back wall sits behind the desk; the doorway is at its right-hand end. */
  backZ: -2.2,
  frontZ: 3.4,
};

/**
 * The SOC backdrop, in metres.
 *
 * The audit's first finding is that "the background is dominated by a flat
 * blank wall rather than a believable SOC with window/blinds, ceiling detail,
 * server equipment and working depth". Everything below exists to answer that,
 * and every position is chosen against the seated frame rather than against a
 * plan view — an object outside the cone is not set dressing, it is bytes.
 *
 * The reference (`docs/assets/office-concept-v2-neutral.png`) reads left to
 * right as: acoustic treatment, blinded window, shelving with a plant and a
 * warm lamp, the server bay, the doorway, and a whiteboard. The same order is
 * kept, because that order is what makes the frame legible.
 */
export const BACKDROP = {
  /** Two server cabinets behind the right-hand monitors, LEDs facing the seat. */
  racks: {
    /*
     * Set left of the doorway rather than in front of it. At the seated FOV the
     * cabinets project to screen x 782..1106 and the door frame starts at 1102,
     * so the two are adjacent instead of overlapping — which matters because
     * the colleague walks out of that opening and must not appear from behind
     * a server cabinet.
     */
    positions: [
      [0.62, -1.86] as [number, number],
      [1.3, -1.86] as [number, number],
    ],
    width: 0.62,
    depth: 0.44,
    height: 1.92,
    /** Rows of status LEDs per cabinet; the count is what reads, not the colour. */
    rows: 14,
    perRow: 6,
  },
  /**
   * Blinded window, back wall, left of the monitors.
   *
   * Sized and placed against the seated frame rather than against the room. The
   * three monitors occlude almost the whole back wall below y≈1.35 — measured,
   * the left monitor alone covers screen x 100..480 — so the only back-wall
   * real estate the player can actually see is the band above them. This window
   * is dimensioned to fill the left half of that band: it projects to roughly
   * screen 134..522 across, 85..322 down, of which everything above y=278 is
   * clear of the monitor. Smaller or lower and it would be a window nobody
   * looks at.
   */
  window: {
    position: [-2.0, 1.66, -2.19] as [number, number, number],
    width: 1.14,
    height: 1.12,
    slats: 9,
  },
  /** The doorway the colleague comes through: back wall, right-hand end. */
  door: {
    position: [2.14, 0, -2.18] as [number, number, number],
    width: 0.92,
    height: 2.04,
  },
  /**
   * A wall shelf between the window and the server bay, carrying binders, the
   * plant and a warm lamp.
   *
   * It hangs at 1.75 m rather than standing on the floor, and that is forced by
   * the same projection arithmetic as everything else on this wall: a floor
   * unit's contents land at screen y 400+, squarely behind the left monitor.
   * At 1.75 m its objects occupy screen y 115..175, in the clear band above the
   * monitors — which is the band the audit found empty.
   */
  shelf: {
    position: [-0.72, 1.75, -2.06] as [number, number, number],
    width: 1.22,
    depth: 0.3,
  },
  /** Whiteboard on the right-hand wall, angled into the frame. */
  whiteboard: {
    position: [2.55, 1.5, -0.95] as [number, number, number],
    width: 1.5,
    height: 1.0,
  },
  /** Acoustic treatment: a band of wedge panels on each side wall. */
  /*
   * Trimmed from 5 rows of 0.42 m. At the report framing the right-hand block
   * projected as a two-metre grid of dark slabs across the middle of the
   * picture, competing with the colleague standing in front of it. Treatment
   * belongs at the top of a wall, not down it.
   */
  acoustic: { count: 3, size: 0.34, top: 2.24 },
  /**
   * The rest of the floor, for the three views the widened cone opened up.
   *
   * Until the head-look cone became a chair swivel, everything in this file was
   * staged for one shot: the seated forward view and about 55° either side of
   * it. Nothing was ever placed behind the operator because nothing could ever
   * be seen there — and the room's *front* wall was not drawn at all, so a
   * player who turned far enough was looking at the clear colour through a hole
   * where the fourth wall should be.
   *
   * Each of the three new views is composed in three layers rather than
   * decorated, because a wall with one object against it reads as a wall with
   * one object against it. Distances are from the seat at (0, 1.18, 0.8):
   *
   *   foreground   0.8 - 1.6 m   things at the edge of the desk island
   *   midground    1.6 - 2.6 m   the neighbouring pod, the credenza, the table
   *   background   2.6 - 3.6 m   the walls and what is fixed to them
   */
  rear: {
    /** Glazing band in the rear wall, with the floor beyond it lit. */
    glazing: { bottom: 0.98, top: 2.02, inset: 0.06 },
    /** The rear doorway, off to the left so it does not sit on the view axis. */
    door: { x: -1.62, width: 0.94, height: 2.04 },
    /** Wall-mounted status board: dark glass with a few live rows on it. */
    board: { position: [1.05, 1.62] as [number, number], width: 1.34, height: 0.78, rows: 7 },
    /** The clock every operations room has, and the only round thing in here. */
    clock: { position: [-0.15, 1.94] as [number, number], radius: 0.16 },
    /** Breakout table and its two chairs, the rear midground. */
    table: { position: [-0.35, 2.25] as [number, number], rotationY: 0.18 },
    /** Coat stand: a vertical in the rear-left, where the frame is otherwise flat. */
    coatStand: { position: [-2.22, 1.95] as [number, number], height: 1.72 },
  },
  /**
   * The left-hand wall: a credenza run with storage boxes and binders on it.
   *
   * The left wall carried nothing below the acoustic band, and the acoustic
   * band stops 1.1 m from the back wall — so from about 60° of yaw leftward the
   * player was looking at four metres of bare plaster.
   */
  credenza: {
    units: [
      { position: [-2.24, 0.42] as [number, number], rotationY: Math.PI / 2 },
      { position: [-2.24, 1.34] as [number, number], rotationY: Math.PI / 2 },
    ],
    /**
     * A floor plant between the seat and the run, and the only thing in the
     * left-hand view inside 1.7 m.
     *
     * Placed by measurement rather than by eye. Sweeping the left half of the
     * floor against `createCamera` at yaw 70 — square on to that wall — the
     * whole near-floor band projects *below* the frame: at the seated camera's
     * −3.75° base pitch nothing shorter than about 0.9 m is in shot inside
     * 1.7 m. So the left foreground had to be tall as well as close, which a
     * 1.15 m plant is and a bin, a box or another low cabinet would not have
     * been. Without it the left view is midground and background only, which is
     * the flat read this pass exists to remove.
     */
    plant: { position: [-1.62, 0.62] as [number, number], height: 1.15 },
    /** Archive boxes stacked on top, so the run has a broken silhouette. */
    boxes: [
      { position: [-2.22, 0.98, 0.22] as [number, number, number], scale: 0.3 },
      { position: [-2.2, 0.98, 0.62] as [number, number, number], scale: 0.26 },
      { position: [-2.24, 1.26, 0.24] as [number, number, number], scale: 0.24 },
      { position: [-2.21, 0.98, 1.5] as [number, number, number], scale: 0.28 },
    ],
  },
  /**
   * The neighbouring workstation, on the right.
   *
   * A second desk with a dark, unlit display on it and its chair pushed back —
   * the operator's colleague is standing at *their* desk, not sitting at this
   * one, which is the small piece of story that keeps it from being furniture.
   */
  pod: {
    desk: { position: [2.08, 0.72] as [number, number], rotationY: -Math.PI / 2 },
    chair: { position: [1.52, 0.82] as [number, number], rotationY: -1.9 },
    display: { position: [2.24, 1.06, 0.72] as [number, number, number], width: 0.5, height: 0.3 },
    plant: { position: [2.16, 1.86] as [number, number] },
  },
  /** Suspended ceiling: T-bar grid, two troffers, one cable tray. */
  ceiling: {
    tileX: 4,
    tileZ: 6,
    /*
     * A third fixture, over the rear half of the room.
     *
     * Lit, and it is an emissive plane rather than a light: a `MeshBasicMaterial`
     * costs nothing per fragment, whereas every real light in the scene is paid
     * for by every PBR material in it. The rear of the room needed a *source* in
     * frame — a ceiling with two unlit fixtures over an area the player can now
     * look at reads as a room with the lights off — and it needed one without
     * spending 17% more shading on a frame-rate budget that is already measured.
     * `Lighting` adds exactly one real point light back there to go with it.
     */
    troffers: [
      { position: [0, -0.62] as [number, number], lit: true },
      { position: [1.2, -1.72] as [number, number], lit: false },
      { position: [-0.3, 1.62] as [number, number], lit: true },
    ],
    trayZ: -1.3,
  },
} as const;

/**
 * Where the scripted colleague walks: door -> around the desk -> settles at the
 * right-hand end, still inside frame.
 *
 * She stops *behind* the monitor plane on purpose. The interface is a DOM layer
 * composited over the canvas, so it always paints in front of the 3D — a figure
 * standing between the camera and a screen would appear to be behind the very
 * pixels she is occluding. Keeping her upstage makes that ordering correct.
 *
 * The settle point moved inboard for the audit (P0.3). The previous one put her
 * at 46° off the view axis — past the frame edge at 1440x900, which is why the
 * audit's captures show no colleague at all. `CHARACTER_ANCHORS` below records
 * where her head lands as a consequence, and `tests/e2e/characters.spec.ts`
 * projects it with the scene camera.
 */
export const COLLEAGUE_PATH: [number, number, number][] = [
  /*
   * She starts down the corridor, hidden by the back wall, and walks into the
   * room through the opening the player can see. That is an arrival; a figure
   * resolving out of the dark at the frame edge is not.
   */
  [2.14, 0, -3.40],
  [2.14, 0, -2.44],
  [2.06, 0, -1.98],
  [1.78, 0, -1.46],
  /*
   * The settle point: 2.40 m from the seat, in front of the server bay, and —
   * for the first time — inside the frame the player is actually looking at.
   *
   * ## What was wrong
   *
   * The previous endpoint was (2.15, −0.95), and it was staged against a camera
   * yaw of −17.1°: the office used to hold `DOOR_YAW * 0.45` for the whole of
   * her report, so every clearance number in this file described a shot the
   * player only saw because the camera had turned to find her. Projected at
   * yaw 0 — the framing the office now holds, and the one a recentred or
   * returning player is in — her head landed at screen x 1510..1603 in a
   * 1440-wide frame. She was not "partly occluded"; she was **entirely off the
   * right-hand edge**, and no assertion caught it because
   * `CHARACTER_ANCHORS.colleagueHead` was measured at (1.62, −1.75) — a
   * *waypoint* she walks through, not the point she stops at.
   *
   * ## How this one was chosen
   *
   * By sweep, against `createCamera` — the same projection the app and
   * `tests/e2e/characters.spec.ts` use — evaluated at yaw 0 at every viewport
   * that reaches the 3D path (1920x1080, 1440x900, 1280x720 and 1024-wide, each
   * at a generous and a tight office height). Every candidate had to keep her
   * crown and her face clear of all three monitor quads, keep her head, her
   * shoulders and her head-and-shoulders volume inside the picture with margin,
   * stand clear of the desk and of both server cabinets, and sit between 2.0 and
   * 2.9 m from the seat. Of the positions that qualified, this one puts her head
   * 72% of the way across the frame — beside the right monitor rather than over
   * it — at a conversational 2.40 m.
   *
   * ## What is *not* claimed
   *
   * Her elbow and everything below it is behind the monitor interface, and that
   * is a geometric fact rather than a tuning failure. The DOM panels composite
   * over the canvas and fill the band from screen y≈247 to y≈464 across almost
   * the whole width, so only what stands above world y≈1.29 at this distance is
   * visible in those columns. Her shoulder joint is at world y 1.017 and her arm
   * is 0.53 m long, so no natural pose puts the elbow above that line. What the
   * staging does guarantee, measured: crown, face, shoulders, upper torso, and
   * the raised forearm and hand that carry the pointing beat.
   */
  [1.01, 0, -1.38],
];

/**
 * Scene palette. Warm-neutral by construction (`r >= g >= b` on every surface),
 * for the reasons in `docs/VISUAL_RESET.md`. Lighting colours matter as much as
 * material colours here: a blue key light washes a warm room cold no matter
 * what the albedo says.
 */
export const PALETTE = {
  void: '#0b0a09',
  surface: '#131110',
  surfaceRaised: '#1c1917',
  metal: '#25211e',
  shell: '#161311',
  screenOff: '#0d0b0a',
  accent: '#c8a26a',
  critical: '#e2604e',
  warning: '#d99a2b',
  success: '#7e9464',
  skin: '#b98a6a',
  cloth: '#3a322c',
  trousers: '#2a2320',
  hair: '#241d1b',

  /*
   * Backdrop surfaces.
   *
   * Desaturated for the closeout pass, and desaturated *toward the grey of
   * their own luminance* rather than simply darkened — every value below has
   * the same luma it had before. That is deliberate: the four-view gate holds a
   * mean-luminance floor of 22 with the rear limit sitting at 23.5, so a pass
   * that neutralised the room by taking light out of it would have traded one
   * failure for another.
   *
   * What was wrong: measured against `docs/assets/office-concept-v2-neutral.png`
   * the room read at 40% mean saturation to the reference's 29%, and the
   * blinds alone at 73% to the reference's 9%. The reference is a grey office
   * with warm *pools* in it. Dressing is now near-neutral and the warmth is
   * spent only where a fixture is actually visible.
   */
  /*
   * Lifted out of crush. Measured against the reference the build put 35% of
   * the frame below luma 8 to the reference's 15.9%, while sitting 2.1 units
   * BRIGHTER on the mean — the picture was not dark, it was bimodal, with a hot
   * wall against black holes and nothing in between. These are the mid-tones
   * the reference lives in, and every gate moves the safe way: mean up,
   * dark share down, very-dark share down, bands up.
   */
  rackShell: '#2c2a28',
  rackMesh: '#191817',
  rackRail: '#2d2a28',
  /** A rack LED is a light. It stays amber. */
  ledDim: '#6f5624',
  ledLive: '#d99a2b',
  /**
   * Sodium street light through the blinds. Still warm, but it was rendering at
   * 68% saturation and reading as a sheet of orange at the frame edge rather
   * than as a dim view of a street.
   */
  streetGlow: '#695844',
  /** Corridor light through the doorway — a visible fixture, so still warm. */
  doorGlow: '#715e48',
  whiteboard: '#b0aba3',
  marker: '#4c463f',
  ceilingTile: '#433f3c',
  /**
   * The lit face of the troffer, which used to borrow the *tile* colour and so
   * glowed the colour of unlit ceiling board. A 4000 K office fixture is very
   * nearly white, and it is the one thing in the room that should read cool
   * against the practicals.
   */
  trofferGlow: '#d8d5cf',
  ceilingRail: '#2b2724',
  acousticFoam: '#2b2927',
  binder: '#46403b',
};

/**
 * Light colours, kept separate so the warm/cool audit has one place to look.
 *
 * Re-neutralised for the P0.4 staging pass. The previous set put a warm cast on
 * *every* term — ambient, hemisphere and both fills — and the result was a room
 * lit like a sodium street rather than the neutral grey office in
 * `docs/assets/office-concept-v2-neutral.png`. The reference is a grey room
 * with warm *pools* in it; that is a different picture from an orange room.
 *
 * So the general illumination is now nearly achromatic (a couple of points of
 * red over blue, no more) and the warmth is spent only where a real fixture is
 * visible: the desk lamp, the wall sconce, the corridor beyond the door. The
 * no-cool-hues gate in `tests/e2e/palette.spec.ts` is unaffected — it fires on
 * `b - r > 18`, and a neutral grey has `b - r = 0`.
 */
export const LIGHTS = {
  /*
   * Achromatic general illumination.
   *
   * The previous set was *nearly* neutral — a few points of red over blue on
   * ambient, hemisphere and both fills. A few points on one surface is nothing;
   * a few points on every surface in the frame is a cast, and measured against
   * the reference that is exactly what it was: 40% mean saturation to the
   * reference's 29%.
   *
   * Each value below is the grey of the same luminance as the value it
   * replaced, so the mean-luminance floors in `office-visibility.spec.ts` and
   * `headlook.spec.ts` see no change. Warmth is now spent only through
   * `practical`, which is a lamp the player can see.
   */
  ambient: '#636363',
  hemiSky: '#515151',
  hemiGround: '#0a0a0a',
  /**
   * The desk lamp and the corridor fixture. The one warm term, deliberately —
   * but it was `#f0ab63`, R-B 141, which is a sodium street lamp rather than
   * anything anyone puts on a desk, and it was six times more saturated than
   * any other light in the room. At 2700 K it is still unmistakably a warm
   * bulb; it just stops painting the whole foreground. Rec.601 luma 183.9
   * against the old 183.4, so no luminance gate can move.
   */
  practical: '#d9b185',
  /** Monitors show a dark neutral interface; their spill is grey, not amber. */
  screenSpill: '#949494',
  alertSpill: '#e2604e',
  fill: '#515151',
  /** Overhead troffer: a 4000 K office fixture, barely off neutral. */
  ceilingPanel: '#efe6d6',
  /**
   * The key that lifts the colleague off the back wall while she reports. Kept
   * a little warm — it reads as the desk lamp reaching her — but pulled well
   * back from the amber it was.
   */
  characterKey: '#d8cfc2',
  /** Cool-free rim: a bounce off the plaster wall behind her, not a blue edge. */
  characterRim: '#a2a2a2',
};

/** CC0 assets loaded at runtime. Paths are relative to `public/`. */
export const MODEL_FILES = {
  desk: '/models/metal_office_desk.glb',
  chair: '/models/modern_arm_chair_01.glb',
  cabinet: '/models/drawer_cabinet.glb',
  rack: '/models/worn_metal_rack.glb',
  lamp: '/models/desk_lamp_arm_01.glb',
  notepads: '/models/office_notepads.glb',
  stationery: '/models/stationery_supplies.glb',
  thermos: '/models/plastic_thermos.glb',
  plant: '/models/potted_plant_01.glb',
  bin: '/models/metal_trash_can.glb',
} as const;

export const TEXTURE_FILES = {
  floor: {
    map: '/textures/concrete_floor_02_diff.webp',
    normalMap: '/textures/concrete_floor_02_nor.webp',
    armMap: '/textures/concrete_floor_02_arm.webp',
    repeat: 3,
  },
  wall: {
    map: '/textures/painted_plaster_wall_diff.webp',
    normalMap: '/textures/painted_plaster_wall_nor.webp',
    armMap: '/textures/painted_plaster_wall_arm.webp',
    repeat: 2.5,
  },
  hardware: {
    map: '/textures/metal_plate_diff.webp',
    normalMap: '/textures/metal_plate_nor.webp',
    armMap: '/textures/metal_plate_arm.webp',
    repeat: 1.5,
  },
} as const;

/* ------------------------------------------------------------------ *
 * Characters (audit P0.3)
 * ------------------------------------------------------------------ */

/** The rigged CC0 colleague. Licence and provenance: `ASSET_LICENSES.md`. */
export const CHARACTER_FILES = {
  colleague: '/models/colleague_suit_female.glb',
} as const;

/**
 * Clip names inside `colleague_suit_female.glb`.
 *
 * `scripts/fetch-assets.mjs` keeps exactly these two and drops the pack's
 * other fifteen, and it fails the import if either is missing — so a rename
 * upstream is a build error rather than a character standing still.
 */
export const COLLEAGUE_CLIPS = { idle: 'Idle', walk: 'Walk' } as const;

/** Standing height in metres, used to fit the imported rig to the room. */
export const COLLEAGUE_HEIGHT = 1.7;

/**
 * Where each character has to stay legible.
 *
 * These are the points `tests/e2e/characters.spec.ts` projects with the scene
 * camera to prove the audit's "readable at 1440x900 and 1280x720 without
 * overlapping monitor DOM". They are world spheres, not silhouettes: the
 * assistant's head, and her head-and-shoulders. Her lower torso
 * *does* pass behind the right monitor's surface, which is the correct reading
 * — she stands upstage of the glass and the interface occludes her, exactly as
 * the `COLLEAGUE_PATH` note above describes.
 */
export const CHARACTER_ANCHORS = {
  /**
   * Her face and collar at the settle point — the lit band, not the crown.
   *
   * A narrow band, found by measuring rather than guessing. Her hair is the
   * darkest material on the model and sits against an equally dark rack, so a
   * sphere on it moves 2% with her standing in it and is useless as evidence.
   * The lit part is her face and collar, and at radius 0.17 a sphere there
   * projected into the right monitor's DOM surface. 1.43 at radius 0.12 is on
   * the lit material and clear of the glass.
   *
   * The x and z now track `COLLEAGUE_PATH`'s **last** point rather than its
   * fourth. That was the defect: this anchor described (1.62, −1.75), which is
   * a waypoint she walks through on the way in, so the clearance test proved a
   * claim about a position she does not stop at while she stood off-frame.
   */
  colleagueHead: { position: [1.01, 1.43, -1.38] as [number, number, number], radius: 0.12 },
  /**
   * The crown of her head: hair and skull, the part that must never be behind
   * the interface.
   *
   * 1.56 is measured, not derived. Her rig's bind-pose `Box3` reports 1.70 m,
   * but a skinned mesh's bounding box is the bind volume rather than the posed
   * one; the top of her hair actually sits at world y 1.56, established by
   * tagging her hair material a colour nothing else in the room uses and
   * reading the tagged pixels back through the scene camera.
   */
  colleagueCrown: { position: [1.01, 1.56, -1.38] as [number, number, number], radius: 0.11 },
  /**
   * Head and shoulders: required to be inside the picture at every review size,
   * and — unlike the two above — *not* required to clear the monitors. She
   * stands behind a desk carrying three panels; the lower half of this volume
   * is legitimately behind them.
   */
  colleagueBust: { position: [1.01, 1.22, -1.38] as [number, number, number], radius: 0.34 },
  /**
   * Where her pointing hand has to arrive.
   *
   * Not a pose the animation guesses at — `Colleague.tsx` drives the arm to it
   * and `characters.spec.ts` reads the *actual* `FistR` bone back out of the
   * live skeleton and compares. The value here is the target the joint angles
   * were solved for, measured by posing the real rig headlessly: it is the one
   * part of the gesture that clears the glass, so it is the part that is
   * asserted.
   */
  colleaguePoint: { position: [0.98, 1.27, -1.24] as [number, number, number], radius: 0.09 },
} as const;

/**
 * Character surface colours.
 *
 * The imported rig ships seven flat materials with no textures and no vertex
 * colours, so retargeting them by name is exact rather than approximate. It is
 * also required: the pack's belt colour carries more blue than red and would
 * trip the no-cool-hues gate in `tests/e2e/palette.spec.ts` on sight.
 */
export const CHARACTER_PALETTE: Record<string, string> = {
  Skin: '#c4956f',
  Face: '#cfa88a',
  /*
   * Every value below is lifted from the previous pass, and not for taste.
   * The audit found her "flat-shaded, mostly black … so the 'out of breath /
   * urgent report' beat is not readable". Half of that is lighting, fixed by
   * the character key and rim in `OfficeScene`; the other half is albedo. A
   * 0x24 hair and a 0x2a trouser have nothing for a key light to return, so
   * she read as a silhouette however hard she was lit. These sit in the range
   * a mid-grey card would, and stay warm-neutral (`r >= g >= b`) for the
   * colour gate.
   */
  Hair: '#3a2f26',
  Shirt: '#b0a494',
  Black: '#453b33',
  Belt: '#443a31',
  Details: '#574b41',
};

