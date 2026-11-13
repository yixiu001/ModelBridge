import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

test('stdio MCP fixture negotiates, discovers tools, preserves structured receipts and reports tool errors',async()=>{
  const child=spawn(process.execPath,['scripts/mcp-fixture.mjs'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let sequence=0;const pending=new Map();let stderr='';child.stderr.on('data',b=>stderr+=b);
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP response timeout: '+stderr));},3000);
    pending.set(id,message=>{clearTimeout(timer);resolve(message);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  try{
    const init=await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'modelbridge-test',version:'1'}});
    assert.equal(init.result.protocolVersion,'2025-11-25');assert.ok(init.result.capabilities.tools);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed=await request('tools/list');assert.deepEqual(listed.result.tools.map(t=>t.name),['challenge','advance','expected_error']);
    const start=(await request('tools/call',{name:'challenge',arguments:{}})).result;
    assert.equal(start.isError,false);assert.deepEqual(JSON.parse(start.content[0].text),start.structuredContent);
    const receipt=start.structuredContent;
    const next=(await request('tools/call',{name:'advance',arguments:{receipt:receipt.receipt,delta:5}})).result;
    assert.equal(next.structuredContent.value,receipt.value+5);assert.equal(next.structuredContent.step,1);
    assert.notEqual(next.structuredContent.receipt,receipt.receipt);assert.equal(next.structuredContent.label,'模型桥 MCP 验收');
    const stale=(await request('tools/call',{name:'advance',arguments:{receipt:receipt.receipt,delta:5}})).result;
    assert.equal(stale.isError,true);assert.equal(stale.structuredContent.code,'stale_receipt');
    const intentional=(await request('tools/call',{name:'expected_error',arguments:{}})).result;
    assert.equal(intentional.isError,true);assert.equal(intentional.structuredContent.code,'EXPECTED_TEST_ERROR');
    assert.equal((await request('tools/call',{name:'not_a_tool',arguments:{}})).error.code,-32602);
  }finally{child.stdin.end();child.kill();lines.close();}
});
