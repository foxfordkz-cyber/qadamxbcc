import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Glossy "clay" materials used by every illustration.
export const mat = (color, o = {}) =>
  new THREE.MeshPhysicalMaterial({
    color,
    roughness: o.roughness ?? 0.32,
    metalness: o.metalness ?? 0,
    clearcoat: o.clearcoat ?? 0.8,
    clearcoatRoughness: o.clearcoatRoughness ?? 0.18,
    sheen: o.sheen ?? 0,
    transmission: o.transmission ?? 0,
    thickness: o.thickness ?? 0,
    ior: o.ior ?? 1.45,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 0,
    envMapIntensity: o.env ?? 0.75,
  });

const C = {
  green: 0x12a36b,
  greenDeep: 0x0a7a4f,
  mint: 0x9ff0c4,
  white: 0xfafbfc,
  graphite: 0x2c2f38,
  amber: 0xf5b21f,
  coral: 0xf0566a,
  violet: 0x6d63f6,
  blue: 0x3d8bf2,
  sky: 0x2aabee,
  gold: 0xf2c14e,
  silver: 0xd9dde4,
};

const extrude = (shape, depth, bevel = 0.08, segs = 8) =>
  new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segs,
    curveSegments: 48,
  }).center();

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function tube(points, radius, material, tension = 0.05) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, "catmullrom", tension);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, radius, 24, false), material));
  for (const p of [points[0], points.at(-1)]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
    cap.position.set(...p);
    g.add(cap);
  }
  return g;
}

function bang(material, scale = 1) {
  // An exclamation mark from a capsule and a ball.
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.075 * scale, 0.36 * scale, 8, 24), material);
  bar.position.y = 0.12 * scale;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.085 * scale, 32, 16), material);
  dot.position.y = -0.27 * scale;
  g.add(bar, dot);
  return g;
}

