import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Measure the encoded container and align both subtitle tracks to its first captured frame. */
export async function verifyDemoFilm(directory, ffmpeg = process.env.FFMPEG_EXECUTABLE || "ffmpeg") {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const video = path.join(directory, "BCC-Shield-demo.webm");
  const sha256 = createHash("sha256").update(await readFile(video)).digest("hex");
  assert.equal(sha256, manifest.sha256, "The video must match the completed browser run");
  const scratch = await mkdtemp(path.join(os.tmpdir(), "saqbol-film-"));
  const png = path.join(scratch, "decoded.png");
  const sampleSeconds = [20, 53, 92, 152];
  let duration;
  let codec;
  try {
    for (const seconds of sampleSeconds) {
      const result = spawnSync(ffmpeg, ["-hide_banner", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-y", png], { encoding: "utf8", windowsHide: true });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr);
      const frame = await readFile(png);
      assert.equal(frame.readUInt32BE(16), 1920);
      assert.equal(frame.readUInt32BE(20), 1080);
      assert.ok(frame.length > 10000, "Decoded frame contains a visible interface");
      const parts = /Duration: (\d+):(\d+):([\d.]+)/.exec(result.stderr);
      assert.ok(parts, "FFmpeg must report the container duration");
      duration = +parts[1] * 3600 + +parts[2] * 60 + +parts[3];
      codec = /Stream #0:\d+[^\n]*Video: (\w+)/.exec(result.stderr)?.[1];
      assert.match(result.stderr, /1920x1080[^\n]+25 fps/);
      assert.doesNotMatch(result.stderr, /Stream #0:\d+[^\n]*Audio:/);
      await unlink(png);
    }
  } finally {
    await unlink(png).catch(() => {});
    await rmdir(scratch);
  }
  assert.ok(duration >= 150 && duration <= 180);
  const offset = manifest.duration_seconds - duration;
  assert.ok(Math.abs(offset) < 10, "Review video timing before publishing captions");
  const stamp = value => new Date(Math.round(value * 1000)).toISOString().slice(11, 23).replace(".", ",");
  for (const lang of ["kk", "ru"]) {
    const cues = manifest.chapters.map((c, i, chapters) => {
      const begin = i ? Math.max(0, c.seconds - offset) : 0;
      const end = i === chapters.length - 1 ? duration : Math.max(0, chapters[i + 1].seconds - offset);
      assert.ok(c[lang].trim() && begin < end && end <= duration);
      return [i + 1, stamp(begin) + " --> " + stamp(end), c[lang], ""].join("\n");
    });
    await writeFile(path.join(directory, "BCC-Shield-demo." + lang + ".srt"), cues.join("\n"), "utf8");
  }
  const verification = { verified_at: new Date().toISOString(), container_duration_seconds: duration,
    scenario_duration_seconds: manifest.duration_seconds, width: 1920, height: 1080, fps: 25,
    codec, audio: false, decoded_frame_seconds: sampleSeconds, subtitle_tracks: ["kk", "ru"],
    caption_wall_clock_offset_seconds: offset, sha256 };
  await writeFile(path.join(directory, "verification.json"), JSON.stringify(verification, null, 2) + "\n");
  return verification;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.ok(process.argv[2], "Pass the directory containing manifest.json and the WebM");
  console.log(await verifyDemoFilm(path.resolve(process.argv[2])));
}
