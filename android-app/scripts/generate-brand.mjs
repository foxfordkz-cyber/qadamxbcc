import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The public SVG is the editable master for both clients.
const app = fileURLToPath(new URL("../", import.meta.url));
const frontend = path.join(app, "../frontend");
const mark = (await readFile(path.join(frontend, "public/saq-bol-mark.svg"), "utf8")).replace(/\r\n/g, "\n");
const tile = mark.match(/<rect [^>]*fill="(#[0-9A-Fa-f]{6})"\s*\/>/);
if (!tile) throw Error("The brand mark must have a solid rectangular background.");
const emerald = tile[1];
const glyph = mark.replace(tile[0], "");

async function raster(svg, size, file) {
  const png = await sharp(Buffer.from(svg), { density: size * 72 / 64 })
    .resize(size, size).png().toBuffer();
  await writeFile(file, png);
}

const assets = path.join(app, "assets");
const square = mark.replace(tile[0], `<rect width="64" height="64" fill="${emerald}"/>`);
await writeFile(path.join(app, "www/mark.svg"), mark);
await writeFile(path.join(frontend, "src/app/icon.svg"), mark);
await raster(square, 180, path.join(frontend, "src/app/apple-icon.png"));
for (const size of [192, 512]) {
  await raster(mark, size, path.join(frontend, `public/icons/icon-${size}.png`));
}
// In the maskable PWA icon the full mark fits inside the central 80% circle.
const maskable = square.replace('viewBox="0 0 64 64"', 'viewBox="-4 -4 72 72"')
  .replace('width="64" height="64"', 'x="-4" y="-4" width="72" height="72"');
await raster(maskable, 512, path.join(frontend, "public/icons/icon-maskable-512.png"));

await raster(mark, 1024, path.join(assets, "icon-only.png"));
await raster(glyph, 1024, path.join(assets, "icon-foreground.png"));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: emerald } })
  .png().toFile(path.join(assets, "icon-background.png"));
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: emerald } })
  .composite([{ input: await sharp(path.join(assets, "icon-foreground.png")).resize(720).png().toBuffer() }])
  .png().toBuffer();
await writeFile(path.join(assets, "splash.png"), splash);
await writeFile(path.join(assets, "splash-dark.png"), splash);

// A full-bleed background stays solid under launcher masks and parallax. The
// separate foreground maintains the Android 66/108 dp adaptive-icon safe zone.
const res = path.join(app, "android/app/src/main/res");
const round = mark.replace(tile[0], `<circle cx="32" cy="32" r="32" fill="${emerald}"/>`);
const densities = [
  // name, 48 dp launcher, portrait splash width and height
  ["ldpi", 36, 240, 320],
  ["mdpi", 48, 320, 480],
  ["hdpi", 72, 480, 800],
  ["xhdpi", 96, 720, 1280],
  ["xxhdpi", 144, 960, 1600],
  ["xxxhdpi", 192, 1280, 1920],
];

async function splashFiles(width, height, folders) {
  const png = await sharp(splash).resize(width, height).png().toBuffer();
  for (const folder of folders) await writeFile(path.join(res, folder, "splash.png"), png);
}
for (const [density, size, width, height] of densities) {
  const folder = path.join(res, `mipmap-${density}`);
  const layerSize = size * 108 / 48;
  await raster(mark, size, path.join(folder, "ic_launcher.png"));
  await raster(round, size, path.join(folder, "ic_launcher_round.png"));
  await raster(glyph, layerSize, path.join(folder, "ic_launcher_foreground.png"));
  await writeFile(path.join(folder, "ic_launcher_background.png"),
    await sharp({ create: { width: layerSize, height: layerSize, channels: 3, background: emerald } }).png().toBuffer());
  await splashFiles(width, height, [`drawable-port-${density}`, `drawable-port-night-${density}`]);
  await splashFiles(height, width, [`drawable-land-${density}`, `drawable-land-night-${density}`]);
}
await splashFiles(320, 480, ["drawable", "drawable-night"]);
await writeFile(path.join(res, "values/ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${emerald}</color>
</resources>
`);
