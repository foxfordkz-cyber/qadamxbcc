"""Kazakh 10-slide BCC Shield pitch as one self-contained animated HTML file."""
import base64, json, sys
from pathlib import Path

WEB = Path("/tmp/deckbuild/web")
pitch = json.loads(Path(sys.argv[1]).read_text("utf8"))
P = {s["id"]: s["kk"] for s in pitch["slides"]}
imgs = {p.stem: "data:image/webp;base64," + base64.b64encode(p.read_bytes()).decode() for p in WEB.glob("*.webp")}

def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
def img(name, cls="", d=0, alt=""): return f'<img class="a {cls}" style="--d:{d}ms" data-img="{name}" alt="{esc(alt or name)}">'
def steps(items, d0=300, gap=140, cls=""):
    return f'<ol class="steps {cls}">' + "".join(f'<li class="a" style="--d:{d0+i*gap}ms"><b>{i+1}</b><span>{esc(t)}</span></li>' for i, t in enumerate(items)) + "</ol>"
def head(title, lead): return f'<h2 class="a" style="--d:80ms">{esc(title)}</h2><p class="lead a" style="--d:200ms">{esc(lead)}</p>'

slides = []
# 1 cover
slides.append(("dark", "zoom", f'''
<div class="cover-text">
  <p class="kicker a" style="--d:100ms">BCC Shield · ITU Hackathon 2026</p>
  <h1 class="a" style="--d:250ms">Алаяққа аударымды жібермей тұрып тоқтату</h1>
  <p class="lead a" style="--d:450ms">{esc(P["problem"]["lead"])}</p>
  <div class="chips">{"".join(f'<span class="chip a" style="--d:{600+i*120}ms">{c}</span>' for i, c in enumerate(["bcc.kz клиенті", "SOC панелі", "ҚАЗ / РУС"]))}</div>
</div>
<div class="fan">
  {img("mobile-form", "phone p1 float", 500, "Аударым формасы")}
  {img("phone-blocked", "phone p3 float", 700, "Бұғатталған аударым")}
  {img("mobile-cooling-intro", "phone p2 float", 900, "Кідіріс")}
</div>''', P["problem"]["note"]))
# 2 problem
slides.append(("light", "slide", f'''{head("«Банктен» қоңырау — клиент ақшаны өзі аударады", P["problem"]["lead"])}
<div class="row">
  {steps(["Қоңырау шалушы өзін банк немесе полиция қызметкері деп таныстырады", "Депозиттегі ақшаны «қауіпсіз шотқа» аударуды сұрайды", "Клиент 900 000 ₸ енгізіп, растайды: пароль дұрыс, бірақ шешімді басқа адам таңған", "BCC Shield ақша кетпей тұрып аударымды кідіртеді"], cls="big")}
  <div class="phones">
    <figure>{img("mobile-confirm", "phone", 600)}<figcaption class="a" style="--d:800ms">Аударымды растау</figcaption></figure>
    <div class="arrow a" style="--d:900ms">→</div>
    <figure>{img("mobile-cooling-intro", "phone glow-amber", 1000)}<figcaption class="a amber" style="--d:1200ms">15 минуттық кідіріс</figcaption></figure>
  </div>
</div>''', "Клиенттің жолын нақты экранда көрсетіңіз: қоңырау кезінде депозиттен 900 000 ₸ аудару. Растау бар, пароль дұрыс — бірақ шешім таңылған. BCC Shield ақша кетпей тұрып араласады."))
# 3 decisions
dec = [("phone-approved", "0–39 · рұқсат ету", "ok"), ("mobile-cooling-intro", "40–74 · 15 минут кідірту", "warn"), ("phone-blocked", "75–100 · бұғаттау", "bad")]
slides.append(("light", "rise", head(P["decisions"]["title"], P["decisions"]["lead"]) + '<div class="trio">' + "".join(
    f'<figure><span class="score {c} a" style="--d:{300+i*250}ms">{esc(t)}</span>{img(n, "phone", 450+i*250)}</figure>' for i, (n, t, c) in enumerate(dec)) + "</div>", P["decisions"]["note"]))
