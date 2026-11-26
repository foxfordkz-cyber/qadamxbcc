export function cashWindow(record, {T, E, amount, when, button}) {
  const title = T("Снятие в учебном банкомате", "Оқу банкоматынан ақша алу");
  if (!record || ["cancelled","completed"].includes(record.state)) {
    const receipt = record ? (record.state === "completed" ? T("Учебная выдача подтверждена.", "Оқу операциясы расталды.") : T("Снятие отменено.", "Ақша алу тоқтатылды.")) : "";
    return '<section class="paper"><h1>'+title+'</h1><p role="status">'+receipt+'</p><form id="cash-window-form">'+
      '<label>'+T("Сумма, ₸","Сома, ₸")+'<input name="cashAmount" type="number" step="1" min="1" max="1000000" value="25000" required></label>'+
      '<label>'+T("По звонку вас попросили снять эти деньги?","Қоңырау кезінде осы ақшаны алуды сұрады ма?")+
      '<select name="cashCall" required><option value="">—</option><option value="yes">'+T("Да","Иә")+'</option><option value="no">'+T("Нет","Жоқ")+'</option></select></label>'+
      '<button type="submit">'+T("Проверить снятие","Ақша алуды тексеру")+'</button></form></section>';
  }
  return '<section class="paper"><h1>'+title+'</h1><strong>'+E(amount(record.amount_kzt))+'</strong><p>'+
    (record.state === "cooling_off" ? T("Пауза до ","Кідірістің аяқталуы ") + when(record.until) : T("Можно подтвердить учебную выдачу.","Оқу операциясын растауға болады."))+
    '</p>'+button("cash-confirm",T("Подтвердить выдачу","Ақша алуды растау"))+button("cash-cancel",T("Отменить","Бас тарту"))+'</section>';
}

export function uuidForCash() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const s=Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
  return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join("-");
}
