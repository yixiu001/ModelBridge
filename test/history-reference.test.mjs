import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChatAdapter} from '../src/adapter.mjs';

test('WorkBuddy persisted-output reference keeps current client input while verifying the original result binding',async()=>{
  const catalog=[{slug:'chosen',selectable:true,declared:{}}],states=new Map();
  const tools=[{type:'function',function:{name:'Read',parameters:{type:'object'}}}];
  const messages=[{role:'user',content:'Read then continue'}];let round=0,sent,references=0;
  const request=async body=>{sent=body;return {output:[{type:'function_call',id:'item-'+round,call_id:'call-'+round++,namespace:'workbuddy',name:'Read',arguments:'{}'}]};};
  const adapter=new ChatAdapter({catalog,scope:'account',states,request,historyProfile:'workbuddy',onHistoryReference:()=>references++});
  const first=(await adapter.complete({model:'chosen',messages,tools})).choices[0].message;
  const content='中文 test data\n'.repeat(5000),id=first.tool_calls[0].id;
  messages.push(first,{role:'tool',tool_call_id:id,content});
  const second=(await adapter.complete({model:'chosen',messages,tools})).choices[0].message;
  messages.push(second,{role:'tool',tool_call_id:second.tool_calls[0].id,content:'small result'},{role:'user',content:'Continue next turn'});
  const preview=Buffer.from(content).subarray(0,2048).toString('utf8');
  const reference='<persisted-output>\nOutput too large ('+(Buffer.byteLength(content)/1024).toFixed(1)+'KB). Full output saved to: C:\\Users\\Tester\\.workbuddy\\projects\\test-workspace\\12345678-1234-1234-1234-123456789abc\\tool-results\\'+id+'.txt\n\nPreview (first 2048 bytes):\n'+preview+'\n...\n</persisted-output>';
  messages[2].content=reference;
  await adapter.complete({model:'chosen',messages,tools});
  assert.equal(references,1);assert.equal(sent.input.find(i=>i.type==='function_call_output').output,reference);
  // Binding survives the on-disk JSON representation.
  const reloaded=new ChatAdapter({catalog,scope:'account',states:new Map(JSON.parse(JSON.stringify([...states]))),request,historyProfile:'workbuddy'});
  await reloaded.complete({model:'chosen',messages,tools});
  const strict=new ChatAdapter({catalog,scope:'account',states,request});
  await assert.rejects(()=>strict.complete({model:'chosen',messages,tools}),/history_mismatch/);
  for(const replacement of [reference.replace('中文','改动'),reference.replace(id+'.txt','wrong.txt'),reference.replace('KB)','MB)'),reference.replace('C:\\Users\\Tester\\.workbuddy','D:\\outside'),reference+' extra']){
    const altered=structuredClone(messages);altered[2].content=replacement;
    await assert.rejects(()=>reloaded.complete({model:'chosen',messages:altered,tools}),/history_mismatch/);
  }
  const changed=structuredClone(messages);changed[0].content='different user intent';
  await assert.rejects(()=>reloaded.complete({model:'chosen',messages:changed,tools}),/history_mismatch/);
});