# 4 questionnaire
slides.append(("light", "flip", head("Тоқтауға 15 минут", "Кідіріс сауалнамасы: түсіндірме, «иә / жоқ» бес сұрақ, жауаптарды тексеру.") + '<div class="row"><div class="trio small">' + "".join(
    f'<figure>{img(n, "phone", 300+i*200)}<figcaption class="a" style="--d:{500+i*200}ms">{c}</figcaption></figure>' for i, (n, c) in enumerate([("mobile-cooling-intro", "Кідіріс"), ("mobile-cooling-question", "Сұрақтар"), ("mobile-cooling-review", "Тексеру")])) + "</div>" +
    steps(["Таймер ақшаны жібермейді: 15 минуттан кейін қайта растау керек, алушы тәуекелі қайта тексеріледі.", "Алаяқтық белгілері бар жауаптар («банктен қоңырау», «қауіпсіз шот») аударымды бірден бұғаттайды.", "Аударымнан кез келген уақытта бас тартуға болады — бұл серверлік әрекет."], 900, 200, "side") + "</div>",
    "Сауалнаманың үш қадамын көрсетіңіз. Таймер өздігінен ештеңе жібермейді, ал қауіпті жауаптар аударымды бірден бұғаттайды. Таза жауаптар алаяқтық жоқ екенін дәлелдемейді."))
# 5 trusted contact
slides.append(("light", "slide", head("Сенімді адам — жаныңыздағы екінші пікір", "Кідіріс кезінде клиент бір басумен жақын адамына банктің Telegram-боты арқылы хабарлайды.") + f'''
<div class="row trusted">
  <figure>{img("mobile-trusted-offer", "phone", 300)}<figcaption class="a" style="--d:500ms">1 · Хабарлау</figcaption></figure>
  <div class="cards">
    <figure><figcaption class="a left" style="--d:700ms">2 · Сервис қабылдады</figcaption>{img("card-trusted-sent", "card", 800)}</figure>
    <figure><figcaption class="a left red" style="--d:1300ms">3 · Күдік</figcaption>{img("card-trusted-suspicion", "card shake", 1400)}</figure>
    {steps(["Сенімді адам ботқа қосылып, келісімін өзі береді.", "Телефондағы мәртебе: жіберілді → растады / күдік туралы хабарлады.", "Сенімді адам аударымды мақұлдай алмайды — тек ескертеді."], 1900, 160, "wide")}
  </div>
</div>''', "Сенімді адам Telegram-бот арқылы қосылған (демода — жалған Telegram мен симулятор). Экранда: батырма, «Сервис қабылдады» мәртебесі және күдік туралы хабар. Сенімді адам аударымды мақұлдай да, жібере де алмайды."))
# 6 SOC
slides.append(("light", "zoom", head("SOC панелі: тәуекелдің толық көрінісі", "Аналитик әр аударымды, шешімді және оның себебін нақты уақытта көреді.") + f'''
<div class="row"><div class="shot-wrap a" style="--d:300ms">{img("soc-full", "shot kenburns", 300)}<span class="pulse-dot" style="left:7.5%;top:63%"></span></div>
{steps(["Іздеу және мәртебе сүзгілері бар шешімдер тізімі", "Кідірістегі сома мен скорер p95 бір экранда", "Проекторға арналған көрсету режимі"], 800, 220, "side")}</div>''',
    "Бұл телефондағы сол транзакция: клиент экранынан SOC-қа дейін бір ID. Экрандағы сандар — синтетикалық демо деректер, банк статистикасы емес."))
