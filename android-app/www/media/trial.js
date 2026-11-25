const el = (id) => document.getElementById(id);
const copy = {
  format: ["CSV пішімін үлгімен салыстырыңыз. Баған атаулары дәл келуі керек.", "Проверьте заголовки, кодировку и разделители по образцу CSV."],
  file_limit: ["Файл көлемі 32 КиБ-тан асты.", "Файл превышает 32 КиБ."],
  row_limit: ["Ең көбі 32 жол қабылданады.", "Можно проверить до 32 строк."],
  label_ids: ["Жауаптар қабылданған ID-лерге дәл сәйкес келуі тиіс.", "Каждый принятый ID должен иметь ровно один ответ."],
  forecast_changed: ["Бөлмедегі болжам өзгерді. Бетті жаңартыңыз.", "Прогноз комнаты изменился. Обновите страницу."],
  room: ["Бөлме жабылды. Жеке сынақты қайта ашыңыз.", "Комната закрылась. Откройте личную проверку снова."],
  busy: ["Басқа есептеу жүріп жатыр. Қайталап көріңіз.", "Идёт другое вычисление. Попробуйте ещё раз."],
  failed: ["Сұрау орындалмады. Қайталап көріңіз.", "Запрос не выполнен. Попробуйте ещё раз."],
  no_cases: ["Жарамды жолдар жоқ.", "В файле нет корректных строк."],
  duplicate: ["ID қайталанады", "ID повторяется"],
  field: ["Мәнді тексеріңіз", "Проверьте значение"],
  columns: ["Бағандар саны сәйкес келмейді", "Неверное число колонок"],
  progress: ["Есептелуде…", "Идёт расчёт…"],
  results: ["Жүктелген жауаптар бойынша нәтиже", "Результат по загруженным ответам"],
  outcome: ["Нәтиже", "Исход"],
  incumbent: ["Қолданыстағы", "Действующая"],
  candidate: ["Үміткер", "Кандидат"],
  caught: ["Тоқтатылған алаяқтық", "Мошеннические на паузе"],
  missed: ["Өткізіп алған алаяқтық", "Пропущенные мошеннические"],
  false_pauses: ["Адал төлемдердегі артық кідіріс", "Задержанные честные"],
  honest_approved: ["Өткен адал төлемдер", "Одобренные честные"],
};
function bilingual(kk, ru) {
  const fragment = document.createDocumentFragment();
  for (const [lang, text] of [["kk", kk], ["ru", ru]]) {
    const span = document.createElement("span");
    span.lang = lang;
    span.textContent = text;
    fragment.append(span);
  }
  return fragment;
}
function translated(key) { return bilingual(...(copy[key] || copy.failed)); }
function showIssues(target, issues) {
  if (!issues?.length) return;
  const list = document.createElement("ul");
  for (const item of issues) {
    const li = document.createElement("li");
    li.append(bilingual(item.line + "-жол · ", "Строка " + item.line + " · "), translated(item.code));
    if (item.field) li.append(" (" + item.field + ")");
    list.append(li);
  }
  target.append(list);
}
function feedback(code) { el("feedback").replaceChildren(...(code ? [translated(code)] : [])); }
let sha = "";
let selected = null;
let sequence = 0;
let gradeSequence = 0;
function showRun(hash) {
  sha = hash || "";
  el("saved").hidden = !sha;
  el("hash").textContent = sha;
  el("download").href = "/jury/trial/forecast/" + sha;
  el("labels").value = "";
  el("grades").replaceChildren();
  gradeSequence++;
}
async function request(path, file) {
  if (file && file.size > 32768) throw {error: "file_limit"};
  const response = await fetch("/jury/trial/" + path, file ? {
    method: "POST", body: file, headers: {"Content-Type": "text/csv"}, cache:"no-store",
  } : {cache:"no-store"});
  const result = await response.json();
  if (!response.ok) throw result;
  return result;
}
function problem(e, target) {
  feedback(e.error);
  showIssues(target, e.issues);
  if (e.error === "room") { el("workspace").hidden = true; el("start").hidden = false; }
}
el("cases").addEventListener("change", async () => {
  const id = ++sequence;
  selected = null;
  el("freeze").disabled = true;
  el("preview").replaceChildren();
  feedback();
  const file = el("cases").files[0];
  if (!file) return;
  try {
    const data = await request("preview", file);
    if (id !== sequence) return;
    const skipped = data.issues.length;
    el("preview").append(bilingual("Қабылданды: " + data.accepted + ". Қате жолдар: " + skipped,
      "Принято строк: " + data.accepted + ". Отклонено: " + skipped));
    showIssues(el("preview"), data.issues);
    if (data.accepted) { selected = file; el("freeze").disabled = false; }
  } catch (e) { if (id === sequence) problem(e, el("preview")); }
});
el("freeze").addEventListener("click", async () => {
  if (!selected) return;
  el("freeze").disabled = el("cases").disabled = el("labels").disabled = true;
  feedback("progress");
  try {
    const run = await request("freeze", selected);
    showRun(run.sha256); feedback();
  } catch (e) { problem(e, el("preview")); }
  finally { el("cases").disabled = el("labels").disabled = false; el("freeze").disabled = !selected; }
});
el("labels").addEventListener("change", async () => {
  const id = ++gradeSequence;
  const file = el("labels").files[0];
  el("grades").replaceChildren(); feedback();
  if (!file || !sha) return;
  try {
    const data = await request("grade?sha=" + encodeURIComponent(sha), file);
    if (id !== gradeSequence) return;
    const table = document.createElement("table");
    table.createCaption().append(translated("results"));
    const header = table.createTHead().insertRow();
    for (const key of ["outcome", "incumbent", "candidate"]) {
      const th = document.createElement("th"); th.scope = "col"; th.append(translated(key)); header.append(th);
    }
    const body = table.createTBody();
    for (const key of ["caught", "missed", "false_pauses", "honest_approved"]) {
      const row = body.insertRow();
      const th = document.createElement("th"); th.scope = "row"; th.append(translated(key)); row.append(th);
      for (const model of ["incumbent", "candidate"]) row.insertCell().textContent = data[model][key];
    }
    el("grades").append(table);
  } catch (e) { if (id === gradeSequence) problem(e, el("grades")); }
});
request("state").then(state => {
  el("start").hidden = state.room;
  el("workspace").hidden = !state.room;
  showRun(state.sha256);
}).catch(() => feedback("failed"));
