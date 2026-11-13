import {requireModel} from './protocol.mjs';
import {prepareCompatibility} from './compatibility.mjs';
const reject=(code,param)=>{throw Object.assign(new Error(`${code}${param?':'+param:''}`),{details:{code,param,httpStatus:400,source:'client'}});};
// Inspired by CPA's native Responses effort regression cases (MIT), fixed
// 1aaf56bc6a0fc6fce19049ba7ae8554c882304a6. Our strict policy never auto-lowers.
export function prepareRequest({protocol,body,catalog,profile='strict'}){
 if(!body||typeof body!=='object'||Array.isArray(body))reject('invalid_request');
 const model=requireModel(catalog,body.model);
 if(!['strict','workbuddy','workbuddy-v1'].includes(profile))reject('unknown_compatibility_profile');
 if(protocol==='chat'&&!Array.isArray(body.messages))reject('invalid_chat_request','messages');
 const prepared=protocol==='chat'?prepareCompatibility(body,catalog,profile==='workbuddy-v1'?'workbuddy':profile):{body,adjustments:[]};
 body=prepared.body;
 const effort=protocol==='chat'?body.reasoning_effort:body.reasoning?.effort;
 if(effort!==undefined&&!model.declared?.supported_reasoning_levels?.some(r=>r.effort===effort))reject('unsupported_reasoning_effort',protocol==='chat'?'reasoning_effort':'reasoning.effort');
 for(const key of ['temperature','top_p','max_tokens','max_output_tokens','max_completion_tokens'])if(body[key]!==undefined&&body[key]!==null)reject('unsupported_parameter',key);
 if(protocol==='responses'){
  if(body.store===true||body.previous_response_id)reject('unsupported_response_state','previous_response_id');
  if(typeof body.input!=='string'&&!Array.isArray(body.input))reject('invalid_response_input','input');
  if(body.stream!==undefined&&typeof body.stream!=='boolean')reject('invalid_stream','stream');
  if(Array.isArray(body.input))for(const item of body.input){
   if(!item||typeof item!=='object')reject('invalid_response_input','input');
   if(item.type==='configuration_update')reject('unsupported_configuration_update','input.configuration_update');
  }
 }
 return {...prepared,model};
}
