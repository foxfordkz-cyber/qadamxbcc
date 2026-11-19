// Saq Bol — 10-slide screenshot pitch (RU + KK). Usage: node build.js <imgDir> <pitch.json> <outDir>
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");
const { applyTheme } = require(process.env.APPLY_THEME);
const [IMG, PITCH, OUT] = process.argv.slice(2);
const pitch = JSON.parse(fs.readFileSync(PITCH, "utf8"));
const P = id => pitch.slides.find(s => s.id === id);
const sizeOf = file => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

const THEME = { name: "Saq Bol", headFontFace: "Arial", bodyFontFace: "Arial",
  colors: { dk1: "101828", lt1: "FFFFFF", dk2: "0B3B2A", lt2: "F4F6F8", accent1: "00A859", accent2: "008F4C", accent3: "B54708", accent4: "D92D20", accent5: "475467", accent6: "E6F6EC", hlink: "008F4C", folHlink: "067647" } };
const HEX = { ink: "101828", muted: "475467", green: "00A859", dark: "0B3B2A", line: "D0D5DD", pale: "F4F6F8", amber: "B54708", red: "D92D20", white: "FFFFFF", paleGreen: "E6F6EC", paleAmber: "FFF3DC", paleRed: "FEECEB" };

const T = {
  ru: {
    footer: "Saq Bol · учебный прототип · реальные платежи не выполняются",
    s1: { kicker: "Saq Bol · ITU Hackathon 2026", title: "Остановить перевод мошеннику — до отправки", chips: ["Клиент bcc.kz", "Панель SOC", "ҚАЗ / РУС"] },
    s2: { title: "Звонок «из банка» — и клиент сам переводит деньги", steps: ["Звонящий представляется сотрудником банка или полиции", "Просит перевести депозит на «безопасный счёт»", "Клиент вводит 900 000 ₸ и подтверждает: пароль верный, но решение навязано", "Saq Bol удерживает перевод, пока деньги ещё не ушли"], caps: ["Подтверждение перевода", "Удержание на 15 минут"] },
    s3: { chips: ["0–39 · разрешить", "40–74 · удержать на 15 минут", "75–100 · заблокировать"] },
    s4: { title: "15 минут, чтобы остановиться", lead: "Анкета удержания: объяснение, пять вопросов «да / нет», проверка ответов.", caps: ["Пауза", "Вопросы", "Проверка"],
      points: ["Таймер не отправляет деньги: после 15 минут нужно подтвердить заново, риск получателя проверяется ещё раз.", "Ответы с признаками мошенничества («звонили из банка», «безопасный счёт») сразу блокируют перевод.", "Отменить перевод можно в любой момент — это действие на сервере."] },
    s5: { title: "Доверенное лицо — второй голос рядом", lead: "Во время удержания клиент одним нажатием сообщает близкому человеку через Telegram-бот банка.", caps: ["1 · Сообщить", "2 · Сервис принял", "3 · Подозрение"],
      points: ["Контакт подключается в боте и сам даёт согласие.", "Статус в телефоне: отправлено → подтвердил / сообщил о подозрении.", "Доверенное лицо не может одобрить перевод — только предупредить."] },
    s6: { title: "Панель SOC: вся картина риска", lead: "Аналитик видит каждый перевод, решение и причину — в реальном времени.",
      points: ["Лента решений с поиском и фильтрами по статусу", "Сумма на удержании и p95 скорера на одном экране", "Режим показа для проектора"] },
    s7: { title: "Граф показывает дроп-хаб", lead: "Получатель собирает деньги от многих отправителей и сразу выводит их дальше — перевод заблокирован с объяснением.", cap: "Гибридная оценка: правила + граф + Random Forest. Вклады — пути деревьев, не SHAP." },
    s8: { title: "Живое демо: перевод с телефона жюри", lead: "Сканируйте QR на проекторе → сделайте перевод на своём телефоне → он сразу появится в ленте SOC.", caps: ["Проектор: панель SOC с QR-кодом", "Телефон жюри"] },
    s9: { stats: [["1 = 1", "один request_id — одна операция; неизвестный результат блокирует повторную отправку"], ["15 мин", "после удержания риск получателя проверяется заново"], ["0", "ФИО и реквизитов в JSON-отчёте для SOC"], ["96", "автоматических браузерных проверок интерфейса"]] },
    s10: { pilot: "Пилот: 6 недель без влияния на платежи", ask: "Что просим у BCC" },
    notes: {
      s2: "Покажите путь клиента на настоящем экране: перевод 900 000 ₸ с депозита во время звонка. Подтверждение есть, пароль верный — но решение навязано. Saq Bol вмешивается до того, как деньги ушли.",
      s4: "Пройдите три шага анкеты. Подчеркните: таймер сам ничего не отправляет, а ответы с красными флагами блокируют перевод сразу. Чистые ответы не доказывают отсутствие мошенничества.",
      s5: "Доверенное лицо подключено через Telegram-бот (в демо — фейковый Telegram и симулятор). На экране: кнопка, статус «Сервис принял» и сообщение о подозрении. Контакт не может одобрить или отправить перевод.",
      s6: "Это та же транзакция, что на телефоне: один ID от экрана клиента до SOC. Цифры на экране — синтетические демо-данные, не статистика банка.",
      s8: "Сценарий для защиты: член жюри сканирует QR в режиме показа, делает подозрительный перевод на своём телефоне, а проектор сразу показывает его в ленте. Телефон и ноутбук — в одной Wi-Fi; демо запускается с BCC_MOBILE_LAN=true.",
      s9: "Проверяем не только успешный путь: обрыв связи, повтор, истечение удержания и восстановление. Число браузерных проверок — из скрипта qa-mobile-soc.cjs.",
    },
  },
  kk: {
    footer: "Saq Bol · оқу прототипі · нақты төлемдер орындалмайды",
    s1: { kicker: "Saq Bol · ITU Hackathon 2026", title: "Алаяққа аударымды жібермей тұрып тоқтату", chips: ["bcc.kz клиенті", "SOC панелі", "ҚАЗ / РУС"] },
    s2: { title: "«Банктен» қоңырау — клиент ақшаны өзі аударады", steps: ["Қоңырау шалушы өзін банк немесе полиция қызметкері деп таныстырады", "Депозиттегі ақшаны «қауіпсіз шотқа» аударуды сұрайды", "Клиент 900 000 ₸ енгізіп, растайды: пароль дұрыс, бірақ шешімді басқа адам таңған", "Saq Bol ақша кетпей тұрып аударымды кідіртеді"], caps: ["Аударымды растау", "15 минуттық кідіріс"] },
    s3: { chips: ["0–39 · рұқсат ету", "40–74 · 15 минут кідірту", "75–100 · бұғаттау"] },
    s4: { title: "Тоқтауға 15 минут", lead: "Кідіріс сауалнамасы: түсіндірме, «иә / жоқ» бес сұрақ, жауаптарды тексеру.", caps: ["Кідіріс", "Сұрақтар", "Тексеру"],
      points: ["Таймер ақшаны жібермейді: 15 минуттан кейін қайта растау керек, алушы тәуекелі қайта тексеріледі.", "Алаяқтық белгілері бар жауаптар («банктен қоңырау», «қауіпсіз шот») аударымды бірден бұғаттайды.", "Аударымнан кез келген уақытта бас тартуға болады — бұл серверлік әрекет."] },
    s5: { title: "Сенімді адам — жаныңыздағы екінші пікір", lead: "Кідіріс кезінде клиент бір басумен жақын адамына банктің Telegram-боты арқылы хабарлайды.", caps: ["1 · Хабарлау", "2 · Сервис қабылдады", "3 · Күдік"],
      points: ["Сенімді адам ботқа қосылып, келісімін өзі береді.", "Телефондағы мәртебе: жіберілді → растады / күдік туралы хабарлады.", "Сенімді адам аударымды мақұлдай алмайды — тек ескертеді."] },
    s6: { title: "SOC панелі: тәуекелдің толық көрінісі", lead: "Аналитик әр аударымды, шешімді және оның себебін нақты уақытта көреді.",
      points: ["Іздеу және мәртебе сүзгілері бар шешімдер тізімі", "Кідірістегі сома мен скорер p95 бір экранда", "Проекторға арналған көрсету режимі"] },
    s7: { title: "Граф дроп-хабты көрсетеді", lead: "Алушы көп жіберушіден ақша жинап, оны бірден әрі қарай шығарады — аударым түсіндірмесімен бұғатталды.", cap: "Гибридті бағалау: ережелер + граф + Random Forest. Үлестер — ағаш жолдары, SHAP емес." },
    s8: { title: "Тірі демо: қазылар телефонынан аударым", lead: "Проектордағы QR-кодты сканерлеңіз → өз телефоныңыздан аударым жасаңыз → ол бірден SOC тізімінде шығады.", caps: ["Проектор: QR-коды бар SOC панелі", "Қазылар телефоны"] },
    s9: { stats: [["1 = 1", "бір request_id — бір операция; белгісіз нәтиже қайта жіберуді тоқтатады"], ["15 мин", "кідірістен кейін алушы тәуекелі қайта тексеріледі"], ["0", "SOC-қа арналған JSON есебінде аты-жөні мен реквизиттер жоқ"], ["96", "интерфейстің автоматты браузерлік тексерісі"]] },
    s10: { pilot: "Пилот: төлемдерге әсер етпейтін 6 апта", ask: "BCC-ден не сұраймыз" },
    notes: {
      s2: "Клиенттің жолын нақты экранда көрсетіңіз: қоңырау кезінде депозиттен 900 000 ₸ аудару. Растау бар, пароль дұрыс — бірақ шешім таңылған. Saq Bol ақша кетпей тұрып араласады.",
      s4: "Сауалнаманың үш қадамын көрсетіңіз. Таймер өздігінен ештеңе жібермейді, ал қауіпті жауаптар аударымды бірден бұғаттайды. Таза жауаптар алаяқтық жоқ екенін дәлелдемейді.",
      s5: "Сенімді адам Telegram-бот арқылы қосылған (демода — жалған Telegram мен симулятор). Экранда: батырма, «Сервис қабылдады» мәртебесі және күдік туралы хабар. Сенімді адам аударымды мақұлдай да, жібере де алмайды.",
      s6: "Бұл телефондағы сол транзакция: клиент экранынан SOC-қа дейін бір ID. Экрандағы сандар — синтетикалық демо деректер, банк статистикасы емес.",
      s8: "Қорғау сценарийі: қазылар мүшесі көрсету режиміндегі QR-ды сканерлеп, өз телефонынан күдікті аударым жасайды, ал проектор оны бірден тізімде көрсетеді. Телефон мен ноутбук бір Wi-Fi желісінде; демо BCC_MOBILE_LAN=true арқылы іске қосылады.",
      s9: "Тек сәтті жолды емес, байланыс үзілуін, қайталауды, кідірістің аяқталуын және қалпына келтіруді тексереміз. Браузерлік тексерулер саны — qa-mobile-soc.cjs скриптінен.",
    },
  },
};

