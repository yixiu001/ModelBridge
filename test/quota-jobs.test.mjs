import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QuotaJobs} from '../src/quota-jobs.mjs';
import {parseCodexQuota} from '../src/vendor/codex-quota.mjs';
test('unknown durations and credit-only payloads remain meaningful',()=>{
 const q=parseCodexQuota({rate_limit:{primary_window:{used_percent:10,limit_window_seconds:7200}}});
 assert.equal(q.windows[0].label,'2 小时');
 assert.equal(parseCodexQuota({credits:{balance:'2.5'}}).creditBalance,'2.5');
 assert.equal(parseCodexQuota({rate_limit:{primary_window:{reset_after_seconds:60}}}).windows[0].usedPercent,null);
});
test('quota jobs deduplicate active requests, continue partial failures and cancel late results',async()=>{
 let release;let called=[];const account={credentialRevision:1};
 const q=new QuotaJobs({getAccount:()=>account,query:async(key,{signal,canCommit})=>{called.push(key);if(key==='a')await new Promise(r=>release=r);if(key==='b')throw new Error('failed');return {status:'available',committed:canCommit()};},persist:async()=>{}});
 const first=await q.start({accountKeys:['a','b']});assert.equal((await q.start({accountKeys:['a','b']})).jobId,first.jobId);
 await new Promise(r=>setImmediate(r));q.cancel(first.jobId);release();await q.settled;
 assert.equal(q.read(first.jobId).items[0].state,'cancelled');assert.equal(q.read(first.jobId).items[1].state,'cancelled');assert.deepEqual(called,['a']);
 const second=await q.start({accountKeys:['b','c']});await q.settled;
 assert.deepEqual(q.read(second.jobId).items.map(i=>i.state),['failed','succeeded']);
});
test('changed credentials and restart never adopt stale quota results',async()=>{
 let release;let account={credentialRevision:1};
 const q=new QuotaJobs({getAccount:()=>account,query:async()=>{await new Promise(r=>release=r);return {status:'available'};},persist:async()=>{}});
 const {jobId}=await q.start({accountKeys:['a']});await new Promise(r=>setImmediate(r));account={credentialRevision:2};release();await q.settled;assert.equal(q.read(jobId).items[0].state,'cancelled');
 q.hydrate([{id:'old',state:'running',items:[{key:'a',state:'running'}]}]);assert.equal(q.read('old').state,'interrupted');assert.equal(q.read('old').items[0].state,'cancelled');
});
