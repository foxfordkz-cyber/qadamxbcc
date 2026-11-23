/**
 * Real-time card scene: brushed-metal Saq Bol card, frost that grows from the
 * edges when a transfer is held, and a protective ring that closes around it.
 * Loaded with import() only on devices that passed lib/fx-tier.ts, so three.js
 * never reaches the main bundle. Geometry and textures are generated here; no
 * model files are fetched.
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, CanvasTexture, Color, DirectionalLight, DoubleSide, ExtrudeGeometry, Group,
  LinearFilter, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, PMREMGenerator, RepeatWrapping, Scene, Shape,
  ShapeGeometry, ShaderMaterial, SRGBColorSpace, TorusGeometry, Vector2, WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FrameWatch } from "@/lib/fx-tier";

export type CardState = "idle" | "frozen" | "locked" | "blocked";
export type CardScene = {
  setState: (state: CardState) => void;
  /** 0..1: how far the protective ring has closed (the landing page ties it to scroll). */
  setRing: (progress: number) => void;
  setPointer: (x: number, y: number) => void;
  dispose: () => void;
};
/** ring: frame the closed ring (landing); card: frame the card alone (sheets). */
type Options = { canvas: HTMLCanvasElement; last4: string; fit: "ring" | "card"; watchFrames: boolean; onSlow: () => void; onReady: () => void };

const W = 3.4; const H = 2.144; const D = 0.05; const R = 0.2;
const MARK_TOP = "M50 12H29.6C20.5 12 14 16.9 14 24.2c0 5.2 2.9 8.5 8.8 10.7l2.7 1 7-7.6-5.9-2.1c-2-.7-2.9-1.4-2.9-2.6 0-1.8 1.9-3 5.3-3h13.2Z";
const MARK_BOTTOM = "M14 52h20.4C43.5 52 50 47.1 50 39.8c0-5.2-2.9-8.5-8.8-10.7l-2.7-1-7 7.6 5.9 2.1c2 .7 2.9 1.4 2.9 2.6 0 1.8-1.9 3-5.3 3H21.8Z";
const RING = { idle: new Color("#2FD39A"), frozen: new Color("#9EC3DA"), locked: new Color("#2FD39A"), blocked: new Color("#FF4D5A") };

function roundedRect() {
  const s = new Shape(); const x = -W / 2; const y = -H / 2;
  s.moveTo(x + R, y); s.lineTo(x + W - R, y); s.quadraticCurveTo(x + W, y, x + W, y + R);
  s.lineTo(x + W, y + H - R); s.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
  s.lineTo(x + R, y + H); s.quadraticCurveTo(x, y + H, x, y + H - R);
  s.lineTo(x, y + R); s.quadraticCurveTo(x, y, x + R, y);
  return s;
}

