import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,appendFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ActivityStore} from '../src/activity-store.mjs';
const fixture=async t=>{const dir=await mkdtemp(join(tmpdir(),'mb-activity-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};
const record=(id,usage)=>({id,accountKey:'a',model:'m',requestedModel:'m',effectiveModel:'m',finishedAt:new Date().toISOString(),startedAt:new Date().toISOString(),httpStatus:200,status:'forwarded',usage});
test('activity deduplicates outcomes and preserves unknown usage and secret boundaries',async t=>{
 const dir=await fixture(t),s=new ActivityStore(dir,()=>({loggingToFile:true}));await s.init();
 await s.append({...record('r1'),access_token:'SECRET',prompt:'PRIVATE',failure:{message:'SECRET'}});await s.append(record('r1'));
 await s.append(record('r2',{inputTokens:2,outputTokens:3,totalTokens:5}));
 const sum=s.summary({});assert.equal(sum.requests,2);assert.equal(sum.unknownUsageCount,1);assert.equal(sum.knownUsage.totalTokens,5);
 assert.equal(s.query({}).items.find(r=>r.id==='r1').usage.totalTokens,null);
 const text=JSON.stringify(s.export({}));assert.doesNotMatch(text,/SECRET|PRIVATE|access_token/);
 const loaded=new ActivityStore(dir,()=>({loggingToFile:true}));await loaded.init();assert.equal(loaded.summary({}).requests,2);
});
test('pagination remains stable when new requests arrive and retention is bounded',async t=>{
 const s=new ActivityStore(await fixture(t),()=>({loggingToFile:false,logMaxRecords:3}));await s.init();
 for(const id of ['1','2','3'])await s.append(record(id));const first=s.query({limit:2});assert.deepEqual(first.items.map(r=>r.id),['3','2']);
 await s.append(record('4'));assert.deepEqual(s.query({cursor:first.nextCursor,limit:2}).items.map(r=>r.id),[]);
 assert.equal(s.summary({}).requests,3);assert.equal(s.summary({}).truncated,true);
 assert.deepEqual(await readdir(s.dir),[]);
});
test('corrupt last line is isolated and shutdown/restart do not lose valid rows',async t=>{
 const s=new ActivityStore(await fixture(t),()=>({loggingToFile:true}));await s.init();await s.append(record('1'));
 const [file]=await readdir(s.dir);await appendFile(join(s.dir,file),'BROKEN\n');
 const next=new ActivityStore(s.dataDir,()=>({loggingToFile:true}));await next.init();assert.equal(next.summary({}).requests,1);assert.equal(next.summary({}).invalidRows,1);
});

test('shortened retention applies to reads and disk without a new request',async t=>{
 let days=7;const s=new ActivityStore(await fixture(t),()=>({loggingToFile:true,logRetentionDays:days}));await s.init();
 await s.append({...record('old'),finishedAt:new Date(Date.now()-2*86400000).toISOString()});days=1;
 assert.equal(s.query({}).items.length,0);assert.equal(s.export({}).records.length,0);await s.queue;assert.deepEqual(await readdir(s.dir),[]);
});
