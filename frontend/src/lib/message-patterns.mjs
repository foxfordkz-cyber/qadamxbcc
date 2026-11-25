// Fragments stay in component memory. Only an explicitly selected code may leave the device.
const rules = {
  bankClaim: /(?:я|мы|это)\s+(?:из\s+)?(?:сотрудник|служб[аы] безопасности|из банка)|(?:банк|полиция) қызметкері(?:мін|міз)/iu,
  safeAccount: /(?:переведите|переведи|перевести|сбросьте).{0,65}безопасн.{1,6}сч[её]т|қауіпсіз шотқа.{0,45}(?:аудар(?:ыңыз|шы)?|жібер(?:іңіз|ші)?)(?!\p{L})/iu,
  secrecy: /(?:никому не говори|держите в (?:тайне|секрете)|установите приложение|ешкімге айтпа|қолданба(?:ны)? орнат)/iu,
  codeRequest: /(?<!не )(?:сообщи(?:те)?|назови(?:те)?|продиктуй(?:те)?|отправь(?:те)?|пришли(?:те)?)\s+(?:(?:мне|нам|смс|sms)[ -]+){0,2}код|код(?:ты|ын|ты маған)\s+(?:айтыңыз|айтшы|жіберіңіз|жіберші)/iu,
};

export const signalCodes = ["bankClaim", "safeAccount", "secrecy", "codeRequest"];

export function messageMatches(text) {
  const input = text.slice(0, 2000);
  const chars = [], starts = [], ends = [];
  // NFKC may expand one character, and several spaces may collapse. Keep offsets in
  // the original message so a highlighted fragment is exactly what the client typed.
  for (const { segment, index } of new Intl.Segmenter().segment(input)) {
    for (const unit of segment.normalize("NFKC").split("")) {
      const char = /\s/u.test(unit) ? " " : unit;
      if (char === " " && chars.at(-1) === " ") { ends[ends.length - 1] = index + segment.length; continue; }
      chars.push(char); starts.push(index); ends.push(index + segment.length);
    }
  }
  const normalized = chars.join("");
  return signalCodes.flatMap(code => {
    const result = rules[code].exec(normalized);
    return result ? [{code, phrase: input.slice(starts[result.index], ends[result.index + result[0].length - 1])}] : [];
  });
}
export function messageSignals(text) {
  return messageMatches(text).map(match => match.code);
}
