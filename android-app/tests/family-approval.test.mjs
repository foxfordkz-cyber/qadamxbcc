import assert from "node:assert/strict";
import test from "node:test";
import { secondConfirmationView, secondSettingsView } from "../www/guardian.mjs";

const ru = (russian) => russian;
const kk = (_, kazakh) => kazakh;
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const button = (action, label) => '<button data-action="' + action + '">' + label + '</button>';
const when = () => "15:30";
const money = value => value + " ₸";
const settings = {
  channel:"jury", threshold_kzt:"250000", contact_id:null, disable_at:null,
  contacts:[{id:"contact", alias:"<Алия>"}],
};

test("family opt-in selects a verified contact and distinguishes the jury channel from Telegram", () => {
  const panel = secondSettingsView(settings, ru, button, when, money, escape, true);
  assert.match(panel, /учебном кабинете/);
  assert.match(panel, /250000 ₸/);
  assert.match(panel, /&lt;Алия&gt;/);
  assert.match(panel, /name="approval-contact"/);
  assert.match(panel, /href="\/jury"/);
  assert.doesNotMatch(panel, /Telegram/);
  for (const channel of ["simulation","telegram"]) {
    const external = secondSettingsView({...settings,channel}, kk, button, when, money, escape, true);
    assert.doesNotMatch(external, /href="\/jury"/);
    assert.match(external, /Екінші растауды қосу/);
  }
  const unbound = secondSettingsView({...settings,contacts:[]}, ru, button, when, money, escape, true);
  assert.doesNotMatch(unbound, /data-action="second-on"/);
});

test("scheduled deactivation retains the current contact and an explicit option to keep protection", () => {
  const active = {...settings,contact_id:"contact",disable_at:"2026-11-22T10:30:00Z"};
  const panel = secondSettingsView(active, ru, button, when, money, escape, true);
  assert.match(panel, /Отключение после 15:30/);
  assert.match(panel, /Оставить подтверждение включённым/);
  assert.doesNotMatch(panel, /name="approval-contact"/);
});

test("receipt explains exact guardian outcome in both languages", () => {
  for (const [state, ruText, kkText] of [
    ["pending","Ждём подтверждения","растауын күтеміз"],
    ["confirmed","Сумма и получатель подтверждены","Сома мен алушы расталды"],
    ["expired","Срок подтверждения истёк","Растау мерзімі аяқталды"],
    ["unavailable","Подтверждение недоступно","Растау қолжетімсіз"],
    ["suspicious","сообщил о подозрении","күдіктенетінін хабарлады"],
  ]) {
    for (const [translate,label] of [[ru,ruText],[kk,kkText]]) {
      assert.ok(secondConfirmationView({state,expires_at:"2026-11-22T10:30:00Z"},translate,when).includes(label));
    }
  }
  assert.equal(secondConfirmationView(null,ru,when),"");
});