async function build(lang) {
  const t = T[lang]; const img = n => path.join(IMG, lang, `${n}.png`);
  const pres = new pptxgen(); pres.layout = "LAYOUT_WIDE"; pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = lang === "kk" ? "Saq Bol — питч" : "Saq Bol — питч"; pres.author = "Saq Bol team";
  const C = pres.SchemeColor;
  pres.defineSlideMaster({ title: "CONTENT", background: { color: HEX.pale },
    objects: [{ text: { text: t.footer, options: { x: 0.6, y: 7.05, w: 9, h: 0.3, fontSize: 10, color: HEX.muted, margin: 0 } } }],
    slideNumber: { x: 12.2, y: 7.05, w: 0.55, h: 0.3, fontSize: 10, color: HEX.muted, align: "right" },
    placeholders: [] });
  pres.defineSlideMaster({ title: "DARK", background: { color: HEX.dark },
    objects: [{ text: { text: t.footer, options: { x: 0.6, y: 7.05, w: 9, h: 0.3, fontSize: 10, color: "A6C9B8", margin: 0 } } }],
    slideNumber: { x: 12.2, y: 7.05, w: 0.55, h: 0.3, fontSize: 10, color: "A6C9B8", align: "right" } });
  const W = 13.333;
  const title = (s, text, color = HEX.ink) => s.addText(text, { x: 0.6, y: 0.4, w: 12.1, h: 0.7, fontSize: 30, bold: true, color, margin: 0, valign: "top", fit: "none", isTextBox: true, objectName: "Title" });
  const lead = (s, text, color = HEX.muted) => s.addText(text, { x: 0.6, y: 1.1, w: 12.1, h: 0.45, fontSize: 16, color, margin: 0, valign: "top", isTextBox: true, objectName: "Lead" });
  // A picture at height h (or width w), keeping its pixel aspect ratio.
  const pic = (s, name, x, y, { h, w, shadow = true }) => {
    const { w: pw, h: ph } = sizeOf(img(name)); const ratio = pw / ph;
    const W2 = w ?? h * ratio, H2 = h ?? w / ratio;
    s.addImage({ path: img(name), x, y, w: W2, h: H2, altText: name, objectName: name, ...(shadow ? { shadow: { type: "outer", color: "101828", opacity: 0.18, blur: 14, offset: 4, angle: 90 } } : {}) });
    return { w: W2, h: H2 };
  };
  const caption = (s, text, x, y, w, color = HEX.muted, align = "center") => s.addText(text, { x, y, w, h: 0.32, fontSize: 12, bold: true, color, align, margin: 0, isTextBox: true });
  const numbered = (s, items, x, y, w, step, size = 15, color = HEX.ink) => items.forEach((item, i) => {
    s.addShape(pres.shapes.OVAL, { x, y: y + i * step + 0.02, w: 0.42, h: 0.42, fill: { color: HEX.paleGreen }, line: { color: HEX.green, width: 1 }, objectName: `Num ${i + 1}` });
    s.addText(String(i + 1), { x, y: y + i * step + 0.02, w: 0.42, h: 0.42, fontSize: 13, bold: true, color: "067647", align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(item, { x: x + 0.6, y: y + i * step + 0.07, w: w - 0.6, h: step - 0.1, fontSize: size, color, valign: "top", margin: 0, isTextBox: true });
  });
  const chip = (s, text, x, y, w, fill, color) => s.addText(text, { shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.12, x, y, w, h: 0.44, fontSize: 14, bold: true, color, align: "center", valign: "middle", fill: { color: fill }, line: { color: fill }, margin: 0 });

  // 1 — cover
  let s = pres.addSlide({ masterName: "DARK" });
  s.addText(t.s1.kicker, { x: 0.6, y: 0.9, w: 6.2, h: 0.4, fontSize: 14, bold: true, color: "6EE7A8", margin: 0, isTextBox: true });
  s.addText(t.s1.title, { x: 0.6, y: 1.45, w: 6.2, h: 2.2, fontSize: 40, bold: true, color: HEX.white, valign: "top", margin: 0, isTextBox: true, objectName: "Title" });
  s.addText(P("problem")[lang].lead, { x: 0.6, y: 3.85, w: 5.8, h: 0.9, fontSize: 17, color: "D1E7DD", valign: "top", margin: 0, isTextBox: true });
  t.s1.chips.forEach((c, i) => s.addText(c, { shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.12, x: 0.6 + i * 1.95, y: 5.05, w: 1.8, h: 0.44, fontSize: 13, bold: true, color: HEX.white, align: "center", valign: "middle", fill: { color: "14573F" }, line: { color: "2F7A5C" }, margin: 0 }));
  pic(s, "mobile-form", 7.05, 1.25, { h: 5.3 });
  pic(s, "phone-blocked", 10.55, 1.25, { h: 5.3 });
  pic(s, "mobile-cooling-intro", 8.75, 0.75, { h: 5.95 });
  s.addNotes(P("problem")[lang].note);

  // 2 — problem in screens
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, t.s2.title); lead(s, P("problem")[lang].lead);
  numbered(s, t.s2.steps, 0.6, 1.95, 6.0, 1.15, 17);
  let a = pic(s, "mobile-confirm", 7.15, 1.75, { h: 4.85 }); caption(s, t.s2.caps[0], 7.15, 6.65, a.w);
  a = pic(s, "mobile-cooling-intro", 10.05, 1.75, { h: 4.85 }); caption(s, t.s2.caps[1], 10.05, 6.65, a.w, HEX.amber);
  s.addNotes(t.notes.s2);

  // 3 — three decisions
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, P("decisions")[lang].title); lead(s, P("decisions")[lang].lead);
  const dec = [["phone-approved", HEX.paleGreen, "067647"], ["mobile-cooling-intro", HEX.paleAmber, HEX.amber], ["phone-blocked", HEX.paleRed, "B42318"]];
  dec.forEach(([n, fill, color], i) => {
    const cx = 2.35 + i * 4.3; const { w: pw, h: ph } = sizeOf(img(n)); const h = 4.5, w = h * pw / ph;
    chip(s, t.s3.chips[i], cx - 1.75, 1.75, 3.5, fill, color);
    pic(s, n, cx - w / 2, 2.35, { h });
  });
  s.addNotes(P("decisions")[lang].note);

  // 4 — questionnaire
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, t.s4.title); lead(s, t.s4.lead);
  ["mobile-cooling-intro", "mobile-cooling-question", "mobile-cooling-review"].forEach((n, i) => { const r = pic(s, n, 0.6 + i * 2.75, 1.8, { h: 4.8 }); caption(s, t.s4.caps[i], 0.6 + i * 2.75, 6.65, r.w); });
  numbered(s, t.s4.points, 8.95, 1.95, 3.8, 1.55, 14);
  s.addNotes(t.notes.s4);

  // 5 — trusted contact: the whole sheet, then the block's later states enlarged
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, t.s5.title); lead(s, t.s5.lead);
  a = pic(s, "mobile-trusted-offer", 0.6, 1.8, { h: 4.85 }); caption(s, t.s5.caps[0], 0.6, 6.68, a.w);
  [["card-trusted-sent", 1, HEX.muted], ["card-trusted-suspicion", 2, "B42318"]].forEach(([n, i, color], k) => {
    const x = 3.55 + k * 4.7; caption(s, t.s5.caps[i], x, 1.8, 4.45, color, "left");
    pic(s, n, x, 2.2, { w: 4.45 });
  });
  numbered(s, t.s5.points, 3.55, 4.95, 9.15, 0.62, 14);
  s.addNotes(t.notes.s5);

  // 6 — SOC
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, t.s6.title); lead(s, t.s6.lead);
  pic(s, "soc-full", 0.6, 1.75, { w: 8.2 });
  numbered(s, t.s6.points, 9.5, 1.95, 3.25, 1.3, 15);
  s.addNotes(t.notes.s6);

  // 7 — graph + explanation
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, t.s7.title); lead(s, t.s7.lead);
  pic(s, "soc-graph", 0.6, 1.95, { w: 8.3 });
  a = pic(s, "soc-analysis", 9.25, 1.95, { w: 3.5 });
  s.addText(t.s7.cap, { x: 9.25, y: 1.95 + a.h + 0.2, w: 3.5, h: 1.0, fontSize: 12, color: HEX.muted, valign: "top", margin: 0, isTextBox: true });
  s.addNotes(P("pipeline")[lang].note);

  // 8 — live demo with the jury's phone
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, t.s8.title); lead(s, t.s8.lead);
  a = pic(s, "soc-qr", 0.85, 1.8, { w: 7.5 }); caption(s, t.s8.caps[0], 0.85, 1.8 + a.h + 0.12, a.w);
  s.addShape(pres.shapes.RIGHT_ARROW, { x: 8.95, y: 3.95, w: 0.6, h: 0.45, fill: { color: HEX.green }, line: { color: HEX.green }, rotate: 180, objectName: "Arrow phone to SOC" });
  a = pic(s, "mobile-form", 10.15, 1.75, { h: 4.8 }); caption(s, t.s8.caps[1], 10.15, 6.65, a.w);
  s.addNotes(t.notes.s8);

  // 9 — proof
  s = pres.addSlide({ masterName: "CONTENT" });
  title(s, P("proof")[lang].title); lead(s, P("proof")[lang].lead);
  t.s9.stats.forEach(([big, text], i) => {
    const x = 0.6 + (i % 2) * 4.0, y = 1.9 + Math.floor(i / 2) * 2.45;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 3.75, h: 2.2, rectRadius: 0.12, fill: { color: HEX.white }, line: { color: HEX.line, width: 0.75 }, objectName: `Stat ${i + 1}` });
    s.addText(big, { x: x + 0.3, y: y + 0.2, w: 3.2, h: 0.85, fontSize: 40, bold: true, color: "067647", margin: 0, isTextBox: true });
    s.addText(text, { x: x + 0.3, y: y + 1.1, w: 3.2, h: 0.95, fontSize: 13, color: HEX.ink, valign: "top", margin: 0, isTextBox: true });
  });
  pic(s, "soc-case", 8.9, 1.9, { h: 4.7 });
  s.addNotes(`${P("proof")[lang].note}\n\n${t.notes.s9}`);

  // 10 — pilot + ask
  s = pres.addSlide({ masterName: "DARK" });
  title(s, P("ask")[lang].title, HEX.white); lead(s, P("ask")[lang].lead, "D1E7DD");
  s.addText(t.s10.pilot, { x: 0.6, y: 1.85, w: 4.6, h: 0.4, fontSize: 16, bold: true, color: "6EE7A8", margin: 0, isTextBox: true });
  P("pilot")[lang].points.forEach((p, i) => {
    const [head, ...rest] = p.split(": ");
    s.addText([{ text: head, options: { bold: true, color: HEX.white, breakLine: true } }, { text: rest.join(": "), options: { color: "D1E7DD" } }], { x: 0.6, y: 2.4 + i * 1.3, w: 4.5, h: 1.15, fontSize: 14, valign: "top", margin: 0, isTextBox: true });
  });
  s.addText(t.s10.ask, { x: 5.55, y: 1.85, w: 4.0, h: 0.4, fontSize: 16, bold: true, color: "6EE7A8", margin: 0, isTextBox: true });
  P("ask")[lang].points.forEach((p, i) => {
    s.addShape(pres.shapes.OVAL, { x: 5.55, y: 2.45 + i * 1.3, w: 0.42, h: 0.42, fill: { color: "14573F" }, line: { color: "6EE7A8", width: 1 } });
    s.addText(String(i + 1), { x: 5.55, y: 2.45 + i * 1.3, w: 0.42, h: 0.42, fontSize: 13, bold: true, color: HEX.white, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(p, { x: 6.15, y: 2.4 + i * 1.3, w: 3.5, h: 1.15, fontSize: 14, color: HEX.white, valign: "top", margin: 0, isTextBox: true });
  });
  pic(s, "mobile-trusted-suspicion", 10.25, 1.75, { h: 5.0 });
  s.addNotes(`${P("ask")[lang].note}\n\n${P("pilot")[lang].note}`);

  const file = path.join(OUT, `BCC-Shield-pitch-${lang}.pptx`);
  await pres.writeFile({ fileName: file });
  await applyTheme(file, THEME);
  console.log("wrote", file);
}
(async () => { for (const lang of ["ru", "kk"]) await build(lang); })().catch(e => { console.error(e); process.exit(1); });
