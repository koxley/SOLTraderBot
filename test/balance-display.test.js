import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const functions=app.slice(app.indexOf('function renderReturnUSDT()')).replace('\nrefreshReturnRate();','').replace('setInterval(refreshReturnRate, 5000);','');
test('balance equivalent renders, survives brief quote outages with a label, expires and recovers', async()=>{
  let now=1000, fail=false, calls=0;
  const elements={}, labels={};
  const sandbox={state:{quote:'SOL',realized:0,market:{executable:true}},availableSOL:1,
    returnRate:null,returnRateAt:0,returnRateBusy:false,Date:{now:()=>now},
    $:id=>elements[id]||=( {} ),text:(id,value)=>labels[id]=value,number:(value)=>String(value),
    api:async()=>{calls++;if(fail)throw Error('offline');return{currency:'SOL',rate:117};}};
  vm.createContext(sandbox);vm.runInContext(functions,sandbox);
  await sandbox.refreshReturnRate();
  assert.equal(labels['available-usdt'],'≈ 117 USDT');assert.equal(elements['available-usdt'].hidden,false);
  now+=5000;await sandbox.refreshReturnRate();assert.equal(calls,1);
  fail=true;now+=60000;await sandbox.refreshReturnRate();
  assert.equal(labels['available-usdt'],'≈ 117 USDT · delayed estimate');
  now+=300000;await sandbox.refreshReturnRate();assert.equal(labels['available-usdt'],'USDT equivalent unavailable');
  fail=false;await sandbox.refreshReturnRate();assert.equal(labels['available-usdt'],'≈ 117 USDT');
  sandbox.availableSOL=0;sandbox.renderAvailableUSDT();assert.equal(labels['available-usdt'],'≈ 0 USDT');
  sandbox.availableSOL=null;sandbox.renderAvailableUSDT();assert.equal(labels['available-usdt'],'USDT equivalent unavailable');
  sandbox.state.market.executable=false;sandbox.renderAvailableUSDT();assert.equal(elements['available-usdt'].hidden,true);
});
