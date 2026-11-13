import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareCompatibility } from '../src/compatibility.mjs';
const catalog=[{slug:'chosen',selectable:true,declared:{supported_reasoning_levels:[{effort:'low'}]}}];
const probe={model:'chosen',stream:true,max_tokens:1,messages:[{role:'user',content:'Reply with OK.'}]};
const title={model:'chosen',stream:true,reasoning_effort:'none',messages:[{role:'system',content:'Return JSON containing title.'},{role:'user',content:'<session>\nRead a test file\n</session>'}]};
test('strict route never rewrites unsupported client semantics',()=>{
  for(const body of [probe,title]){const result=prepareCompatibility(body,catalog,'strict');assert.deepEqual(result.body,body);assert.deepEqual(result.adjustments,[]);}
});
test('explicit WorkBuddy profile recognizes only the exact connection probe and records the unbounded upstream limit',()=>{
  const result=prepareCompatibility(probe,catalog,'workbuddy');
  assert.equal(result.body.max_tokens,undefined);assert.equal(result.body.model,'chosen');
  assert.deepEqual(result.body.messages,probe.messages);assert.equal(probe.max_tokens,1);
  assert.equal(result.adjustments[0].code,'connection_probe_output_limit_not_forwarded');
  for(const changed of [{max_tokens:2},{messages:[{role:'user',content:'Write a long essay'}]},{tools:[]},{temperature:0.4},{stream:false}]){
    const body={...probe,...changed};assert.deepEqual(prepareCompatibility(body,catalog,'workbuddy').body,body);
  }
});
test('only the recognized title helper maps none to advertised low, without switching model or changing prompts',()=>{
  const result=prepareCompatibility(title,catalog,'workbuddy');
  assert.equal(result.body.reasoning_effort,'low');assert.equal(title.reasoning_effort,'none');
  assert.deepEqual(result.body.messages,title.messages);assert.equal(result.body.model,'chosen');
  assert.equal(result.adjustments[0].code,'title_reasoning_none_to_low');
  for(const changed of [{messages:[{role:'user',content:'Answer normally'}]},{tools:[{type:'function'}]},{reasoning_effort:'high'}]){
    const body={...title,...changed};assert.deepEqual(prepareCompatibility(body,catalog,'workbuddy').body,body);
  }
  assert.throws(()=>prepareCompatibility({...title,model:'missing'},catalog,'workbuddy'),/unknown model/);
  assert.throws(()=>prepareCompatibility(title,[{slug:'chosen',selectable:true,declared:{}}],'workbuddy'),/low_reasoning_unavailable/);
});