export const models = {
  shield() {
    const s = new THREE.Shape();
    s.moveTo(0, 0.95);
    s.bezierCurveTo(0.35, 0.78, 0.6, 0.74, 0.8, 0.72);
    s.bezierCurveTo(0.82, 0.1, 0.72, -0.55, 0, -1);
    s.bezierCurveTo(-0.72, -0.55, -0.82, 0.1, -0.8, 0.72);
    s.bezierCurveTo(-0.6, 0.74, -0.35, 0.78, 0, 0.95);
    const g = new THREE.Group();
    const body = new THREE.Mesh(extrude(s, 0.22, 0.12, 10), mat(C.green));
    g.add(body);
    const inner = new THREE.Mesh(extrude(s, 0.04, 0.04, 6), mat(0x2fc584, { roughness: 0.35 }));
    inner.scale.set(0.78, 0.78, 1);
    inner.position.z = 0.19;
    g.add(inner);
    const check = tube([[-0.32, 0.02, 0], [-0.07, -0.24, 0], [0.36, 0.3, 0]], 0.085, mat(C.white, { clearcoat: 1 }));
    check.position.z = 0.3;
    g.add(check);
    g.rotation.set(0.12, -0.42, 0.04);
    return g;
  },

  phone() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.0, 1.85, 0.16, 8, 0.14), mat(C.graphite, { roughness: 0.25 }));
    g.add(body);
    const screen = new THREE.Mesh(new RoundedBoxGeometry(0.86, 1.68, 0.02, 4, 0.09), mat(0x1b2a24, { roughness: 0.15, emissive: 0x0b3d2b, emissiveIntensity: 0.6 }));
    screen.position.z = 0.08;
    g.add(screen);
    const call = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 48), mat(C.green, { emissive: 0x0c6b45, emissiveIntensity: 0.25 }));
    call.rotation.x = Math.PI / 2;
    call.position.set(0, -0.55, 0.13);
    g.add(call);
    const caller = new THREE.Mesh(new THREE.SphereGeometry(0.2, 48, 24), mat(0x50615a, { roughness: 0.5 }));
    caller.scale.z = 0.35;
    caller.position.set(0, 0.35, 0.12);
    g.add(caller);
    const badge = new THREE.Mesh(new THREE.SphereGeometry(0.34, 64, 32), mat(C.amber));
    badge.position.set(0.52, 0.82, 0.25);
    g.add(badge);
    const b = bang(mat(C.white), 0.85);
    b.position.set(0.52, 0.82, 0.58);
    g.add(b);
    g.rotation.set(0.1, -0.5, -0.12);
    return g;
  },

  chat() {
    const s = roundedRectShape(1.7, 1.15, 0.42);
    const tail = new THREE.Shape();
    tail.moveTo(-0.55, -0.45);
    tail.lineTo(-0.72, -0.85);
    tail.lineTo(-0.2, -0.5);
    const g = new THREE.Group();
    const m = mat(C.violet);
    g.add(new THREE.Mesh(extrude(s, 0.26, 0.12, 10), m));
    const t = new THREE.Mesh(new THREE.ExtrudeGeometry(tail, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 6 }), m);
    t.position.z = -0.13;
    g.add(t);
    for (const x of [-0.42, 0, 0.42]) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16), mat(C.white));
      d.position.set(x, 0, 0.26);
      d.scale.z = 0.7;
      g.add(d);
    }
    const badge = new THREE.Mesh(new THREE.SphereGeometry(0.3, 64, 32), mat(C.coral));
    badge.position.set(0.82, 0.55, 0.22);
    g.add(badge);
    const b = bang(mat(C.white), 0.75);
    b.position.set(0.82, 0.55, 0.52);
    g.add(b);
    g.rotation.set(0.1, -0.45, 0.05);
    return g;
  },

  family() {
    const g = new THREE.Group();
    const person = (color, h, x, z) => {
      const p = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32 * h, 0.45 * h, 12, 32), mat(color));
      body.position.y = -0.25 * h;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.27 * h, 48, 24), mat(0xffd9b8, { roughness: 0.5 }));
      head.position.y = 0.55 * h;
      p.add(body, head);
      p.position.set(x, 0, z);
      return p;
    };
    g.add(person(C.green, 1, -0.38, 0), person(C.amber, 0.82, 0.42, 0.15));
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.25);
    heart.bezierCurveTo(-0.45, 0.05, -0.3, 0.42, 0, 0.22);
    heart.bezierCurveTo(0.3, 0.42, 0.45, 0.05, 0, -0.25);
    const h = new THREE.Mesh(extrude(heart, 0.08, 0.06, 6), mat(C.coral));
    h.position.set(0.05, 0.98, 0.25);
    h.scale.setScalar(0.85);
    g.add(h);
    g.rotation.set(0.08, -0.35, 0);
    return g;
  },

  search() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.13, 32, 96), mat(C.blue));
    g.add(ring);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 64), mat(0xdff0ff, { transmission: 0.9, thickness: 0.3, roughness: 0.05, transparent: true, opacity: 0.85 }));
    glass.rotation.x = Math.PI / 2;
    g.add(glass);
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.62, 12, 32), mat(C.graphite, { roughness: 0.3 }));
    handle.position.set(0.62, -0.62, 0);
    handle.rotation.z = Math.PI / 4;
    g.add(handle);
    const person = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16), mat(C.green));
    head.position.y = 0.1;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.green));
    body.position.y = -0.22;
    person.add(head, body);
    person.position.z = -0.05;
    g.add(person);
    g.rotation.set(0.15, -0.4, 0);
    return g;
  },

  warning() {
    // Rounded triangle: straight edges with small arcs at the corners.
    const pts = [[0, 0.98], [1.0, -0.75], [-1.0, -0.75]].map(([x, y]) => new THREE.Vector2(x, y));
    const k = 0.2;
    const s = new THREE.Shape();
    for (let i = 0; i < 3; i++) {
      const prev = pts[(i + 2) % 3], c = pts[i], next = pts[(i + 1) % 3];
      const a = c.clone().lerp(prev, k), b = c.clone().lerp(next, k);
      if (i === 0) s.moveTo(a.x, a.y); else s.lineTo(a.x, a.y);
      s.quadraticCurveTo(c.x, c.y, b.x, b.y);
    }
    s.closePath();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(extrude(s, 0.24, 0.12, 10), mat(C.coral)));
    const b = bang(mat(C.white), 1.1);
    b.position.set(0, -0.12, 0.3);
    g.add(b);
    g.rotation.set(0.12, -0.42, 0.04);
    return g;
  },

  transfer() {
    const arrow = () => {
      const s = new THREE.Shape();
      s.moveTo(-0.75, 0.1);
      s.lineTo(0.35, 0.1);
      s.lineTo(0.35, 0.32);
      s.lineTo(0.8, 0);
      s.lineTo(0.35, -0.32);
      s.lineTo(0.35, -0.1);
      s.lineTo(-0.75, -0.1);
      s.closePath();
      return extrude(s, 0.18, 0.07, 8);
    };
    const g = new THREE.Group();
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.22, 96), mat(C.green));
    coin.rotation.x = Math.PI / 2;
    g.add(coin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 24, 128), mat(C.greenDeep));
    g.add(rim);
    const a = new THREE.Mesh(arrow(), mat(C.white));
    a.position.set(0.02, 0.27, 0.2);
    a.scale.setScalar(0.85);
    const b = new THREE.Mesh(arrow(), mat(C.white));
    b.rotation.z = Math.PI;
    b.position.set(-0.02, -0.27, 0.2);
    b.scale.setScalar(0.85);
    g.add(a, b);
    g.rotation.set(0.2, -0.5, 0);
    return g;
  },

  clock() {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.24, 96), mat(C.white, { roughness: 0.35 }));
    face.rotation.x = Math.PI / 2;
    g.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.12, 32, 128), mat(C.green));
    g.add(rim);
    for (let i = 0; i < 12; i++) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(i % 3 ? 0.035 : 0.055, 16, 8), mat(0x9aa3ad));
      const a = (i / 12) * Math.PI * 2;
      t.position.set(Math.sin(a) * 0.7, Math.cos(a) * 0.7, 0.13);
      g.add(t);
    }
    const hand = (len, w, angle, color) => {
      const h = new THREE.Mesh(new THREE.CapsuleGeometry(w, len, 8, 16), mat(color));
      h.geometry.translate(0, len / 2, 0);
      h.rotation.z = -angle;
      h.position.z = 0.17;
      return h;
    };
    g.add(hand(0.38, 0.055, Math.PI * 0.62, C.graphite), hand(0.52, 0.04, Math.PI * 1.9, C.green));
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.08, 24, 12), mat(C.graphite));
    pin.position.z = 0.2;
    g.add(pin);
    g.rotation.set(0.15, -0.45, 0);
    return g;
  },

  plane() {
    // Folded paper plane from two triangles per wing.
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const nose = v(1.1, 0.15, 0), tail = v(-0.9, 0, 0), left = v(-0.75, 0.05, 0.85), right = v(-0.75, 0.05, -0.85), keel = v(-0.6, -0.45, 0);
    const geo = (tris) => {
      const g = new THREE.BufferGeometry().setFromPoints(tris.flat());
      g.computeVertexNormals();
      return g;
    };
    const g = new THREE.Group();
    const wing = mat(0x34b3f5, { roughness: 0.35, clearcoat: 0.6 });
    wing.side = THREE.DoubleSide;
    const keelMat = mat(0x147fc4, { roughness: 0.4 });
    keelMat.side = THREE.DoubleSide;
    g.add(new THREE.Mesh(geo([[nose, left, tail], [nose, tail, right]]), wing));
    g.add(new THREE.Mesh(geo([[nose, tail, keel]]), keelMat));
    g.rotation.set(0.7, 0.75, 0.3);
    return g;
  },

  chart() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.14, 1.0, 6, 0.06), mat(C.white, { roughness: 0.4 }));
    base.position.y = -0.7;
    g.add(base);
    [[-0.6, 0.6, C.blue], [0, 1.15, C.green], [0.6, 0.85, C.amber]].forEach(([x, h, color]) => {
      const bar = new THREE.Mesh(new RoundedBoxGeometry(0.42, h, 0.42, 6, 0.1), mat(color));
      bar.position.set(x, -0.63 + h / 2, 0);
      g.add(bar);
    });
    const trend = tube([[-0.75, 0.15, 0.35], [-0.2, 0.55, 0.35], [0.2, 0.35, 0.35], [0.8, 0.85, 0.35]], 0.045, mat(C.coral), 0.3);
    g.add(trend);
    g.rotation.set(0.28, -0.55, 0);
    return g;
  },

  card() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.2, 0.07, 6, 0.1), mat(0x0d7a52, { roughness: 0.25, clearcoat: 1 }));
    g.add(body);
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.8, 1.2, 0.075, 6, 0.1), mat(C.mint, { roughness: 0.3 }));
    stripe.position.x = 0.55;
    g.add(stripe);
    const band = new THREE.Mesh(new RoundedBoxGeometry(0.5, 1.2, 0.08, 6, 0.1), mat(0x34c27f, { roughness: 0.3 }));
    band.position.x = 0.2;
    g.add(band);
    const chip = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.23, 0.04, 4, 0.04), mat(C.gold, { metalness: 0.6, roughness: 0.25 }));
    chip.position.set(-0.55, 0.12, 0.05);
    g.add(chip);
    g.rotation.set(-0.55, -0.35, 0.18);
    return g;
  },

  lock() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.25, 1.0, 0.45, 8, 0.16), mat(C.green));
    body.position.y = -0.3;
    g.add(body);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 24, 64, Math.PI), mat(C.silver, { metalness: 0.7, roughness: 0.2 }));
    shackle.position.y = 0.38;
    g.add(shackle);
    for (const x of [-0.4, 0.4]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.25, 24), mat(C.silver, { metalness: 0.7, roughness: 0.2 }));
      leg.position.set(x, 0.27, 0);
      g.add(leg);
    }
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 24), mat(C.graphite));
    hole.rotation.x = Math.PI / 2;
    hole.position.set(0, -0.25, 0.23);
    g.add(hole);
    g.rotation.set(0.12, -0.45, 0);
    return g;
  },

  coins() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.16, 64), mat(C.gold, { metalness: 0.45, roughness: 0.28 }));
      c.position.set((i % 2) * 0.04, -0.45 + i * 0.19, 0);
      g.add(c);
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.16, 64), mat(C.green));
    top.position.set(0.55, -0.45, 0.45);
    g.add(top);
    g.rotation.set(0.35, -0.4, 0);
    return g;
  },
};
