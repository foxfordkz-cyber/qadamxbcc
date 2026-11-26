import test from "node:test";
import assert from "node:assert/strict";
import {cashWindow, uuidForCash} from "../www/cash-window.mjs";

test("cash flow exposes a separate call question, a server deadline and explicit resolution", () => {
  const helpers = {T:(ru)=>ru,E:String,amount:String,when:String,button:(action)=>action};
  assert.match(cashWindow(null,helpers),/По звонку вас попросили снять эти деньги/);
  assert.match(uuidForCash(),/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/);
  const held = cashWindow({state:"cooling_off",until:"12:15",amount_kzt:"25000"},helpers);
  for (const part of ["12:15","cash-cancel","cash-confirm"]) assert.ok(held.includes(part));
  assert.match(cashWindow({state:"cancelled"},helpers),/Снятие отменено/);
});