function cardFace(last4: string) {
  const w = 1536; const h = Math.round(w * H / W);
  const color = document.createElement("canvas"); color.width = w; color.height = h;
  const metal = document.createElement("canvas"); metal.width = w; metal.height = h;
  const c = color.getContext("2d")!; const m = metal.getContext("2d")!;
  // Brushed silver: a soft gradient plus thousands of hairlines.
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#F4F6F3"); g.addColorStop(.42, "#CDD3CF"); g.addColorStop(.6, "#EEF0EC"); g.addColorStop(1, "#B9C1BC");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const y = Math.random() * h; const a = Math.random() * .07;
    c.fillStyle = Math.random() > .5 ? `rgba(255,255,255,${a})` : `rgba(40,52,46,${a * .8})`;
    c.fillRect(0, y, w, Math.random() * 1.6 + .3);
  }
  m.fillStyle = "#ffffff"; m.fillRect(0, 0, w, h);
  const ink = (ctx: CanvasRenderingContext2D, fill: string) => { ctx.fillStyle = fill; };
  // The mark and type are enamel (non-metal), so they read as printed on metal.
  const drawMark = (ctx: CanvasRenderingContext2D, top: string, bottom: string) => {
    ctx.save(); ctx.translate(w * .07, h * .1); ctx.scale(h * .0042, h * .0042);
    ink(ctx, top); ctx.fill(new Path2D(MARK_TOP)); ink(ctx, bottom); ctx.fill(new Path2D(MARK_BOTTOM)); ctx.restore();
  };
  drawMark(c, "#0B5C42", "#13A274"); drawMark(m, "#000", "#000");
  const type = (ctx: CanvasRenderingContext2D, fill: string) => {
    ctx.fillStyle = fill;
    ctx.font = `600 ${h * .085}px "Geologica Variable", "Onest Variable", sans-serif`; ctx.textBaseline = "alphabetic";
    ctx.fillText("Saq Bol", w * .07, h * .86);
    ctx.font = `500 ${h * .06}px "Onest Variable", sans-serif`; ctx.textAlign = "right";
    ctx.fillText(`•••• ${last4}`, w * .93, h * .86); ctx.textAlign = "left";
  };
  type(c, "#18211D"); type(m, "#222");
  // Chip: a darker metal plate with contact lines.
  c.save(); c.translate(w * .07, h * .42);
  const chip = c.createLinearGradient(0, 0, w * .11, h * .15); chip.addColorStop(0, "#D9DCD4"); chip.addColorStop(1, "#9EA69F");
  c.fillStyle = chip; c.beginPath(); c.roundRect(0, 0, w * .11, h * .15, h * .02); c.fill();
  c.strokeStyle = "rgba(40,50,44,.35)"; c.lineWidth = 3;
  for (const fx of [.33, .66]) { c.beginPath(); c.moveTo(w * .11 * fx, 0); c.lineTo(w * .11 * fx, h * .15); c.stroke(); }
  c.beginPath(); c.moveTo(0, h * .075); c.lineTo(w * .11, h * .075); c.stroke(); c.restore();
  // Contactless waves.
  c.save(); c.translate(w * .88, h * .2); c.strokeStyle = "rgba(24,33,29,.55)"; c.lineWidth = 6; c.lineCap = "round";
  for (const r of [18, 34, 50]) { c.beginPath(); c.arc(0, 0, r * h / 646, -.9, .9); c.stroke(); }
  c.restore();
  const map = new CanvasTexture(color); map.colorSpace = SRGBColorSpace; map.anisotropy = 8;
  const metalness = new CanvasTexture(metal);
  for (const t of [map, metalness]) { t.repeat.set(1 / W, 1 / H); t.offset.set(.5, .5); t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearFilter; }
  return { map, metalness };
}