# 7 graph
slides.append(("light", "rise", head("Граф дроп-хабты көрсетеді", "Алушы көп жіберушіден ақша жинап, оны бірден әрі қарай шығарады — аударым түсіндірмесімен бұғатталды.") + f'''
<div class="row"><div class="shot-wrap a" style="--d:300ms">{img("soc-graph", "shot draw", 300)}</div>
<div class="side-col">{img("soc-analysis", "shot", 900)}<p class="note a" style="--d:1200ms">Гибридті бағалау: ережелер + граф + Random Forest. Үлестер — ағаш жолдары, SHAP емес.</p></div></div>''', P["pipeline"]["note"]))
# 8 live demo
slides.append(("light", "flip", head("Тірі демо: қазылар телефонынан аударым", "Проектордағы QR-кодты сканерлеңіз → өз телефоныңыздан аударым жасаңыз → ол бірден SOC тізімінде шығады.") + f'''
<div class="row demo">
  <figure class="grow">{img("soc-qr", "shot", 300)}<span class="qr-ring a" style="--d:900ms"></span><figcaption class="a" style="--d:700ms">Проектор: QR-коды бар SOC панелі</figcaption></figure>
  <div class="beam a" style="--d:1100ms"><i></i><i></i><i></i></div>
  <figure>{img("mobile-form", "phone float", 1300)}<figcaption class="a" style="--d:1500ms">Қазылар телефоны</figcaption></figure>
</div>''', "Қорғау сценарийі: қазылар мүшесі көрсету режиміндегі QR-ды сканерлеп, өз телефонынан күдікті аударым жасайды, ал проектор оны бірден тізімде көрсетеді. Телефон мен ноутбук бір Wi-Fi желісінде; демо BCC_MOBILE_LAN=true арқылы іске қосылады."))
# 9 proof
stats = [("1 = 1", None, "бір request_id — бір операция; белгісіз нәтиже қайта жіберуді тоқтатады"), ("15", " мин", "кідірістен кейін алушы тәуекелі қайта тексеріледі"), ("0", "", "SOC-қа арналған JSON есебінде аты-жөні мен реквизиттер жоқ"), ("96", "", "интерфейстің автоматты браузерлік тексерісі")]
cells = "".join(f'<div class="stat a" style="--d:{300+i*180}ms"><strong>' + (f'<span class="count" data-to="{b}">0</span>{u}' if u is not None else esc(b)) + f'</strong><span>{esc(t)}</span></div>' for i, (b, u, t) in enumerate(stats))
slides.append(("light", "slide", head(P["proof"]["title"], P["proof"]["lead"]) + f'<div class="row"><div class="stats">{cells}</div>{img("soc-case", "shot case", 900)}</div>',
    P["proof"]["note"] + "\n\nТек сәтті жолды емес, байланыс үзілуін, қайталауды, кідірістің аяқталуын және қалпына келтіруді тексереміз."))
# 10 close
pilot = "".join(f'<li class="a" style="--d:{400+i*200}ms"><b>{esc(p.split(": ")[0])}</b><span>{esc(": ".join(p.split(": ")[1:]))}</span></li>' for i, p in enumerate(P["pilot"]["points"]))
slides.append(("dark", "zoom", f'''<h2 class="a" style="--d:80ms">{esc(P["ask"]["title"])}</h2><p class="lead a" style="--d:200ms">{esc(P["ask"]["lead"])}</p>
<div class="row close">
  <div><h3 class="a" style="--d:300ms">Пилот: төлемдерге әсер етпейтін 6 апта</h3><ol class="timeline">{pilot}</ol></div>
  <div><h3 class="a" style="--d:900ms">BCC-ден не сұраймыз</h3>{steps(P["ask"]["points"], 1000, 200, "dark")}</div>
  {img("mobile-trusted-suspicion", "phone float", 1400)}
</div>''', P["ask"]["note"] + "\n\n" + P["pilot"]["note"]))

sections = "\n".join(f'<section class="slide {theme}" data-t="{t}" data-notes="{esc(n)}">{body}</section>' for theme, t, body, n in slides)
html = Path("/tmp/deckbuild/template.html").read_text("utf8").replace("{{SLIDES}}", sections).replace("{{IMGS}}", json.dumps(imgs))
Path(sys.argv[2]).write_text(html, "utf8")
print("ok", len(html) // 1024, "KB")
