/**
 * Real-time drop-network scene for the public homepage: deceived clients send
 * money to drop accounts, the drops forward it to one organiser, and from there
 * it leaves as cash. Saq Bol's steps change the scene: the organiser's hub is
 * found (stage 1), one client's transfer is held under a shield (stage 2) and
 * new transfers into the flagged hub stop at its ring (stage 3).
 *
 * Loaded with import() only on devices that passed lib/fx-tier.ts. All geometry
 * is generated here (no model files). Colours follow bcc.kz: #00AB75 green,
 * #1D1D1E ink, #F5F5FA canvas.
 */
import {
  AmbientLight, BoxGeometry, CapsuleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight,
  InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry,
  QuadraticBezierCurve3, RingGeometry, Scene, ShadowMaterial, SphereGeometry, SRGBColorSpace, TorusGeometry, TubeGeometry,
  Vector3, WebGLRenderer,
} from "three";
import { FrameWatch } from "@/lib/fx-tier";

export type DropStage = 0 | 1 | 2 | 3;
export type DropScene = {
  setStage: (stage: DropStage) => void;
  setPointer: (x: number, y: number) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
};
type Options = { canvas: HTMLCanvasElement; watchFrames: boolean; onSlow: () => void; onReady: () => void };

const GREEN = new Color("#00AB75");
const INK = new Color("#1D1D1E");
const DROP = new Color("#56565A");
const RED = new Color("#D92D3A");
const LINE = new Color("#C9CAD1");
const COIN = new Color("#00AB75");
const HELD = new Color("#BFE7D7");
const IDLE_SCREEN = new Color("#9A9BA1");

/** Ground positions (x, z). The held client is index 2, the one in the story. */
const CLIENTS: [number, number][] = [[-5.4, -2.5], [-5.9, -1.25], [-6.1, 0], [-5.9, 1.25], [-5.4, 2.5]];
const DROPS: [number, number][] = [[-1.7, -1.9], [-1.4, 0], [-1.7, 1.9]];
const HUB: [number, number] = [1.9, 0];
const CASH: [number, number] = [5.2, 0];
const ROUTE = [0, 0, 1, 2, 2]; // client → drop
const HELD_CLIENT = 2;
const HAND = 0.95; // height money leaves and arrives at

function arc(from: [number, number], to: [number, number], lift: number) {
  const a = new Vector3(from[0], HAND, from[1]); const b = new Vector3(to[0], HAND, to[1]);
  const mid = a.clone().lerp(b, .5); mid.y += lift;
  return new QuadraticBezierCurve3(a, mid, b);
}

/** A stylised person: capsule body and sphere head, both casting shadows. */
function person(color: Color, scale = 1) {
  const group = new Group();
  const material = new MeshStandardMaterial({ color, roughness: .55, metalness: .05 });
  const body = new Mesh(new CapsuleGeometry(.28, .62, 6, 16), material);
  body.position.y = .62; body.castShadow = true;
  const head = new Mesh(new SphereGeometry(.24, 24, 16), material);
  head.position.y = 1.38; head.castShadow = true;
  group.add(body, head); group.scale.setScalar(scale);
  return { group, material };
}

