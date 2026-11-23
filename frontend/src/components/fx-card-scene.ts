/**
 * Real-time card scene: a brushed-metal Saq Bol card behind a thick glass
 * shield, lit like a product shot (studio softboxes reflected in metal and
 * glass). When a transfer is held the glass turns frosted and the card behind
 * it blurs; a blocked transfer tints the glass red. On the landing page the
 * shield slides in front of the card as the visitor scrolls.
 *
 * Loaded with import() only on devices that passed lib/fx-tier.ts, so three.js
 * never reaches the main bundle. Geometry, textures and the studio environment
 * are generated here; no model or HDR files are fetched.
 */
import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, CanvasTexture, Color, DirectionalLight, ExtrudeGeometry, Group, LinearFilter,
  Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, RepeatWrapping, Scene, Shape,
  ShapeGeometry, ShaderMaterial, SRGBColorSpace, Vector2, WebGLRenderer,
} from "three";
import { FrameWatch } from "@/lib/fx-tier";

export type CardState = "idle" | "frozen" | "locked" | "blocked";
export type CardScene = {
  setState: (state: CardState) => void;
  /** 0..1: how far the glass shield has moved in front of the card (scroll on the landing page). */
  setRing: (progress: number) => void;
  setPointer: (x: number, y: number) => void;
  dispose: () => void;
};
/** ring: leave room for the shield sliding in (landing); card: frame card and shield tightly (sheets). */
type Options = { canvas: HTMLCanvasElement; last4: string; fit: "ring" | "card"; watchFrames: boolean; onSlow: () => void; onReady: () => void };

const W = 3.4; const H = 2.144; const D = 0.05; const R = 0.2;
const GW = W * 1.1; const GH = H * 1.16; const GD = 0.16; const GR = 0.28;
const MARK_TOP = "M50 12H29.6C20.5 12 14 16.9 14 24.2c0 5.2 2.9 8.5 8.8 10.7l2.7 1 7-7.6-5.9-2.1c-2-.7-2.9-1.4-2.9-2.6 0-1.8 1.9-3 5.3-3h13.2Z";
const MARK_BOTTOM = "M14 52h20.4C43.5 52 50 47.1 50 39.8c0-5.2-2.9-8.5-8.8-10.7l-2.7-1-7 7.6 5.9 2.1c2 .7 2.9 1.4 2.9 2.6 0 1.8-1.9 3-5.3 3H21.8Z";
const GLASS_TINT = { clear: new Color("#E9F3F7"), frozen: new Color("#D6E7F1"), blocked: new Color("#F0D3D6") };

function roundedRect(w: number, h: number, r: number) {
  const s = new Shape(); const x = -w / 2; const y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * A photo-studio environment: dim walls, white softboxes for long highlights and
 * two emerald panels, so the chrome picks up the brand colour as a rim reflection.
 */
function studio(renderer: WebGLRenderer) {
  const room = new Scene();
  room.add(new Mesh(new BoxGeometry(30, 20, 30), new MeshBasicMaterial({ color: new Color("#9AA29E"), side: BackSide })));
  const softbox = (w: number, h: number, intensity: number, x: number, y: number, z: number, rx: number, ry: number, color = "#ffffff") => {
    const panel = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }));
    panel.position.set(x, y, z); panel.rotation.set(rx, ry, 0); room.add(panel);
  };
  softbox(16, 2.4, 6, 0, 9, 1, Math.PI / 2, 0);        // long overhead strip
  softbox(2.4, 10, 3.4, -12, 1, 3, 0, Math.PI / 2);     // tall box on the left
  softbox(4, 9, 2.6, 12, -1, -2, 0, -Math.PI / 2, "#2FD39A");  // emerald rim on the right
  softbox(18, 3, 1.6, 0, -9, 2, -Math.PI / 2, 0, "#0F7A55");   // emerald bounce from below
  softbox(9, 4, 1.2, 0, 0, 14, 0, Math.PI);             // soft front fill
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, .02).texture;
  room.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); } });
  pmrem.dispose();
  return texture;
}