function noiseTexture() {
  const size = 256; const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!; const image = ctx.createImageData(size, size);
  // Value noise from a few octaves of blurred random cells: soft patches plus fine crystals.
  const layer = (cell: number) => { const n = Math.ceil(size / cell) + 1; return Array.from({ length: n * n }, () => Math.random()); };
  const octaves = [32, 16, 8, 4].map(cell => ({ cell, grid: layer(cell), n: Math.ceil(size / cell) + 1 }));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0; let total = 0;
    octaves.forEach(({ cell, grid, n }, i) => {
      const gx = x / cell; const gy = y / cell; const x0 = Math.floor(gx); const y0 = Math.floor(gy);
      const fx = gx - x0; const fy = gy - y0; const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
      const at = (ix: number, iy: number) => grid[(iy % n) * n + (ix % n)];
      const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx; const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
      const weight = 1 / (i + 1); v += (top * (1 - sy) + bottom * sy) * weight; total += weight;
    });
    const k = (y * size + x) * 4; const value = Math.round(v / total * 255);
    image.data[k] = image.data[k + 1] = image.data[k + 2] = value; image.data[k + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas); texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

const frostVertex = /* glsl */`
  uniform vec2 uSize; varying vec2 vUv;
  void main() { vUv = position.xy / uSize + .5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const frostFragment = /* glsl */`
  uniform sampler2D uNoise; uniform float uProgress; uniform float uTime; uniform vec2 uSize; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float n = texture2D(uNoise, vUv * vec2(1.6, 1.)).r;
    float fine = texture2D(uNoise, vUv * vec2(6.4, 4.)).r;
    vec2 edge = min(vUv, 1. - vUv) * uSize;
    float d = min(edge.x, edge.y);
    float grow = uProgress * 1.35 - d * .95 + (n - .5) * .55;
    float a = smoothstep(0., .18, grow) * (.42 + .5 * fine);
    vec2 cell = floor(vUv * vec2(220., 140.));
    float sparkle = step(.992, hash(cell)) * (.5 + .5 * sin(uTime * 3. + hash(cell + 3.) * 6.28)) * smoothstep(0., .1, grow);
    vec3 ice = mix(vec3(.80, .90, .96), vec3(1.), fine);
    gl_FragColor = vec4(ice + sparkle, clamp(a + sparkle * .8, 0., .92));
  }`;

export function mountCardScene({ canvas, last4, fit, watchFrames, onSlow, onReady }: Options): CardScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .035).texture;
  const camera = new PerspectiveCamera(28, 1, .1, 50); camera.position.set(0, 0, 9.2);
  const key = new DirectionalLight("#ffffff", 1.6); key.position.set(-3, 4, 5); scene.add(key);
  const rim = new DirectionalLight("#7DF0C5", 1.2); rim.position.set(4, -2, -3); scene.add(rim);

  const shape = roundedRect();
  const body = new ExtrudeGeometry(shape, { depth: D, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 4, curveSegments: 14 });
  body.translate(0, 0, -D / 2);
  const face = cardFace(last4);
  const faceMaterial = new MeshPhysicalMaterial({ map: face.map, metalnessMap: face.metalness, metalness: .92, roughness: .34, clearcoat: .7, clearcoatRoughness: .18, envMapIntensity: 1.15 });
  const edgeMaterial = new MeshPhysicalMaterial({ color: "#B8C0BB", metalness: 1, roughness: .22, envMapIntensity: 1.2 });
  const card = new Mesh(body, [faceMaterial, edgeMaterial]);

  const noise = noiseTexture();
  const frostMaterial = new ShaderMaterial({
    uniforms: { uNoise: { value: noise }, uProgress: { value: 0 }, uTime: { value: 0 }, uSize: { value: new Vector2(W, H) } },
    vertexShader: frostVertex, fragmentShader: frostFragment, transparent: true, depthWrite: false,
  });
  const frost = new Mesh(new ShapeGeometry(shape, 14), frostMaterial); frost.position.z = D / 2 + .016;

  const cardGroup = new Group(); cardGroup.add(card, frost);
  const ringMaterial = new MeshBasicMaterial({ color: RING.idle, transparent: true, opacity: 0, side: DoubleSide });
  const glowMaterial = new MeshBasicMaterial({ color: RING.idle, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const ring = new Mesh(new TorusGeometry(2.06, .018, 16, 220), ringMaterial);
  const glow = new Mesh(new TorusGeometry(2.06, .09, 16, 220), glowMaterial);
  const ringGroup = new Group(); ringGroup.add(ring, glow);
  const root = new Group(); root.add(cardGroup, ringGroup); scene.add(root);

  let state: CardState = "idle"; let ringTarget = 0; let ringValue = 0; let frostValue = 0;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const ringColor = RING.idle.clone();
  let visible = true; let raf = 0; let last = performance.now(); let started = last; let ready = false; let pulse = 0;
  const watch = new FrameWatch();

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // Keep the card and ring inside the frame on tall phone canvases.
    // Fit the closed ring (diameter about 4.2) or the card itself, with a margin.
    const tan = Math.tan((camera.fov / 2) * Math.PI / 180); const aspect = w / h;
    const height = fit === "ring" ? Math.max(4.7, 4.7 / aspect) : Math.max(H * 1.3, W / .8 / aspect);
    camera.position.z = height / (2 * tan);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const io = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); if (visible) loop(); }, { rootMargin: "120px" });
  io.observe(canvas);
  const onVisibility = () => { if (document.visibilityState === "visible") { last = performance.now(); loop(); } };
  document.addEventListener("visibilitychange", onVisibility);

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, .05); const t = (now - started) / 1000;
    if (watchFrames && watch.push(now - last) && ready) { onSlow(); return false; }
    last = now;
    const still = state === "frozen" || state === "blocked";
    const ease = (from: number, to: number, k: number) => from + (to - from) * (1 - Math.exp(-k * dt));
    pointer.sx = ease(pointer.sx, pointer.x, 6); pointer.sy = ease(pointer.sy, pointer.y, 6);
    const drift = still ? 0 : 1;
    root.rotation.y = ease(root.rotation.y, (still ? -.12 : Math.sin(t * .45) * .32 * drift) + pointer.sx * .35, still ? 3 : 4);
    root.rotation.x = ease(root.rotation.x, (still ? .08 : Math.cos(t * .37) * .1 * drift) - pointer.sy * .25, still ? 3 : 4);
    root.position.y = ease(root.position.y, still ? 0 : Math.sin(t * .9) * .07, 3);
    frostValue = ease(frostValue, state === "frozen" || state === "blocked" ? 1 : 0, state === "frozen" ? 1.1 : 2.4);
    frostMaterial.uniforms.uProgress.value = frostValue; frostMaterial.uniforms.uTime.value = t;
    const closing = state === "locked" || state === "blocked" ? 1 : state === "frozen" ? Math.max(ringTarget, .9) : ringTarget;
    const before = ringValue; ringValue = ease(ringValue, closing, 3.2);
    if (before < .985 && ringValue >= .985) pulse = 1;
    pulse = Math.max(0, pulse - dt * 1.6);
    ringColor.lerp(RING[state === "idle" ? "idle" : state], 1 - Math.exp(-4 * dt));
    ringMaterial.color.copy(ringColor); glowMaterial.color.copy(ringColor);
    const s = 1 + (1 - ringValue) * 1.8 + pulse * .04;
    ringGroup.scale.setScalar(s); ringGroup.rotation.z = t * .15 + (1 - ringValue) * 2.4;
    ringGroup.rotation.x = (1 - ringValue) * 1.1;
    ringMaterial.opacity = Math.min(1, ringValue * 1.2) * (state === "frozen" ? .75 + .25 * Math.sin(t * 2.4) : 1);
    glowMaterial.opacity = ringValue * (.16 + pulse * .5);
    cardGroup.scale.setScalar(1 + pulse * .025);
    renderer.render(scene, camera);
    if (!ready) { ready = true; onReady(); }
    return true;
  }
  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now: number) => { if (!visible || document.visibilityState !== "visible") return; if (frame(now)) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  void document.fonts?.ready.then(() => { const fresh = cardFace(last4); faceMaterial.map?.dispose(); faceMaterial.metalnessMap?.dispose(); faceMaterial.map = fresh.map; faceMaterial.metalnessMap = fresh.metalness; faceMaterial.needsUpdate = true; });
  loop();
  return {
    setState(next) { state = next; },
    setRing(progress) { ringTarget = Math.min(1, Math.max(0, progress)); },
    setPointer(x, y) { pointer.x = x; pointer.y = y; },
    dispose() {
      cancelAnimationFrame(raf); observer.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVisibility);
      body.dispose(); frost.geometry.dispose(); ring.geometry.dispose(); glow.geometry.dispose();
      for (const material of [faceMaterial, edgeMaterial, frostMaterial, ringMaterial, glowMaterial]) material.dispose();
      faceMaterial.map?.dispose(); faceMaterial.metalnessMap?.dispose(); noise.dispose();
      scene.environment?.dispose(); pmrem.dispose(); room.dispose?.(); renderer.dispose();
    },
  };
}