export function mountDropScene({ canvas, watchFrames, onSlow, onReady }: Options): DropScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, .1, 100);
  scene.add(new HemisphereLight(0xffffff, 0xdfe3ea, 1.6));
  scene.add(new AmbientLight(0xffffff, .35));
  const sun = new DirectionalLight(0xffffff, 2.3);
  sun.position.set(-4, 10, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.radius = 6;
  scene.add(sun);

  const ground = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: .13 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // Centre the network (clients at x≈-6, cash machine at x≈5).
  const world = new Group(); world.position.x = .45; scene.add(world);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T) => { disposables.push(item); return item; };

  // People
  const clients = CLIENTS.map(([x, z]) => { const p = person(GREEN, .92); p.group.position.set(x, 0, z); world.add(p.group); return p; });
  const drops = DROPS.map(([x, z]) => { const p = person(DROP); p.group.position.set(x, 0, z); world.add(p.group); return p; });
  const pedestal = new Mesh(track(new CylinderGeometry(.75, .82, .28, 40)), track(new MeshStandardMaterial({ color: 0xffffff, roughness: .4 })));
  pedestal.position.set(HUB[0], .14, HUB[1]); pedestal.castShadow = true; pedestal.receiveShadow = true; world.add(pedestal);
  const hub = person(INK, 1.12); hub.group.position.set(HUB[0], .28, HUB[1]); world.add(hub.group);

  // Cash machine: graphite body with a lit green screen.
  const atm = new Group();
  const atmBody = new Mesh(track(new BoxGeometry(.95, 1.75, .7)), track(new MeshStandardMaterial({ color: 0x3a3a3b, roughness: .45, metalness: .2 })));
  atmBody.position.y = .875; atmBody.castShadow = true;
  const screenMat = track(new MeshBasicMaterial({ color: GREEN }));
  const screen = new Mesh(track(new PlaneGeometry(.6, .38)), screenMat);
  screen.position.set(-.48, 1.3, 0); screen.rotation.y = -Math.PI / 2;
  atm.add(atmBody, screen); atm.position.set(CASH[0], 0, CASH[1]); world.add(atm);

  // Money routes
  const toDrop = CLIENTS.map((c, i) => arc(c, DROPS[ROUTE[i]], 1.1));
  const toHub = DROPS.map(d => arc(d, HUB, 1.25));
  const toCash = arc(HUB, CASH, 1.2);
  const tubeMat = (color: Color) => track(new MeshStandardMaterial({ color, roughness: .6, transparent: true, opacity: .9 }));
  const lineMats = { client: tubeMat(LINE), hub: tubeMat(LINE), cash: tubeMat(LINE) };
  const tube = (curve: QuadraticBezierCurve3, material: MeshStandardMaterial) => {
    const mesh = new Mesh(track(new TubeGeometry(curve, 48, .022, 6)), material); world.add(mesh); return mesh;
  };
  toDrop.forEach(curve => tube(curve, lineMats.client));
  toHub.forEach(curve => tube(curve, lineMats.hub));
  tube(toCash, lineMats.cash);

  // Detection rings around the hub and the held client's shield.
  const ringMat = track(new MeshBasicMaterial({ color: RED, transparent: true, opacity: 0, side: DoubleSide }));
  const rings = [0, 1, 2].map(() => { const r = new Mesh(track(new RingGeometry(.9, 1.0, 64)), ringMat.clone()); track(r.material); r.rotation.x = -Math.PI / 2; r.position.set(HUB[0], .3, HUB[1]); world.add(r); return r; });
  const gate = new Mesh(track(new TorusGeometry(1.05, .045, 12, 64)), track(new MeshStandardMaterial({ color: RED, emissive: RED, emissiveIntensity: .4, transparent: true, opacity: 0 })));
  gate.rotation.x = Math.PI / 2; gate.position.set(HUB[0], HAND, HUB[1]); world.add(gate);
  const shieldMat = track(new MeshStandardMaterial({ color: GREEN, transparent: true, opacity: 0, roughness: .15, metalness: .1, side: DoubleSide, depthWrite: false }));
  const shield = new Mesh(track(new SphereGeometry(1.15, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2)), shieldMat);
  shield.position.set(CLIENTS[HELD_CLIENT][0], 0, CLIENTS[HELD_CLIENT][1]); world.add(shield);

  // Coins: three per client, staggered along client → drop → hub → cash.
  const coinGeo = track(new CylinderGeometry(.13, .13, .04, 24));
  const coinMat = track(new MeshStandardMaterial({ color: 0xffffff, roughness: .3, metalness: .55 }));
  const perClient = 3; const total = CLIENTS.length * perClient;
  const coins = new InstancedMesh(coinGeo, coinMat, total);
  coins.castShadow = true; world.add(coins);
  const offsets = Array.from({ length: total }, (_, i) => (i % perClient) / perClient + (Math.floor(i / perClient) * .137) % 1);
  const dummy = new Object3D();
  const colour = new Color();

  const mix = { hub: 0, held: 0, gate: 0 };
  let target = { hub: 0, held: 0, gate: 0 };
  let pointer = { x: 0, y: 0 }; const eased = { x: 0, y: 0 };
  let visible = true; let raf = 0; let previous = 0; let clock = 0; let ready = false;
  const watch = new FrameWatch();

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // The network is about 13 units wide: on narrow screens back the camera off until it fits.
    const distance = Math.max(17, 27 / camera.aspect);
    camera.position.set(0, distance * .55, distance * .83);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();

  function place(i: number, t: number) {
    // u in [0, 3): 0..1 client→drop, 1..2 drop→hub, 2..3 hub→cash.
    const client = Math.floor(i / perClient);
    let u = ((t * .23 + offsets[i]) % 1) * 3;
    let held = false; let stopped = false;
    if (client === HELD_CLIENT && mix.held > .5) { u = Math.min(u, .12); held = true; }
    else if (mix.gate > .5 && u > 1.86) { u = 1.86; stopped = true; }
    const point = u < 1 ? toDrop[client].getPoint(u) : u < 2 ? toHub[ROUTE[client]].getPoint(u - 1) : toCash.getPoint(u - 2);
    dummy.position.copy(point);
    dummy.rotation.set(Math.PI / 2, t * 2 + i, 0);
    dummy.scale.setScalar(held ? 1.15 : stopped ? .85 : 1);
    dummy.updateMatrix(); coins.setMatrixAt(i, dummy.matrix);
    coins.setColorAt(i, colour.copy(held ? HELD : stopped ? RED : COIN));
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!visible) { previous = 0; return; }
    const delta = previous ? now - previous : 16; previous = now;
    if (watchFrames && watch.push(delta)) { cancelAnimationFrame(raf); onSlow(); return; }
    const dt = Math.min(.05, delta / 1000);
    clock += dt;
    const k = 1 - Math.pow(.02, dt);
    for (const key of ["hub", "held", "gate"] as const) mix[key] += (target[key] - mix[key]) * k;
    eased.x += (pointer.x - eased.x) * k; eased.y += (pointer.y - eased.y) * k;

    world.rotation.y = Math.sin(clock * .18) * .06 + eased.x * .12;
    camera.lookAt(0, .45 - eased.y * .25, 0);

    clients.forEach((p, i) => { p.group.position.y = Math.sin(clock * 2 + i) * .02; });
    drops.forEach((p, i) => { p.group.position.y = Math.sin(clock * 2.4 + i * 2) * .025; });
    hub.material.color.copy(INK).lerp(RED, mix.hub);
    hub.material.emissive.copy(RED).multiplyScalar(mix.hub * .25);
    drops.forEach(p => p.material.color.copy(DROP).lerp(RED, mix.gate * .55));
    lineMats.hub.color.copy(LINE).lerp(RED, mix.hub * .7);
    lineMats.cash.opacity = .9 - mix.gate * .65;
    screenMat.color.copy(GREEN).lerp(IDLE_SCREEN, mix.gate);

    rings.forEach((ring, i) => {
      const phase = (clock * .55 + i / 3) % 1;
      ring.scale.setScalar(1 + phase * 1.6);
      (ring.material as MeshBasicMaterial).opacity = mix.hub * (1 - phase) * .55;
    });
    (gate.material as MeshStandardMaterial).opacity = mix.gate * .9;
    gate.rotation.z = clock * .6;
    shieldMat.opacity = mix.held * .28;
    shield.scale.setScalar(.6 + mix.held * .4);

    for (let i = 0; i < total; i += 1) place(i, clock);
    coins.instanceMatrix.needsUpdate = true;
    if (coins.instanceColor) coins.instanceColor.needsUpdate = true;
    renderer.render(scene, camera);
    if (!ready) { ready = true; onReady(); }
  }
  raf = requestAnimationFrame(frame);

  return {
    setStage(stage) {
      target = { hub: stage >= 1 ? 1 : 0, held: stage >= 2 ? 1 : 0, gate: stage >= 3 ? 1 : 0 };
    },
    setPointer(x, y) { pointer = { x, y }; },
    setVisible(value) { visible = value; previous = 0; },
    dispose() {
      cancelAnimationFrame(raf); observer.disconnect();
      for (const item of disposables) item.dispose();
      [...clients, ...drops, hub].forEach(p => p.group.traverse(node => { if (node instanceof Mesh) { node.geometry.dispose(); (node.material as MeshStandardMaterial).dispose(); } }));
      coins.dispose(); renderer.dispose();
    },
  };
}
