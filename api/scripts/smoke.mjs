// End-to-end smoke test against RUNNING Docker Compose. Uses only Node 22 builtin fetch.
// Usage: node api/scripts/smoke.mjs (WARNING: creates a disposable demo company).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const url=process.env.JAWAHER_API_URL||'http://localhost:4000';
let cookie='';
async function call(method,path,body,expected=200){
 const res=await fetch(url+path,{method,headers:{'Content-Type':'application/json','X-Jawaher-Client':'web',...(cookie?{Cookie:cookie}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 if(res.headers.get('set-cookie')) cookie=res.headers.get('set-cookie').split(';')[0];
 const response=await res.json();
 assert.equal(res.status,expected,`${method} ${path} status ${res.status}: ${JSON.stringify(response)}`);
 return response;
}
const password='ExampleSmokeP4ssword123!';
const account=`smoke.${randomUUID().slice(0,12)}@jawaher.example`;
const result=await call('POST','/auth/register',{email:account,password,companyName:'منشأة اختبار معزولة'},201);
assert.equal(result.user.email,account);
const cid=result.company.id,root=`/companies/${cid}`;
const companies=await call('GET','/companies');assert.equal(companies.length,1);
const accounts=await call('GET',root+'/accounts');assert(accounts.length>=10);
const periods=await call('GET',root+'/periods');assert.equal(periods.length,1);
const accountByCode=x=>accounts.find(a=>a.code===x).id;
const body={periodId:periods[0].id,entryDate:new Date().toISOString().slice(0,10),memo:'تجربة ترحيل رأس مال',
 idempotencyKey:randomUUID(),lines:[
  {accountId:accountByCode('1200'),debit:'100.01',credit:'0'},
  {accountId:accountByCode('3100'),debit:'0',credit:'100.01'}]};
const draft=await call('POST',root+'/journals',body,201);
assert.equal(draft.status,'draft');
await call('POST',root+'/journals',body,409); // idempotency key protects against duplicates
const posting=await call('POST',root+'/journals/'+draft.id+'/post',{},201);
assert.equal(posting.status,'posted');
await call('POST',root+'/journals/'+draft.id+'/post',{},409); // cannot post twice
const report=await call('GET',root+'/reports/trial-balance?asOf='+body.entryDate);
assert.equal(report.totals.debit,'100.01');assert.equal(report.totals.credit,'100.01');
const events=await call('GET',root+'/audit');assert(events.some(e=>e.event==='journal.posted'));
await call('POST','/auth/logout',{},201);
await call('GET',root+'/accounts',undefined,401);
console.log('PASS: register / access / ledger / idempotency / posting / trial balance / audit / logout');
