import { Divider, H1, H2, Link, Select, Stack, Table, Text, useCanvasState } from "cursor/canvas";

const methods = [
  { ru: "Исходные операции", kk: "Бастапқы операциялар", caught: 83, missed: 31, alerts: 124 },
  { ru: "Повтор редких примеров", kk: "Сирек мысалдарды қайталау", caught: 90, missed: 24, alerts: 107 },
  { ru: "Синтетические примеры", kk: "Синтетикалық мысалдар", caught: 91, missed: 23, alerts: 117 },
];

const datasets = [
  { name: "ULB / Worldline", url: "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud",
    ru: "Реальные карточные платежи за два дня в сентябре 2013 года. Подходят для проверки редкого мошенничества. Звонки, ввод и пары отправитель–получатель отсутствуют.",
    kk: "2013 жылғы қыркүйектің екі күніндегі нақты карта төлемдері. Сирек кездесетін алаяқтықты тексеруге жарайды. Қоңырау, енгізу және жіберуші мен алушы жұбы туралы дерек жоқ." },
  { name: "SynSEPA", url: "https://www.kaggle.com/datasets/gauravbajajepitech/synsepa",
    ru: "Синтетические мгновенные переводы. Есть сумма, время, новый получатель и сценарий с лжесотрудником банка. Можно проверить признаки самого перевода. Клавиатурной телеметрии в опубликованной схеме нет.",
    kk: "Синтетикалық жедел аударымдар. Сома, уақыт, жаңа алушы және өзін банк қызметкері ретінде таныстыру сценарийі бар. Аударым белгілерін тексеруге болады. Жарияланған кестеде пернетақта деректері жоқ." },
  { name: "IEEE-CIS / Vesta", url: "https://www.kaggle.com/competitions/ieee-fraud-detection/rules",
    ru: "Реальные онлайн-покупки, для части операций есть сведения об устройстве. Организаторы ограничивают использование данных некоммерческими целями.",
    kk: "Нақты онлайн сатып алулар. Кей операцияларда құрылғы туралы мәлімет бар. Ұйымдастырушылар деректерді коммерциялық емес мақсатта пайдалануға рұқсат береді." },
  { name: "IBM AML", url: "https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml",
    ru: "Синтетическая сеть счетов и переводов с метками отмывания денег. Подходит для проверки движения средств в графе SOC.",
    kk: "Ақшаны жылыстату белгілері бар синтетикалық шоттар мен аударымдар желісі. SOC графындағы ақша қозғалысын тексеруге жарайды." },
  { name: "FCA Digital Sandbox", url: "https://www.fca.org.uk/firms/digital-sandbox/authorised-push-payment-synthetic-data",
    ru: "Набор британского регулятора за пределами Kaggle. Симуляция связывает банковские переводы, события мошенничества и метаданные звонков и SMS. Доступ предоставляется через Digital Sandbox.",
    kk: "Ұлыбритания реттеушісінің Kaggle-ден бөлек деректер жиыны. Симуляция аударымдарды, алаяқтық оқиғаларын және қоңырау мен SMS метадеректерін байланыстырады. Деректер Digital Sandbox арқылы қолжетімді." },
];

export default function KaggleFraudData() {
  const [language, setLanguage] = useCanvasState("kaggle-fraud-language", "ru");
  const [name, setName] = useCanvasState("kaggle-fraud-source", "SynSEPA");
  const kk = language === "kk";
  const source = datasets.find(item => item.name === name) ?? datasets[1];
  return <Stack gap={14}>
    <label><span>{kk ? "Тіл " : "Язык "}</span>
      <Select value={language} onChange={setLanguage} options={[{value:"ru",label:"РУС"},{value:"kk",label:"ҚАЗ"}]} />
    </label>
    <H1>{kk ? "Нақты карта төлемдерінде синтетиканы тексеру" : "Что даёт синтетика на реальных карточных платежах"}</H1>
    <Text>{kk ? "Соңғы уақыт аралығындағы 89 090 нақты операция. Оның 114-і алаяқтық, 88 976-сы заңды төлем." :
      "89 090 реальных операций из последнего периода. Среди них 114 случаев мошенничества и 88 976 честных платежей."}</Text>
    <Table headers={kk ? ["Оқыту тәсілі", "Анықталды", "Өтіп кетті", "Жалған дабыл"] :
      ["Обучение", "Выявлено", "Пропущено", "Ложные тревоги"]}
      columnAlign={["left","right","right","right"]}
      rows={methods.map(m => [kk ? m.kk : m.ru, m.caught, m.missed, m.alerts])} />
    <Text size="small" tone="secondary">{kk ?
      "Дерек көзі — ULB / Worldline, қыркүйек 2013. Бірдей логистикалық регрессия. Алғашқы 24 сағат оқытуға, келесі 12 сағат шекті таңдауға, қалғаны тексеруге бөлінді. Синтетика тек оқытуға қосылды." :
      "Источник — ULB / Worldline, сентябрь 2013. Одна и та же логистическая регрессия. Первые 24 часа отведены на обучение, следующие 12 на выбор порога, остаток на проверку. Синтетические примеры добавлены только в обучение."}</Text>
    <Divider />
    <H2>{kk ? "Saq Bol үшін дерек таңдау" : "Какой набор подходит Saq Bol"}</H2>
    <label><span>{kk ? "Деректер жиыны " : "Набор данных "}</span>
      <Select value={source.name} onChange={setName} options={datasets.map(s => ({value:s.name,label:s.name}))} />
    </label>
    <Text>{kk ? source.kk : source.ru}</Text>
    <Link href={source.url}>{kk ? "Дереккөзді ашу" : "Открыть источник"}</Link>
  </Stack>;
}