function cardFace(last4: string) {
  const w = 1536; const h = Math.round(w * H / W);
  const color = document.createElement("canvas"); color.width = w; color.height = h;
  const metal = document.createElement("canvas"); metal.width = w; metal.height = h;
  const c = color.getContext("2d")!; const m = metal.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#E9ECE9"); g.addColorStop(.5, "#D2D7D4"); g.addColorStop(1, "#C3C9C5");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 3200; i++) {
    const y = Math.random() * h; const a = Math.random() * .06;
    c.fillStyle = Math.random() > .5 ? `rgba(255,255,255,${a})` : `rgba(30,40,35,${a * .7})`;
    c.fillRect(0, y, w, Math.random() * 1.4 + .3);
  }
  m.fillStyle = "#ffffff"; m.fillRect(0, 0, w, h);
  // The mark and type are enamel (non-metal), so they read as printed on metal.
  const drawMark = (ctx: CanvasRenderingContext2D, top: string, bottom: string) => {
    ctx.save(); ctx.translate(w * .07, h * .1); ctx.scale(h * .0042, h * .0042);
    ctx.fillStyle = top; ctx.fill(new Path2D(MARK_TOP)); ctx.fillStyle = bottom; ctx.fill(new Path2D(MARK_BOTTOM)); ctx.restore();
  };
  drawMark(c, "#0B5C42", "#1B8F68"); drawMark(m, "#000", "#000");
  const type = (ctx: CanvasRenderingContext2D, fill: string) => {
    ctx.fillStyle = fill;
    ctx.font = `600 ${h * .08}px "Geologica Variable", "Onest Variable", sans-serif`; ctx.textBaseline = "alphabetic";
    ctx.fillText("Saq Bol", w * .07, h * .86);
    ctx.font = `500 ${h * .058}px "Onest Variable", sans-serif`; ctx.textAlign = "right";
    ctx.fillText(`•••• ${last4}`, w * .93, h * .86); ctx.textAlign = "left";
  };
  type(c, "#1A221E"); type(m, "#222");
  c.save(); c.translate(w * .07, h * .42);
  const chip = c.createLinearGradient(0, 0, w * .105, h * .14); chip.addColorStop(0, "#DCDFD8"); chip.addColorStop(1, "#A3AAA4");
  c.fillStyle = chip; c.beginPath(); c.roundRect(0, 0, w * .105, h * .14, h * .02); c.fill();
  c.strokeStyle = "rgba(40,50,44,.32)"; c.lineWidth = 3;
  for (const fx of [.33, .66]) { c.beginPath(); c.moveTo(w * .105 * fx, 0); c.lineTo(w * .105 * fx, h * .14); c.stroke(); }
  c.beginPath(); c.moveTo(0, h * .07); c.lineTo(w * .105, h * .07); c.stroke(); c.restore();
  const map = new CanvasTexture(color); map.colorSpace = SRGBColorSpace; map.anisotropy = 8;
  const metalness = new CanvasTexture(metal);
  for (const t of [map, metalness]) { t.repeat.set(1 / W, 1 / H); t.offset.set(.5, .5); t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearFilter; }
  return { map, metalness };
}

