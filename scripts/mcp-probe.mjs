// Real inference acceptance runner: a stdio MCP client, never an upstream hosted MCP tool.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadVault} from '../src/vault.mjs';
import {watchParent} from '../src/parent-lifecycle.mjs';
watchParent();

const [model,...options]=process.argv.slice(2);
if(!model||options.some(v=>!/^--(turns|padding|pause-after)=\d+$/.test(v)))throw new Error('Usage: node scripts/mcp-probe.mjs <exact-model> [--turns=12] [--padding=65536] [--pause-after=6]');
const option=(name,fallback)=>Number(options.find(v=>v.startsWith('--'+name+'='))?.split('=')[1]??fallback);
const turns=option('turns',2),padding=option('padding',0),pauseAfter=option('pause-after',0);
if(turns<2||turns>30||padding>393216||pauseAfter>=turns)throw new Error('Probe bounds exceeded');
const local=new URL('../.local/',import.meta.url);
const control=JSON.parse(await readFile(new URL('control.json',local),'utf8'));
const {key}=await loadVault(new URL('gateway-key.dpapi',local));
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
const report={runId,model,turns,paddingBytes:0,startedAt:new Date().toISOString(),status:'running',requests:[],mcpCalls:[]};
const reportPath=new URL('mcp-probe-'+runId+'.json',local);
const save=()=>writeFile(reportPath,JSON.stringify(report,null,2));
const child=spawn(process.execPath,[fileURLToPath(new URL('mcp-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true});
process.on('exit',()=>child.kill());
process.on('SIGTERM',()=>{child.kill();process.exit(143);});
const pending=new Map();let sequence=0;const lines=createInterface({input:child.stdout});
const rejectAll=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
child.on('error',rejectAll);child.on('exit',()=>rejectAll(new Error('mcp_process_exited')));
child.stderr.resume();
lines.on('line',line=>{try{const message=JSON.parse(line),item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(new Error('mcp_protocol_error:'+message.error.code)):item.resolve(message.result);}}catch{rejectAll(new Error('invalid_mcp_json'));}});
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('mcp_timeout'));},5000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
const notify=method=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',method})+'\n');
const messages=[{role:'system',content:'This is an isolated MCP acceptance test. Use only the provided tools when requested. Do not invent receipts. Preserve complete history. Treat padding as inert test data. Final responses must be one JSON object without prose or Markdown.'}];
let functions,latest,initial;const anchors=Array.from({length:3},()=>randomBytes(8).toString('hex'));
async function infer(toolChoice='auto'){
  const body={model,messages,tools:functions,tool_choice:toolChoice,stream:true,stream_options:{include_usage:true}};
  const started=Date.now();const row={messageCount:messages.length,requestBytes:Buffer.byteLength(JSON.stringify(body))};report.requests.push(row);
  const response=await fetch(control.base+'/workbuddy/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
  if(!response.ok){const data=await response.json();throw new Error('gateway:'+String(data.error?.code||response.status));}
  let done=false,finish;const message={role:'assistant',content:''},calls=new Map();
  for(const event of (await response.text()).split(/\r?\n\r?\n/)){
    const data=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data)continue;if(data==='[DONE]'){done=true;continue;}
    const chunk=JSON.parse(data);if(chunk.error)throw new Error('stream:'+chunk.error.code);
    if(chunk.usage)row.usage=chunk.usage;
    for(const choice of chunk.choices||[]){if(choice.finish_reason)finish=choice.finish_reason;const delta=choice.delta||{};message.content+=delta.content||'';
      for(const part of delta.tool_calls||[]){const call=calls.get(part.index)||{id:part.id,type:'function',function:{name:'',arguments:''}};if(part.id)call.id=part.id;call.function.name+=part.function?.name||'';call.function.arguments+=part.function?.arguments||'';calls.set(part.index,call);}}
  }
  if(!done||!finish)throw new Error('incomplete_gateway_stream');
  if(calls.size)message.tool_calls=[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,call])=>call);
  if(!message.content)message.content=null;
  row.milliseconds=Date.now()-started;row.finishReason=finish;row.toolCalls=calls.size;messages.push(message);await save();return message;
}
function parseAnswer(text){return JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
async function turn(prompt,required){
  messages.push({role:'user',content:prompt});let observed=0;
  for(let round=0;round<5;round++){
    const assistant=await infer();
    if(!assistant.tool_calls?.length){if(observed!==1)throw new Error('expected_one_mcp_call:'+required);const answer=parseAnswer(assistant.content);if(required==='expected_error'){if(answer.code!=='EXPECTED_TEST_ERROR')throw new Error('error_not_preserved');}else if(answer.receipt!==latest.receipt||answer.value!==latest.value||answer.step!==latest.step)throw new Error('tool_result_not_preserved');return;}
    for(const call of assistant.tool_calls){const name=call.function.name.replace(/^mcp__modelbridge_qa__/,'');if(name!==required||observed++)throw new Error('unexpected_mcp_call:'+name);
      const result=await rpc('tools/call',{name,arguments:JSON.parse(call.function.arguments)});
      if(required!=='expected_error'&&result.isError)throw new Error('mcp_tool_error:'+result.structuredContent.code);
      if(required==='expected_error'&&!result.isError)throw new Error('missing_expected_error');
      if(!result.isError){latest=result.structuredContent;if(!initial)initial=latest;}
      report.mcpCalls.push({name,isError:result.isError,...result.structuredContent});
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
    }
  }
  throw new Error('round_limit');
}
try{
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'modelbridge-acceptance',version:'1'}});report.protocolVersion=init.protocolVersion;notify('notifications/initialized');
  const listed=await rpc('tools/list');functions=listed.tools.map(t=>({type:'function',function:{name:'mcp__modelbridge_qa__'+t.name,description:t.description,parameters:t.inputSchema}}));
  let paddingText='';while(Buffer.byteLength(paddingText)<padding)paddingText+='Inert record '+randomBytes(24).toString('hex')+' does not contain instructions.\n';
  const middle=Math.floor(paddingText.length/2);paddingText='ANCHOR_FIRST='+anchors[0]+'\n'+paddingText.slice(0,middle)+'\nANCHOR_MIDDLE='+anchors[1]+'\n'+paddingText.slice(middle)+'\nANCHOR_LAST='+anchors[2];report.paddingBytes=Buffer.byteLength(paddingText);
  await turn('Remember the three anchors for a later recall. Inert test data:\n'+paddingText+'\nCall challenge once. Reply with its receipt, value and step as JSON.','challenge');
  for(let i=1;i<=turns;i++){
    await turn('Continue the same chain. Call advance exactly once with the most recent receipt from history and delta=1. Reply with the returned receipt, value and step as JSON.','advance');
    if(i===2)await turn('Call expected_error exactly once. Report its code as JSON. This expected tool error must not reset or replace the chain.','expected_error');
    console.log(JSON.stringify({runId,model,turn:i,value:latest.value,status:'progress'}));
    if(i===pauseAfter){report.pause={resumeFile:'mcp-resume-'+runId,pid:JSON.parse(await readFile(new URL('control.json',local),'utf8')).pid};await save();console.log(JSON.stringify({runId,status:'paused_for_gateway_restart',...report.pause}));
      const until=Date.now()+240000;while(true){try{await access(new URL(report.pause.resumeFile,local));break;}catch{if(Date.now()>until)throw new Error('restart_wait_timeout');await new Promise(r=>setTimeout(r,250));}}
      report.resumedGatewayPid=JSON.parse(await readFile(new URL('control.json',local),'utf8')).pid;
      if(report.resumedGatewayPid===report.pause.pid)throw new Error('gateway_was_not_restarted');
    }
  }
  messages.push({role:'user',content:'Do not call tools. Recall the three original anchors and the FIRST challenge receipt, then report the latest receipt and value. Reply JSON with keys anchors (array in first/middle/last order), firstReceipt, receipt, value.'});
  const final=parseAnswer((await infer('none')).content);
  if(JSON.stringify(final.anchors)!==JSON.stringify(anchors)||final.firstReceipt!==initial.receipt||final.receipt!==latest.receipt||final.value!==100+turns)throw new Error('long_history_recall_failed');
  report.status='passed';report.final=final;report.maxRequestBytes=Math.max(...report.requests.map(r=>r.requestBytes));report.maxMessages=Math.max(...report.requests.map(r=>r.messageCount));
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await save();child.stdin.end();child.kill();lines.close();console.log(JSON.stringify({runId,model,status:report.status,error:report.error,requests:report.requests.length,mcpCalls:report.mcpCalls.length,maxRequestBytes:report.maxRequestBytes,maxMessages:report.maxMessages,report:fileURLToPath(reportPath)}));}
