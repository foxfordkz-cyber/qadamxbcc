import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Use the installed public Artifact Tool SDK. Host-specific runtime paths stay
// in environment variables, outside the repository.
const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleSpecifier = process.env.ARTIFACT_TOOL_MODULE || '@oai/artifact-tool';
const sdkUrl = path.isAbsolute(moduleSpecifier) ? pathToFileURL(moduleSpecifier).href : moduleSpecifier;
const { Presentation, PresentationFile } = await import(sdkUrl);
const skillDir = process.env.PRESENTATION_SKILL_DIR;
const pythonExecutable = process.env.RUNTIME_PYTHON || 'python';
if (!skillDir) throw new Error('Set PRESENTATION_SKILL_DIR to the installed Presentations skill. See docs/BUILD_PRESENTATION.md.');
if (!process.env.RUNTIME_NODE_MODULES && !process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Set RUNTIME_NODE_MODULES to the bundled node_modules directory for the final import check.');
const { finalizePresentation } = await import(pathToFileURL(path.join(skillDir, 'container_tools/artifact_tool_utils.mjs')).href);
const sourcePath = path.join(workspaceDir, 'frontend/src/content/pitch.json');
const sourceBytes = await fs.readFile(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
if (source.slides.length !== 8) throw new Error('The pitch contract requires exactly eight slides.');
const runDir = path.join(workspaceDir, '.local-checks/pitch', new Date().toISOString().replace(/[:.]/g, '-'));
const outputDir = path.join(workspaceDir, 'deliverables');
await fs.mkdir(outputDir, { recursive: true });
const FONT = process.env.PITCH_FONT || 'Segoe UI';
const C = { canvas: '#F4F6F8', white: '#FFFFFF', ink: '#101828', muted: '#475467', green: '#00A859', darkGreen: '#008F4C', line: '#D0D5DD', paleGreen: '#E6F6EC', amber: '#B54708', paleAmber: '#FFF3DC', red: '#D92D20', paleRed: '#FEECEB' };
const label = (lang, ru, kk) => lang === 'kk' ? kk : ru;
const manifest = { source: 'frontend/src/content/pitch.json', sourceHashEncoding: 'UTF-8 JSON.stringify(JSON.parse(sourceText))', sourceSha256: createHash('sha256').update(JSON.stringify(source), 'utf8').digest('hex'), slidesPerDeck: 8, decks: [] };

function text(slide, value, x, y, w, h, size = 26, color = C.ink, bold = false, alignment = 'left') {
  const shape = slide.shapes.add({ geometry: 'textbox', position: { left: x, top: y, width: w, height: h }, fill: 'none', line: { fill: 'none', width: 0 } });
  shape.text = value;
  shape.text.style = { typeface: FONT, fontSize: size, bold, color, alignment, verticalAlignment: 'top', insets: 0, autoFit: 'none', wrap: 'square', lineSpacing: 1.12 };
  return shape;
}

function box(slide, value, x, y, w, h, fill = C.white, color = C.ink, border = C.line, size = 23) {
  const shape = slide.shapes.add({ geometry: 'roundRect', position: { left: x, top: y, width: w, height: h }, fill, borderRadius: 12, line: { fill: border, width: 1.5 } });
  shape.text = value;
  shape.text.style = { typeface: FONT, fontSize: size, bold: true, color, alignment: 'center', verticalAlignment: 'middle', insets: 12, autoFit: 'none', wrap: 'square', lineSpacing: 1.05 };
  return shape;
}

function connect(slide, from, to, color = C.green, fromSide = 'right', toSide = 'left', kind = 'elbow') {
  return slide.shapes.connect(from, to, { fromSide, toSide, kind, line: { fill: color, width: 2 }, tail: { type: 'triangle', width: 'sm', length: 'sm' } });
}

function node(slide, value, x, y, color, fill, size = 48) {
  const shape = slide.shapes.add({ geometry: 'ellipse', position: { left: x, top: y, width: size, height: size }, fill, line: { fill: color, width: 2 } });
  shape.text = value;
  shape.text.style = { typeface: FONT, fontSize: 20, bold: true, color, alignment: 'center', verticalAlignment: 'middle', insets: 0 };
  return shape;
}

function points(slide, items, x = 104, y = 320, w = 610, step = 105) {
  items.forEach((item, index) => {
    text(slide, String(index + 1).padStart(2, '0'), x - 40, y + index * step + 2, 32, 32, 19, C.darkGreen, true);
    text(slide, item, x, y + index * step, w, step - 14, 25, C.ink);
  });
}

function base(presentation, item, lang, index) {
  const slide = presentation.slides.add();
  slide.background.fill = C.canvas;
  const content = item[lang];
  text(slide, 'BCC Shield', 64, 30, 240, 34, 23, C.darkGreen, true);
  text(slide, `${index + 1} / 8`, 1100, 34, 116, 24, 17, C.muted, false, 'right');
  text(slide, content.title, 64, 88, 1152, 118, 44, C.ink, true);
  text(slide, content.lead, 64, 218, 1130, 76, 27, C.muted);
  text(slide, label(lang, 'Учебный прототип. Реальные платежи не выполняются.', 'Оқу прототипі. Нақты төлемдер орындалмайды.'), 64, 674, 1100, 23, 16, C.muted);
  slide.speakerNotes.text = [content.note, item.source ? `Source: ${item.source.label}\n${item.source.url}` : '', `Source content: frontend/src/content/pitch.json, slide ${item.id}.`, label(lang, `План репетиции: ${item.duration} секунд. Формат конкурса публично не подтверждён.`, `Репетиция жоспары: ${item.duration} секунд. Байқау форматы ашық дерекпен расталмаған.`)].filter(Boolean).join('\n\n');
  return slide;
}

function cover(slide, content, lang) {
  points(slide, content.points, 104, 320, 640, 106);
  const call = box(slide, label(lang, 'Звонящий', 'Қоңырау шалушы'), 855, 310, 330, 70, C.white, C.ink);
  const deposit = box(slide, label(lang, 'Депозит клиента', 'Клиент депозиті'), 855, 425, 330, 70, C.white, C.ink);
  const recipient = box(slide, label(lang, '«Безопасный счёт»', '«Қауіпсіз шот»'), 855, 540, 330, 78, C.paleAmber, C.amber, '#F79009');
  connect(slide, call, deposit, C.muted, 'bottom', 'top', 'straight');
  connect(slide, deposit, recipient, '#F79009', 'bottom', 'top', 'straight');
}

function decisions(slide, content, lang) {
  const colors = [C.darkGreen, C.amber, C.red];
  const ranges = ['0–39', '40–74', '75–100'];
  content.points.forEach((point, i) => {
    const y = 320 + i * 110;
    text(slide, ranges[i], 64, y, 200, 76, 52, colors[i], true);
    const body = point.replace(/^[\d–-]+:\s*/, '');
    text(slide, body, 302, y + 8, 880, 86, 29, C.ink);
  });
}

function pipeline(slide, content, lang) {
  points(slide, content.points, 104, 320, 605, 106);
  const sources = [label(lang, 'Контекст\nи правила', 'Контекст\nжәне ережелер'), label(lang, 'Redis\nи граф', 'Redis\nжәне граф'), 'Random\nForest'];
  const destination = box(slide, label(lang, 'Риск\n0–100', 'Тәуекел\n0–100'), 1065, 425, 150, 110, C.paleGreen, C.darkGreen, C.green, 27);
  sources.forEach((name, i) => {
    const origin = box(slide, name, 800, 315 + i * 115, 185, 100, C.white, C.ink);
    connect(slide, origin, destination);
  });
}

function comparison(slide, content, lang) {
  points(slide, content.points, 104, 320, 630, 106);
  text(slide, label(lang, 'Семейный сбор', 'Отбасылық жинақ'), 808, 305, 390, 34, 24, C.darkGreen, true);
  const household = node(slide, '1', 815, 348, C.green, C.paleGreen, 42);
  const second = node(slide, '2', 815, 405, C.green, C.paleGreen, 42);
  const family = node(slide, '3', 1100, 375, C.green, C.paleGreen, 48);
  connect(slide, household, family, C.green);
  connect(slide, second, family, C.green);
  text(slide, label(lang, 'Одного признака недостаточно', 'Жалғыз белгі жеткіліксіз'), 808, 460, 398, 34, 21, C.muted);
  text(slide, label(lang, 'Потоки и быстрый вывод', 'Ағындар және жылдам шығару'), 808, 500, 400, 42, 24, C.red, true);
  const hub = node(slide, 'H', 990, 570, C.red, C.paleRed, 58);
  const cashOut = node(slide, '₸', 1138, 574, C.red, C.paleRed, 50);
  [548, 602].forEach((y, i) => { const source = node(slide, String(i + 1), 815, y, '#F79009', C.paleAmber, 42); connect(slide, source, hub, '#F79009'); });
  connect(slide, hub, cashOut, C.red, 'right', 'left', 'straight');
}

function proof(slide, content, lang) {
  content.points.forEach((point, i) => {
    const x = 64 + i * 395;
    text(slide, String(i + 1).padStart(2, '0'), x, 322, 340, 56, 44, C.darkGreen, true);
    text(slide, point, x, 390, 350, 145, 25);
  });
  const names = ['request_id', 'SQL commit', 'outbox', 'SOC'];
  let previous;
  names.forEach((name, i) => {
    const current = box(slide, name, 64 + i * 300, 574, 240, 64, i === 3 ? C.paleGreen : C.white, i === 3 ? C.darkGreen : C.ink);
    if (previous) connect(slide, previous, current, C.green, 'right', 'left', 'straight');
    previous = current;
  });
}

function economics(slide, content, lang) {
  points(slide, content.points, 104, 320, 640, 106);
  text(slide, label(lang, 'Подтверждённый\nдополнительный эффект', 'Қосымша расталған\nнәтиже'), 820, 320, 386, 92, 29, C.darkGreen, true);
  text(slide, '−', 820, 430, 42, 52, 44, C.muted);
  text(slide, label(lang, 'Проверки и эксплуатация', 'Тексеру және пайдалану'), 880, 440, 324, 86, 26);
  text(slide, '=', 820, 550, 42, 52, 44, C.muted);
  text(slide, label(lang, 'Чистый эффект', 'Таза нәтиже'), 880, 562, 320, 75, 29, C.ink, true);
}

function pilot(slide, content, lang) {
  const weeks = ['1–2', '3–4', '5–6'];
  const stages = [];
  content.points.forEach((point, i) => {
    const x = 64 + i * 395;
    text(slide, weeks[i], x, 320, 340, 88, 64, C.darkGreen, true);
    text(slide, label(lang, 'недели', 'апта'), x, 412, 340, 34, 23, C.muted);
    text(slide, point.replace(/^(?:Недели\s+)?[\d–-]+\s*(?:апта)?\s*:\s*/i, ''), x, 470, 350, 146, 26);
    stages.push(node(slide, String(i + 1), x, 612, C.green, C.paleGreen, 44));
  });
  connect(slide, stages[0], stages[1], C.green, 'right', 'left', 'straight');
  connect(slide, stages[1], stages[2], C.green, 'right', 'left', 'straight');
}

function close(slide, content, lang) {
  points(slide, content.points, 104, 320, 660, 106);
  const names = [label(lang, 'Технический разбор', 'Техникалық талқылау'), 'Shadow', label(lang, 'Оценка результата', 'Нәтижені бағалау')];
  let previous;
  names.forEach((name, i) => {
    const current = box(slide, name, 865, 315 + i * 115, 335, 78, i === 2 ? C.paleGreen : C.white, i === 2 ? C.darkGreen : C.ink);
    if (previous) connect(slide, previous, current, C.green, 'bottom', 'top', 'straight');
    previous = current;
  });
}

const layouts = { cover, decisions, pipeline, comparison, proof, economics, pilot, close };
for (const lang of ['ru', 'kk']) {
  const langDir = path.join(runDir, lang);
  const previewDir = path.join(langDir, 'previews');
  const finalDir = path.join(langDir, 'validated');
  await fs.mkdir(previewDir, { recursive: true });
  await fs.mkdir(finalDir, { recursive: true });
  const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
  for (const [index, item] of source.slides.entries()) {
    if (!layouts[item.kind]) throw new Error(`Unknown layout ${item.kind}`);
    if (item[lang].points.length !== 3) throw new Error(`Slide ${item.id} must contain three points.`);
    const slide = base(presentation, item, lang, index);
    layouts[item.kind](slide, item[lang], lang);
    const png = await presentation.export({ slide, format: 'png', scale: 1 });
    await fs.writeFile(path.join(previewDir, `slide-${String(index + 1).padStart(2, '0')}.png`), new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: 'layout' });
    await fs.writeFile(path.join(previewDir, `slide-${String(index + 1).padStart(2, '0')}.layout.json`), new Uint8Array(await layout.arrayBuffer()));
  }
  const candidatePath = path.join(langDir, 'candidate.pptx');
  await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
  const finalPath = path.join(finalDir, `BCC-Shield-${lang}.pptx`);
  await finalizePresentation({
    workspaceDir,
    candidatePath,
    finalPath,
    explicitTotalSlideCount: 8,
    requiredNativeTableOwnerSlides: [],
    requiredNativeChartOwnerSlides: [],
    pythonExecutable,
    integrityValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_package_integrity.py'),
    layoutValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_layout_geometry.py'),
    layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-bullet-geometry', '--validate-heading-fit'],
    fontPolicy: { basis: 'design', families: [FONT] },
    verifyArtifactToolImport: true,
    receiptPath: path.join(langDir, 'validation.json'),
  });
  await fs.copyFile(finalPath, path.join(outputDir, `BCC-Shield-${lang}.pptx`));
  manifest.decks.push({ language: lang, file: `BCC-Shield-${lang}.pptx`, sha256: createHash('sha256').update(await fs.readFile(finalPath)).digest('hex') });
  console.log(JSON.stringify({ language: lang, output: path.join(outputDir, `BCC-Shield-${lang}.pptx`), previewDir, validation: path.join(langDir, 'validation.json') }));
}
await fs.writeFile(path.join(outputDir, 'pitch-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