function noiseTexture() {
  const size = 256; const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!; const image = ctx.createImageData(size, size);
  const octaves = [32, 16, 8, 4].map(cell => { const n = Math.ceil(size / cell) + 1; return { cell, n, grid: Array.from({ length: n * n }, () => Math.random()) }; });
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

// Frost crystals on the glass face: they grow in from the edges and catch light.
const frostVertex = /* glsl */`
  uniform vec2 uSize; varying vec2 vUv;
  void main() { vUv = position.xy / uSize + .5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const frostFragment = /* glsl */`
  uniform sampler2D uNoise; uniform float uProgress; uniform float uTime; uniform vec2 uSize; uniform vec3 uTint; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float n = texture2D(uNoise, vUv * vec2(1.4, 1.)).r;
    float fine = texture2D(uNoise, vUv * vec2(7., 4.4)).r;
    vec2 edge = min(vUv, 1. - vUv) * uSize;
    float grow = uProgress * .95 - min(edge.x, edge.y) * 1.7 + (n - .5) * .5;
    float a = smoothstep(0., .3, grow) * (.05 + .2 * fine);
    vec2 cell = floor(vUv * vec2(260., 170.));
    float sparkle = step(.996, hash(cell)) * (.5 + .5 * sin(uTime * 2.4 + hash(cell + 3.) * 6.28)) * smoothstep(0., .1, grow);
    gl_FragColor = vec4(mix(uTint, vec3(1.), fine * .6) + sparkle, clamp(a + sparkle * .7, 0., .8));
  }`;

export function mountCardScene({ canvas, last4, fit, watchFrames, onSlow, onReady }: Options): CardScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12; renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.environment = studio(renderer);
  const camera = new PerspectiveCamera(26, 1, .1, 60); camera.position.set(0, 0, 10);
  const key = new DirectionalLight("#ffffff", 1.1); key.position.set(-3, 5, 6); scene.add(key);

  // Card
  const body = new ExtrudeGeometry(roundedRect(W, H, R), { depth: D, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 4, curveSegments: 16 });
  body.translate(0, 0, -D / 2);
  const face = cardFace(last4);
  const faceMaterial = new MeshPhysicalMaterial({
    map: face.map, metalnessMap: face.metalness, metalness: .88, roughness: .26, anisotropy: .6,
    clearcoat: .5, clearcoatRoughness: .2, envMapIntensity: 1,
  });
  const edgeMaterial = new MeshPhysicalMaterial({ color: "#C4CAC6", metalness: 1, roughness: .18, envMapIntensity: 1.1 });
  const card = new Mesh(body, [faceMaterial, edgeMaterial]);

  // Glass shield
  const glassShape = roundedRect(GW, GH, GR);
  const glassGeometry = new ExtrudeGeometry(glassShape, { depth: GD, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 8, curveSegments: 24 });
  glassGeometry.translate(0, 0, -GD / 2);
  const glassMaterial = new MeshPhysicalMaterial({
    color: "#ffffff", metalness: 0, roughness: .04, transmission: 1, thickness: .7, ior: 1.5,
    attenuationColor: GLASS_TINT.clear.clone(), attenuationDistance: 1.6, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: .04,
    envMapIntensity: 1.25, transparent: true, opacity: 0,
  });
  const glass = new Mesh(glassGeometry, glassMaterial);
  const noise = noiseTexture();
  const frostMaterial = new ShaderMaterial({
    uniforms: { uNoise: { value: noise }, uProgress: { value: 0 }, uTime: { value: 0 }, uSize: { value: new Vector2(GW, GH) }, uTint: { value: new Color("#D9EAF3") } },
    vertexShader: frostVertex, fragmentShader: frostFragment, transparent: true, depthWrite: false,
  });
  const frost = new Mesh(new ShapeGeometry(glassShape, 24), frostMaterial); frost.position.z = GD / 2 + .052;
  const shield = new Group(); shield.add(glass, frost);

  const root = new Group(); root.add(card, shield); scene.add(root);

  let state: CardState = "idle"; let slideTarget = 0; let slide = 0; let frostValue = 0;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const tint = GLASS_TINT.clear.clone();
  let visible = true; let raf = 0; let last = performance.now(); const started = last; let ready = false;
  const watch = new FrameWatch();

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const tan = Math.tan((camera.fov / 2) * Math.PI / 180); const aspect = w / h;
    const height = fit === "ring" ? Math.max(GH * 1.45, GW * 1.5 / aspect) : Math.max(GH * 1.3, GW * 1.3 / aspect);
    camera.position.z = height / (2 * tan) + GD;
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
    const held = state === "frozen" || state === "blocked";
    const ease = (from: number, to: number, k: number) => from + (to - from) * (1 - Math.exp(-k * dt));
    pointer.sx = ease(pointer.sx, pointer.x, 5); pointer.sy = ease(pointer.sy, pointer.y, 5);
    const drift = held ? .15 : 1;
    root.rotation.y = ease(root.rotation.y, Math.sin(t * .35) * .22 * drift - .18 + pointer.sx * .3, 3);
    root.rotation.x = ease(root.rotation.x, Math.cos(t * .29) * .07 * drift + .06 - pointer.sy * .2, 3);
    root.position.y = ease(root.position.y, Math.sin(t * .8) * .05 * drift, 3);
    // Shield: follows scroll on the landing page; always in place when it protects a transfer.
    const slide0 = slide; slide = ease(slide, state === "idle" ? slideTarget : 1, state === "idle" ? 5 : 3);
    const out = 1 - slide;
    shield.position.set(out * GW * 1.05, out * .2, .42 + out * .6);
    shield.rotation.set(0, -out * .7, out * .08);
    glassMaterial.opacity = Math.min(1, slide * 1.6);
    if ((slide0 > .02) !== (slide > .02)) shield.visible = slide > .02;
    // Frost: cloudy glass with crystals; clear again when the transfer is released.
    frostValue = ease(frostValue, held ? 1 : 0, held ? 1 : 2.2);
    glassMaterial.roughness = .04 + frostValue * .3;
    tint.lerp(state === "blocked" ? GLASS_TINT.blocked : held ? GLASS_TINT.frozen : GLASS_TINT.clear, 1 - Math.exp(-3 * dt));
    glassMaterial.attenuationColor.copy(tint);
    frostMaterial.uniforms.uProgress.value = frostValue; frostMaterial.uniforms.uTime.value = t;
    renderer.render(scene, camera);
    if (!ready) { ready = true; onReady(); }
    return true;
  }
  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now: number) => { if (!visible || document.visibilityState !== "visible") return; if (frame(now)) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  shield.visible = false;
  void document.fonts?.ready.then(() => { const fresh = cardFace(last4); faceMaterial.map?.dispose(); faceMaterial.metalnessMap?.dispose(); faceMaterial.map = fresh.map; faceMaterial.metalnessMap = fresh.metalness; faceMaterial.needsUpdate = true; });
  loop();
  return {
    setState(next) { state = next; },
    setRing(progress) { slideTarget = Math.min(1, Math.max(0, progress)); },
    setPointer(x, y) { pointer.x = x; pointer.y = y; },
    dispose() {
      cancelAnimationFrame(raf); observer.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVisibility);
      body.dispose(); glassGeometry.dispose(); frost.geometry.dispose();
      for (const material of [faceMaterial, edgeMaterial, glassMaterial, frostMaterial]) material.dispose();
      faceMaterial.map?.dispose(); faceMaterial.metalnessMap?.dispose(); noise.dispose();
      scene.environment?.dispose(); renderer.dispose();
    },
  };
}
