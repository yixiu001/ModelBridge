import { readFile } from 'node:fs/promises';
import { loadVault } from '../src/vault.mjs';
const control=JSON.parse(await readFile(new URL('../.local/control.json',import.meta.url),'utf8'));
const {key}=await loadVault(new URL('../.local/gateway-key.dpapi',import.meta.url));
const model=process.argv[2];if(!model)throw new Error('Exact catalog model required');
const messages=[{role:'user',content:'Call echo with text MODELBRIDGE_GATEWAY_OK. After the result, reply with exactly MODELBRIDGE_GATEWAY_OK.'}];
const tools=[{type:'function',function:{name:'echo',description:'Echo text without side effects.',parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},strict:true}}];
let calls=0;
for(let round=1;round<=4;round++){
  const response=await fetch(control.base+'/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,tools,stream:false}),signal:AbortSignal.timeout(180000)});
  const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data.error));
  const message=data.choices[0].message;messages.push(message);
  if(!message.tool_calls?.length){if(calls<1||message.content.trim()!=='MODELBRIDGE_GATEWAY_OK')throw new Error('gateway loop incomplete');console.log(JSON.stringify({model,status:'passed',rounds:round,calls,scope:'Chat Completions HTTP adapter with local echo; not WorkBuddy'}));break;}
  for(const call of message.tool_calls){if(call.function.name!=='echo')throw new Error('Unexpected tool');const args=JSON.parse(call.function.arguments);if(typeof args.text!=='string')throw new Error('Invalid arguments');calls++;messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({text:args.text})});}
  if(round===4)throw new Error('round limit');
}
