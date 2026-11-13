import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRequest } from '../src/request-contract.mjs';
const catalog=[{slug:'chosen',selectable:true,declared:{supported_reasoning_levels:[{effort:'low'},{effort:'high'}]}}];
test('malformed tool containers and schemas are client validation failures',()=>{
 for(const protocol of ['chat','responses'])for(const tools of [{},[null],[{type:'function',function:{name:'echo',parameters:'bad'},name:'echo',parameters:'bad'}]]){
  assert.throws(()=>prepareRequest({protocol,body:{model:'chosen',messages:[{role:'user',content:'hi'}],input:'hi',tools},catalog}),e=>e.details.source==='client'&&e.details.httpStatus===400);
 }
 assert.throws(()=>prepareRequest({protocol:'chat',body:{model:'chosen',messages:[null]},catalog}),e=>e.details.code==='invalid_message');
});
test('chat and Responses enforce the same reasoning capabilities without silently lowering',()=>{
 for(const protocol of ['chat','responses']){
  const base=protocol==='chat'?{messages:[{role:'user',content:'hi'}]}:{input:'hi'};
  const effort=v=>protocol==='chat'?{reasoning_effort:v}:{reasoning:{effort:v}};
  assert.throws(()=>prepareRequest({protocol,body:{model:'chosen',...base,...effort('none')},catalog,profile:'strict'}),e=>e.details.param===(protocol==='chat'?'reasoning_effort':'reasoning.effort'));
  assert.equal(prepareRequest({protocol,body:{model:'chosen',...base,...effort('high')},catalog}).body.model,'chosen');
 }
});
test('WorkBuddy accepts only authorized transformations and never applies them to Responses',()=>{
 const body={model:'chosen',stream:true,reasoning_effort:'none',messages:[{role:'system',content:'Return title JSON.'},{role:'user',content:'<session>\nhi\n</session>'}]};
 const r=prepareRequest({protocol:'chat',body,catalog,profile:'workbuddy-v1'});
 assert.equal(r.body.reasoning_effort,'low');assert.equal(r.adjustments.length,1);assert.equal(body.reasoning_effort,'none');
 assert.throws(()=>prepareRequest({protocol:'responses',body:{model:'chosen',input:'hi',reasoning:{effort:'none'}},catalog,profile:'workbuddy-v1'}));
 assert.throws(()=>prepareRequest({protocol:'chat',body,catalog:[{...catalog[0],declared:{supported_reasoning_levels:[{effort:'medium'}]}}],profile:'workbuddy-v1'}));
});
test('Responses rejects unsupported limits and history updates, keeps valid model-specific levels',()=>{
 for(const field of ['temperature','max_output_tokens','max_completion_tokens'])assert.throws(()=>prepareRequest({protocol:'responses',body:{model:'chosen',input:'hi',[field]:1},catalog}),e=>e.details.param===field);
 assert.throws(()=>prepareRequest({protocol:'responses',body:{model:'chosen',input:[{type:'configuration_update',reasoning:{effort:'none'}}]},catalog}),/configuration_update/);
 const c=[{...catalog[0],declared:{supported_reasoning_levels:[{effort:'medium'}]}}];
 assert.equal(prepareRequest({protocol:'responses',body:{model:'chosen',input:'hi',reasoning:{effort:'medium'}},catalog:c}).body.reasoning.effort,'medium');
});
