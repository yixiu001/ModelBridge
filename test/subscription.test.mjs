import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StandaloneService} from '../src/standalone-service.mjs';
import * as quotaParser from '../src/vendor/codex-quota.mjs';
import {readCodexSubscription} from '../src/codex-subscription.mjs';
import * as consoleUtils from '../web/src/console-utils.mjs';

const usage={rate_limit:{primary_window:{used_percent:12,limit_window_seconds:18000}}};
const expiry='2026-12-14T03:04:05.000Z';
function setup(subscription){
  const calls=[];
  const s=new StandaloneService({dataDir:'.unused',fetcher:async(url,options)=>{
    calls.push({url,options});
    return url.endsWith('/usage')?Response.json(usage):subscription(url,options);
  }});
  s.vault={active:'a',accounts:{a:{access_token:'INFERENCE_SECRET',quotaAuth:{access_token:'QUOTA_SECRET',accountId:'PRIVATE/ID',expiresAt:Date.now()+3600000}},b:{}}};
  return {s,calls};
}

test('subscription dates normalize ISO and seconds/milliseconds without inventing absent dates',()=>{
  for(const value of [expiry,Date.parse(expiry),Date.parse(expiry)/1000,String(Date.parse(expiry)/1000)])
    assert.equal(quotaParser.parseCodexSubscription({active_until:value}),expiry);
  assert.equal(quotaParser.parseCodexSubscription(JSON.stringify({activeUntil:expiry})),expiry);
  for(const value of [null,undefined,'',0,'0',false,-1,Infinity,'garbage','2026-02-30T00:00:00Z','2026-12-14','2026-12-14T03:04:05'])
    assert.equal(quotaParser.parseCodexSubscription({active_until:value}),null);
  assert.equal(quotaParser.parseCodexSubscription({expires_at:expiry}),null);
  assert.equal(quotaParser.parseCodexSubscription([{active_until:expiry}]),null);
});

test('quota reads subscription directly with the same own grant and persists only the safe date',async()=>{
  const {s,calls}=setup(async()=>Response.json({active_until:expiry,private:'PRIVATE_RESPONSE'}));
  const q=await s.quota('a');
  assert.equal(q.subscriptionActiveUntil,expiry);
  assert.equal(q.subscription.status,'available');
  assert.equal(q.status,'available');
  assert.equal(calls.length,2);
  const c=calls.find(c=>c.url.includes('/subscriptions'));
  assert.equal(c.url,'https://chatgpt.com/backend-api/subscriptions?account_id=PRIVATE%2FID');
  assert.equal(c.options.method,'GET');assert.equal(c.options.redirect,'error');
  assert.equal(c.options.headers.Authorization,'Bearer QUOTA_SECRET');
  assert.equal(c.options.headers['Chatgpt-Account-Id'],'PRIVATE/ID');
  assert.ok(c.options.signal);
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE|SECRET/);
  assert.equal(s.quotaSnapshot('a').subscription.activeUntil,expiry);
  assert.equal(s.quotaSnapshot('b'),null);
});

test('subscription 401 and malformed data never invalidate valid usage or its grant',async()=>{
  for(const makeResponse of [()=>Response.json({private:'SECRET'},{status:401}),()=>new Response('not json'),()=>Response.json({active_until:'invalid'})]){
    const {s}=setup(async()=>makeResponse());const q=await s.quota('a');
    assert.equal(q.status,'available');assert.equal(q.windows[0].usedPercent,12);
    assert.equal(q.subscriptionActiveUntil,null);
    assert.ok(['error','unavailable'].includes(q.subscription.status));
    assert.equal(s.vault.accounts.a.quotaAuth.refreshError,undefined);
    assert.doesNotMatch(JSON.stringify(q),/SECRET/);
  }
});

test('a failed subscription refresh retains explicitly historical data without masquerading as current',async()=>{
  let fail=false;const {s}=setup(async()=>fail?new Response('',{status:503}):Response.json({active_until:expiry}));
  const first=await s.quota('a');fail=true;const second=await s.quota('a');
  assert.equal(second.status,'available');assert.equal(second.subscriptionActiveUntil,null);
  assert.equal(second.subscription.status,'error');
  assert.equal(second.subscription.previous.activeUntil,expiry);
  assert.equal(second.subscription.previous.checkedAt,first.subscription.checkedAt);
});

test('cancelling during subscription read never commits a late snapshot',async()=>{
  let entered;const ready=new Promise(r=>entered=r);const controller=new AbortController();
  const {s}=setup(async(_,o)=>{entered();return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));});
  const pending=s.quota('a',{signal:controller.signal});await ready;controller.abort();
  await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(s.quotaSnapshot('a'),null);
  assert.equal(s.quotaReading,false);
});

test('missing account id does not send a subscription request or guess an expiry',async()=>{
  const {s,calls}=setup(()=>assert.fail('unexpected subscription read'));delete s.vault.accounts.a.quotaAuth.accountId;
  const q=await s.quota('a');assert.equal(q.status,'available');assert.equal(calls.length,1);
  assert.equal(q.subscription.status,'unavailable');assert.equal(q.subscriptionActiveUntil,null);
});

test('optional subscription timeout is bounded, aborts the request and never echoes upstream data',async()=>{
  const keepAlive=setTimeout(()=>{},1000);let aborted=false;
  try {
    const r=await readCodexSubscription((_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('SECRET'));},{once:true})),{accountId:'a',access_token:'SECRET'},{timeoutMs:15});
    assert.equal(r.status,'error');assert.equal(r.reason,'timeout');assert.equal(aborted,true);
    assert.doesNotMatch(JSON.stringify(r),/SECRET/);
  } finally {clearTimeout(keepAlive);}
});

test('usage failure cancels optional work before releasing the account fence',async()=>{
  const {s}=setup(()=>{});let cancelled=false;
  s.fetcher=async(url,o)=>url.endsWith('/usage')?new Response('',{status:503}):new Promise((_,reject)=>o.signal.addEventListener('abort',()=>{assert.equal(s.quotaReading,true);cancelled=true;reject(o.signal.reason);},{once:true}));
  const q=await s.quota('a');assert.equal(q.status,'error');assert.equal(cancelled,true);assert.equal(s.quotaReading,false);
});

test('oversized optional payload is rejected without affecting usage',async()=>{
  const {s}=setup(async()=>Response.json({active_until:expiry,private:'x'.repeat(65536)}));
  const q=await s.quota('a');assert.equal(q.status,'available');assert.equal(q.subscription.reason,'invalid_response');
});

test('UI distinguishes unqueried, absent, failed and historical subscription snapshots',()=>{
  assert.equal(consoleUtils.subscriptionSummary(null).message,'尚未查询');
  assert.equal(consoleUtils.subscriptionSummary({subscription:{status:'unavailable',reason:'not_returned'}}).message,'官方未返回订阅到期时间');
  const failed=consoleUtils.subscriptionSummary({subscription:{status:'error',reason:'timeout',previous:{activeUntil:expiry}}});
  assert.equal(failed.activeUntil,null);assert.equal(failed.previous.activeUntil,expiry);assert.match(failed.message,/超时/);
  const stale=consoleUtils.subscriptionSummary({freshness:'stale',subscription:{status:'available',activeUntil:expiry}});
  assert.equal(stale.activeUntil,expiry);assert.match(stale.message,/历史/);
  const past=consoleUtils.subscriptionSummary({freshness:'current',subscription:{status:'available',activeUntil:'2025-01-01T00:00:00Z'}});
  assert.match(past.message,/已到达/);assert.match(past.message,/不据此/);
});
