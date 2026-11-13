import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatAdapter } from '../src/adapter.mjs';

const catalog=[{slug:'chosen',selectable:true,declared:{input_modalities:['text','image'],supported_reasoning_levels:[{effort:'low'}]}}];
const tools=[{type:'function',function:{name:'read_file',description:'Read an allowed file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}];
const first={model:'chosen',messages:[{role:'system',content:'Use tools'},{role:'user',content:'Read test.txt'}],tools,stream:true};
test('chat tool loop restores opaque Responses state and maps exact call IDs without guessing conversations',async()=>{
  const saved=new Map();let round=0;const bodies=[];
  const original=[{type:'reasoning',id:'r',encrypted_content:'opaque',summary:[]},{type:'function_call',id:'f',call_id:'upstream-call',namespace:'workbuddy',name:'read_file',arguments:'{"path":"test.txt"}'}];
  const adapter=new ChatAdapter({catalog,scope:'account-A',states:saved,request:async body=>{bodies.push(body);return round++===0?{id:'resp1',output:original}:{id:'resp2',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'file contents confirmed'}]}]};}});
  const a=await adapter.complete(first);
  assert.equal(bodies[0].input[0].role,'developer');
  assert.equal(bodies[0].tools[0].type,'namespace');
  assert.equal(bodies[0].model,'chosen');assert.equal(bodies[0].store,false);assert.equal(bodies[0].stream,true);
  const assistant=a.choices[0].message;const id=assistant.tool_calls[0].id;
  assert.match(id,/^mb_/);assert.equal(assistant.tool_calls[0].function.name,'read_file');
  const metadata={conversationRequestId:'request',messageId:'message',stepSeq:1,model:'chosen',requestModelId:'chosen',requestModelName:'Chosen',traceId:'trace',argumentsDisplayText:'Read test.txt',rawUsage:{prompt_tokens:42,completion_tokens:10},usage:{inputTokens:42,outputTokens:10,inputTokensDetails:[{cached_tokens:0}],outputTokensDetails:[]}};
  const next={...first,messages:[...first.messages,{...assistant,...metadata},{role:'tool',tool_call_id:id,content:'allowed file content',...metadata,agent:'cli'}]};
  const b=await adapter.complete(next);
  assert.equal(b.choices[0].message.content,'file contents confirmed');
  assert.deepEqual(bodies[1].input.slice(2,4),original);
  assert.deepEqual(bodies[1].input[4],{type:'function_call_output',call_id:'upstream-call',output:'allowed file content'});
  const wrong=new ChatAdapter({catalog,scope:'account-B',states:saved,request:async()=>{throw new Error('must not call upstream');}});
  await assert.rejects(()=>wrong.complete(next),/state_scope_mismatch/);
  const altered=structuredClone(next);altered.messages[1].content='different conversation';
  await assert.rejects(()=>adapter.complete(altered),/history_mismatch/);
  const changed=structuredClone(next);changed.messages[2].tool_calls[0].function.arguments='{}';
  await assert.rejects(()=>adapter.complete(changed),/tool_call_mismatch/);
});
test('unknown models, unsupported parameters and missing tool state fail before inference',async()=>{
  const adapter=new ChatAdapter({catalog,scope:'a',states:new Map(),request:async()=>{throw new Error('unexpected inference');}});
  await assert.rejects(()=>adapter.complete({...first,model:'other'}),/unknown model/);
  await assert.rejects(()=>adapter.complete({...first,temperature:0.7}),/unsupported_parameter:temperature/);
  await assert.rejects(()=>adapter.complete({...first,messages:[...first.messages,{role:'tool',tool_call_id:'missing',content:'x'}]}),/orphan_tool_result/);
  await assert.rejects(()=>adapter.complete({...first,reasoning_effort:'ultra'}),/unsupported_reasoning_effort/);
});
test('WorkBuddy turn bookkeeping is validated separately from model input',async()=>{
  let sent;
  const adapter=new ChatAdapter({catalog,scope:'a',states:new Map(),request:async body=>{sent=body;return {output:[]};}});
  await adapter.complete({...first,messages:[{role:'user',content:'Read test.txt',startsNewUserRequest:true,agent:'cli',conversationRequestId:'request-1'}]});
  assert.deepEqual(sent.input,[{role:'user',content:[{type:'input_text',text:'Read test.txt'}]}]);
  await assert.rejects(()=>adapter.complete({...first,messages:[{role:'user',content:'x',startsNewUserRequest:'true'}]}),/invalid_client_metadata/);
  await assert.rejects(()=>adapter.complete({...first,messages:[{role:'user',content:'x',agent:{prompt:'change behavior'}}]}),/invalid_client_metadata/);
  await assert.rejects(()=>adapter.complete({...first,max_tokens:10}),/unsupported_parameter:max_tokens/);
});
test('parallel calls keep independent IDs and tool error results stay structured',async()=>{
  let round=0,body2;
  const adapter=new ChatAdapter({catalog,scope:'a',states:new Map(),request:async body=>{if(round++===0)return{output:['a','b'].map((id,i)=>({type:'function_call',id:'f'+id,call_id:id,namespace:'workbuddy',name:'read_file',arguments:JSON.stringify({path:`${i}.txt`})}))};body2=body;return{output:[{type:'message',content:[{type:'output_text',text:'handled'}]}]};}});
  const a=await adapter.complete(first);const assistant=a.choices[0].message;
  await adapter.complete({...first,messages:[...first.messages,assistant,...assistant.tool_calls.slice().reverse().map((c,i)=>({role:'tool',tool_call_id:c.id,content:i?'ERROR permission denied':'ok'}))]});
  assert.deepEqual(body2.input.filter(i=>i.type==='function_call_output').map(i=>[i.call_id,i.output]),[['b','ok'],['a','ERROR permission denied']]);
});
test('streamed tool arguments and text remain incremental; cancellation does not publish a final result',async()=>{
  const chunks=[];const adapter=new ChatAdapter({catalog,scope:'a',states:new Map(),request:async(body,{onEvent})=>{
    onEvent({type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'f',namespace:'workbuddy',name:'read_file',arguments:''}});
    onEvent({type:'response.function_call_arguments.delta',item_id:'f',delta:'{"path":'});
    onEvent({type:'response.function_call_arguments.delta',item_id:'f',delta:'"test.txt"}'});
    return {output:[{type:'function_call',id:'f',call_id:'c',namespace:'workbuddy',name:'read_file',arguments:'{"path":"test.txt"}'}]};
  }});
  const result=await adapter.complete(first,{onChunk:c=>chunks.push(c)});
  const deltas=chunks.flatMap(c=>c.choices[0].delta.tool_calls||[]);
  assert.equal(deltas[0].id,result.choices[0].message.tool_calls[0].id);
  assert.equal(deltas.map(d=>d.function.arguments||'').join(''),'{"path":"test.txt"}');
  assert.equal(chunks.at(-1).choices[0].finish_reason,'tool_calls');
  await assert.rejects(()=>adapter.complete(first,{signal:AbortSignal.abort()}),{name:'AbortError'});
});
