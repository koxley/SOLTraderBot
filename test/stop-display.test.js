import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const refresh=source.slice(source.indexOf('async function refresh()'),source.indexOf('async function balances()'));
const action=source.slice(source.indexOf('async function action(name)'),source.indexOf("for (const name of ['start'"));
test('Stop renders zero immediately even if subsequent polling fails and an older response arrives late',async()=>{
  let releaseOld, reads=0;
  const shown=[], elements={};
  const sandbox={state:{mode:'paper',realized:0.25,running:true,demo:true},stateRevision:0,actionBusy:false,
    recentSince:0,livePrice:null,Date,tg:null,toast:()=>{},text:()=>{},balances:async()=>{},
    $:id=>elements[id]||={},
    api:async name=>{
      if(name==='stop')return{mode:'paper',realized:0,running:false};
      if(++reads===1)return new Promise(resolve=>releaseOld=resolve);
      throw Error('Temporary polling failure');
    },render:next=>{sandbox.state=next;shown.push(next.realized);}};
  vm.createContext(sandbox);vm.runInContext(refresh+action,sandbox);
  const old=sandbox.refresh();
  await sandbox.action('stop');
  assert.equal(sandbox.state.realized,0);assert.equal(sandbox.state.demo,true);
  assert.equal(shown.at(-1),0);
  releaseOld({mode:'paper',realized:0.25,running:true});await old;
  assert.equal(sandbox.state.realized,0);assert.equal(sandbox.state.running,false);
});
