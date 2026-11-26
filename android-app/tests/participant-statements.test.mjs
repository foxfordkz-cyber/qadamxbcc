import test from "node:test";
import assert from "node:assert/strict";
import {participantStatements} from "../www/participant-statements.mjs";
test("each party sees their own wording and officers see both reported versions",()=>{
  const view=(model)=>participantStatements(model,(ru)=>ru,String,action=>action);
  const sender={answer:"agreed"},recipient={answer:"unexpected"};
  assert.match(view({audience:"recipient"}),/Ожидали ли вы деньги/);
  assert.match(view({audience:"sender"}),/Как вы договорились/);
  assert.doesNotMatch(view({audience:"sender",sender,recipient}),/оказался неожиданным/);
  assert.match(view({audience:"soc",sender,recipient}),/оказался неожиданным/);
  assert.match(view({audience:"soc",sender,recipient}),/согласовали платёж/);
});
