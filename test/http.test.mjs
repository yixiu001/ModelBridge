import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http.mjs';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

test('loopback control rejects unauthenticated, foreign-host and cross-origin mutations', async () => {
  const service = { status: () => ({ account: { connected: false } }) };
  const server = createApp({ service, controlKey: 'test-control-secret' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: { authorization: 'Bearer test-control-secret' } })).status, 200);
    const foreignHostStatus = await new Promise((resolve,reject) => {
      const r = request(`${base}/api/status`, { headers: { host: 'evil.test', authorization: 'Bearer test-control-secret' } }, response => { response.resume(); resolve(response.statusCode); });
      r.on('error',reject);r.end();
    });
    assert.equal(foreignHostStatus, 403);
    const home = await fetch(base); const cookie = home.headers.get('set-cookie').split(';')[0];
    assert.match(home.headers.get('set-cookie'), /HttpOnly/);
    assert.match(home.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal((await fetch(`${base}/api/status`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/login`, { method: 'POST', headers: { cookie, origin: 'https://evil.test', 'content-type':'application/json' }, body:'{}' })).status, 403);
    assert.equal((await fetch(`${base}/api/login`, { method: 'GET', headers: { cookie } })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('request parsing preserves UTF-8 characters split across network chunks',async()=>{
  let received;
  const server=createApp({service:{chat:async body=>{received=body;return {ok:true};}},controlKey:'admin',gatewayKey:'inference'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const body={model:'chosen',messages:[{role:'user',content:'读取文件'}]};
    const bytes=Buffer.from(JSON.stringify(body));const split=bytes.indexOf(Buffer.from('读'))+1;
    const status=await new Promise((resolve,reject)=>{
      const req=request(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{authorization:'Bearer inference','content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
      req.on('error',reject);req.write(bytes.subarray(0,split));delay(25).then(()=>req.end(bytes.subarray(split)));
    });
    assert.equal(status,200);assert.deepEqual(received,body);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('inference key is separate from management key and chat response uses standard framing',async()=>{
  const service={models:[{slug:'chosen',selectable:true}],chat:async(body,{onChunk})=>{assert.equal(body.model,'chosen');onChunk?.({object:'chat.completion.chunk',choices:[{index:0,delta:{content:'OK'},finish_reason:null}]});return {object:'chat.completion',choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]};}};
  const server=createApp({service,controlKey:'admin',gatewayKey:'inference'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const send=(key,stream=false)=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({model:'chosen',messages:[{role:'user',content:'hello'}],stream})});
  try{
    assert.equal((await send('admin')).status,401);
    const a=await send('inference');assert.equal(a.status,200);assert.equal((await a.json()).object,'chat.completion');
    const b=await send('inference',true);assert.match(b.headers.get('content-type'),/event-stream/);assert.match(await b.text(),/data: \[DONE\]/);
    assert.equal((await fetch(base+'/api/status',{headers:{authorization:'Bearer inference'}})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
