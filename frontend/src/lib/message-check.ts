// Only categories leave the text field. Never render, log or persist the original message.
const rules = {
  bankClaim: /(?:я|мы|это)\s+(?:из\s+)?(?:сотрудник|служб[аы] безопасности|из банка)|(?:банк|полиция) қызметкері(?:мін|міз)/iu,
  safeAccount: /(?:переведите|переведи|перевести|сбросьте).{0,65}безопасн.{1,6}сч[её]т|қауіпсіз шотқа.{0,45}(?:аудар|жібер)/iu,
  secrecy: /(?:никому не говори|держите в (?:тайне|секрете)|установите приложение|ешкімге айтпа|қолданба(?:ны)? орнат)/iu,
  codeRequest: /(?<!не )(?:сообщи(?:те)?|назови(?:те)?|продиктуй(?:те)?|отправь(?:те)?|пришли(?:те)?)\s+(?:(?:мне|нам|смс|sms)[ -]+){0,2}код|код(?:ты|ын|ты маған)\s+(?:айтыңыз|айтшы|жіберіңіз|жіберші)/iu,
} as const;

export type MessageSignal = keyof typeof rules;
export function messageSignals(text: string): MessageSignal[] {
  const normalized = text.slice(0, 2000).normalize("NFKC").replace(/\s+/gu, " ");
  return (Object.keys(rules) as MessageSignal[]).filter(key => rules[key].test(normalized));
}
