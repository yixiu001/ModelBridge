// A deliberately small stdio MCP acceptance fixture, not a general MCP server.
// No network, filesystem tool, shell execution, or access to application secrets.
import {createInterface} from 'node:readline';
import {randomBytes} from 'node:crypto';
import {appendFile,mkdir} from 'node:fs/promises';

const audit=process.argv.includes('--audit');
const auditDir=new URL('../.local/',import.meta.url);
if(audit)await mkdir(auditDir,{recursive:true});
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const tools=[
  {name:'challenge',description:'Start a ModelBridge test chain. Returns a fresh unpredictable receipt and value. No business data.',inputSchema:schema()},
  {name:'advance',description:'Advance the test chain using the latest receipt returned by this server. Returns a fresh receipt, value and step. Stale receipts fail.',inputSchema:schema({receipt:{type:'string'},delta:{type:'integer',minimum:1,maximum:9}},['receipt','delta'])},
  {name:'expected_error',description:'Return an intentional EXPECTED_TEST_ERROR for error propagation verification; no side effects.',inputSchema:schema()},
].map(t=>({...t,annotations:{readOnlyHint:t.name==='expected_error',destructiveHint:false,openWorldHint:false}}));
let state=null,initialized=false;
const result=(data,isError=false)=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError});
const log=async entry=>{if(audit)await appendFile(new URL('mcp-audit.jsonl',auditDir),JSON.stringify({at:new Date().toISOString(),pid:process.pid,...entry})+'\n');};
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  let message;
  try{message=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');continue;}
  if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message?.id??null,error:{code:-32600,message:'Invalid request'}})+'\n');continue;
  }
  if(message.id===undefined){if(message.method==='notifications/initialized')initialized=true;continue;}
  const reply={jsonrpc:'2.0',id:message.id};
  const params=message.params||{};
  if(message.method==='initialize'){
    const versions=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
    reply.result={protocolVersion:versions.includes(params.protocolVersion)?params.protocolVersion:versions[0],capabilities:{tools:{}},serverInfo:{name:'modelbridge-qa',version:'1.0.0'}};
    await log({method:'initialize',protocolVersion:reply.result.protocolVersion});
  }else if(message.method==='ping')reply.result={};
  else if(!initialized)reply.error={code:-32000,message:'Initialize first'};
  else if(message.method==='tools/list')reply.result={tools};
  else if(message.method==='tools/call'){
    const args=params.arguments||{};
    if(!tools.some(t=>t.name===params.name))reply.error={code:-32602,message:'Unknown tool'};
    else if(!args||typeof args!=='object'||Array.isArray(args))reply.error={code:-32602,message:'Invalid arguments'};
    else if(params.name==='expected_error')reply.result=result({code:'EXPECTED_TEST_ERROR',message:'Intentional test error; no business action occurred.'},true);
    else if(params.name==='challenge'){
      if(Object.keys(args).length)reply.error={code:-32602,message:'No arguments allowed'};
      else{state={receipt:randomBytes(12).toString('hex'),value:100,step:0,label:'模型桥 MCP 验收'};reply.result=result(state);}
    }else if(Object.keys(args).some(k=>!['receipt','delta'].includes(k))||typeof args.receipt!=='string'||!Number.isInteger(args.delta)||args.delta<1||args.delta>9)reply.error={code:-32602,message:'Invalid advance arguments'};
    else if(!state||args.receipt!==state.receipt)reply.result=result({code:'stale_receipt'},true);
    else{state={...state,receipt:randomBytes(12).toString('hex'),value:state.value+args.delta,step:state.step+1};reply.result=result(state);}
    await log({method:'tools/call',name:params.name,...reply.result?{result:reply.result.structuredContent,isError:reply.result.isError}:{error:reply.error.code}});
  }else reply.error={code:-32601,message:'Method not found'};
  process.stdout.write(JSON.stringify(reply)+'\n');
}
