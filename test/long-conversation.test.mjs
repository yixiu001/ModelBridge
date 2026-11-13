import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChatAdapter} from '../src/adapter.mjs';

test('80 tool turns retain every result and opaque reasoning across serialized state reloads',async()=>{
  const catalog=[{slug:'chosen',selectable:true,declared:{}}];
  const tools=[{type:'function',function:{name:'mcp__qa__advance',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}}];
  const messages=[{role:'system',content:'Initial policy'},{role:'user',content:'开头锚点 START\n'+('inert context 中文\n'.repeat(4000))+'END'}];
  let states=new Map(),calls=0;const seenIds=new Set();
  for(let turn=0;turn<80;turn++){
    // JSON serialization models the persisted state shape, not a shared in-memory entry.
    if(turn===40)states=new Map(JSON.parse(JSON.stringify([...states])));
    messages[0]={role:'system',content:'Current policy '+turn};
    const adapter=new ChatAdapter({catalog,scope:'account',states,request:async body=>{
      const results=body.input.filter(i=>i.type==='function_call_output');
      assert.equal(results.length,turn);assert.equal(body.input.filter(i=>i.type==='reasoning').length,turn);
      assert.ok(body.input[1].content[0].text.startsWith('开头锚点 START'));
      for(let previous=0;previous<turn;previous++)assert.deepEqual(results[previous],{type:'function_call_output',call_id:'original-'+previous,output:JSON.stringify({step:previous,label:'真实工具结果'})});
      calls++;
      return {output:[{type:'reasoning',encrypted_content:'opaque-'+turn,summary:[]},{type:'function_call',id:'item-'+turn,call_id:'original-'+turn,namespace:'workbuddy',name:'mcp__qa__advance',arguments:JSON.stringify({step:turn})}]};
    }});
    const assistant=(await adapter.complete({model:'chosen',messages,tools})).choices[0].message;
    const id=assistant.tool_calls[0].id;assert.ok(!seenIds.has(id));seenIds.add(id);
    messages.push(assistant,{role:'tool',tool_call_id:id,content:JSON.stringify({step:turn,label:'真实工具结果'})},{role:'user',content:'Continue '+turn});
  }
  assert.equal(calls,80);assert.equal(seenIds.size,80);
  const adapter=new ChatAdapter({catalog,scope:'account',states,request:async body=>{
    assert.equal(body.input.filter(i=>i.type==='function_call_output').length,80);
    return {output:[{type:'message',content:[{type:'output_text',text:'ALL_80_CONFIRMED'}]}]};
  }});
  assert.equal((await adapter.complete({model:'chosen',messages,tools})).choices[0].message.content,'ALL_80_CONFIRMED');
  const changed=structuredClone(messages);changed[3].content='tampered old tool result';
  await assert.rejects(()=>adapter.complete({model:'chosen',messages:changed,tools}),/history_mismatch/);
  const compacted=[messages[0],{role:'user',content:'Summary replacing old history'},...messages.slice(-3)];
  await assert.rejects(()=>adapter.complete({model:'chosen',messages:compacted,tools}),/history_mismatch/);
});
