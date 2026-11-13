import {mkdir,readdir,readFile,appendFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const safe=v=>typeof v==='string'&&/^[-a-zA-Z0-9_.:/\[\]]{1,180}$/.test(v)?v:null;
const number=v=>Number.isFinite(v)&&v>=0?v:null;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export function sanitizeActivity(r){
 if(!safe(r.id)||!instant(r.finishedAt))return null;
 const failure=r.failure||r.error;
 return {id:r.id,kind:r.kind==='system'?'system':'request',event:safe(r.event),accountKey:safe(r.accountKey||r.account),account:safe(r.accountKey||r.account),credentialRevision:Number.isSafeInteger(r.credentialRevision)?r.credentialRevision:null,requestedModel:safe(r.requestedModel||r.model),effectiveModel:safe(r.effectiveModel||r.model),model:safe(r.requestedModel||r.model),profile:safe(r.profile)||'strict',path:safe(r.path),startedAt:instant(r.startedAt),finishedAt:instant(r.finishedAt),httpStatus:Number.isInteger(r.httpStatus)?r.httpStatus:null,status:['forwarded','failed','cancelled'].includes(r.status)?r.status:'failed',requestBytes:number(r.requestBytes),usage:{inputTokens:number(r.usage?.inputTokens),outputTokens:number(r.usage?.outputTokens),totalTokens:number(r.usage?.totalTokens)},failure:failure?{category:safe(failure.category),source:safe(failure.source),code:safe(failure.code),param:safe(failure.param),httpStatus:Number.isInteger(failure.httpStatus)?failure.httpStatus:null}:null,adjustments:(r.adjustments||[]).map(a=>({code:safe(a.code),requested:typeof a.requested==='number'?a.requested:safe(a.requested),effective:typeof a.effective==='number'?a.effective:safe(a.effective)})).slice(0,10)};
}
export class ActivityStore {
 constructor(dataDir,getSettings){this.dataDir=dataDir;this.dir=join(dataDir,'activity');this.getSettings=getSettings;this.items=[];this.ids=new Set();this.persisted=new Set();this.queue=Promise.resolve();this.invalidRows=0;this.truncated=false;}
 async init(){
  await mkdir(this.dir,{recursive:true});
  for(const file of (await readdir(this.dir)).filter(n=>/^activity-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()){
   for(const line of (await readFile(join(this.dir,file),'utf8')).split('\n').filter(Boolean)){
    try{const r=sanitizeActivity(JSON.parse(line));if(!r)throw new Error();if(!this.ids.has(r.id)){this.items.push(r);this.ids.add(r.id);this.persisted.add(r.id);}}catch{this.invalidRows++;}
   }
  }
  this.items.sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt));
  if(this.trim())await this.compact();
 }
 trim(){
  const p=this.getSettings(),earliest=Date.now()-(p.logRetentionDays||7)*86400000,max=p.logMaxRecords||50000,maxBytes=(p.logMaxMiB||50)*1024*1024;
  const before=this.items.length;this.items=this.items.filter(r=>Date.parse(r.finishedAt)>=earliest);
  let bytes=0,kept=[];
  for(let i=this.items.length-1;i>=0;i--){const r=this.items[i],n=Buffer.byteLength(JSON.stringify(r))+1;if(kept.length>=max||bytes+n>maxBytes)break;kept.push(r);bytes+=n;}
  this.items=kept.reverse();this.ids=new Set(this.items.map(r=>r.id));
  if(before!==this.items.length){this.truncated=true;return true;}return false;
 }
 async compact(){
  const groups=new Map();for(const r of this.items)if(this.persisted.has(r.id)){const f=`activity-${r.finishedAt.slice(0,10)}.jsonl`;groups.set(f,(groups.get(f)||'')+JSON.stringify(r)+'\n');}
  for(const [name,value] of groups){const target=join(this.dir,name),temp=target+'.'+randomUUID()+'.tmp';try{await writeFile(temp,value,{mode:0o600});await rename(temp,target);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
  for(const name of await readdir(this.dir))if(/^activity-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&!groups.has(name))await unlink(join(this.dir,name));
  this.persisted=new Set([...this.persisted].filter(id=>this.ids.has(id)));
 }
 async append(record){
  const r=sanitizeActivity(record);if(!r)throw new Error('invalid activity record');
  const operation=this.queue.catch(()=>{}).then(async()=>{
   if(this.ids.has(r.id))return;
   if(this.getSettings().loggingToFile!==false){await appendFile(join(this.dir,`activity-${r.finishedAt.slice(0,10)}.jsonl`),JSON.stringify(r)+'\n',{mode:0o600});this.persisted.add(r.id);}
   this.items.push(r);this.ids.add(r.id);if(this.trim())await this.compact();
  });this.queue=operation;return operation;
 }
 expire(){if(this.trim()){this.queue=this.queue.catch(()=>{}).then(()=>this.compact());this.queue.catch(()=>{});}return this.queue;}
 filtered({from,to,filters={}}={}){this.expire();return this.items.filter(r=>r.kind===(filters.kind||'request')&&(!from||r.finishedAt>=from)&&(!to||r.finishedAt<=to)&&Object.entries(filters).every(([k,v])=>!v||v==='all'||(k==='category'?r.failure?.category:k==='source'?r.failure?.source:r[k])===v));}
 query({cursor,limit=100,...query}={}){
  const all=this.filtered(query).reverse(),index=cursor?all.findIndex(r=>r.id===cursor):-1;
  if(cursor&&index<0)return {items:[],nextCursor:null,cursorExpired:true};
  const items=all.slice(index+1,index+1+Math.min(200,Math.max(1,Number(limit)||100)));
  return {items,nextCursor:index+1+items.length<all.length?items.at(-1)?.id:null};
 }
 summary(query={}){
  const hourly=new Map();for(const r of this.filtered(query)){const hour=r.finishedAt.slice(0,13)+':00:00.000Z';const row=hourly.get(hour)||{hour,successes:0,failures:0,cancelled:0};row[r.status==='forwarded'?'successes':r.status==='cancelled'?'cancelled':'failures']++;hourly.set(hour,row);}
  const rows=this.filtered(query),knownUsage={inputTokens:0,outputTokens:0,totalTokens:0},categories={};let unknownUsageCount=0;
  for(const r of rows){if(r.usage.totalTokens===null)unknownUsageCount++;for(const k of Object.keys(knownUsage))if(r.usage[k]!==null)knownUsage[k]+=r.usage[k];if(r.failure?.category)categories[r.failure.category]=(categories[r.failure.category]||0)+1;}
  return {trend:[...hourly.values()].sort((a,b)=>a.hour.localeCompare(b.hour)),requests:rows.length,successes:rows.filter(r=>r.status==='forwarded').length,failures:rows.filter(r=>r.status==='failed').length,cancelled:rows.filter(r=>r.status==='cancelled').length,knownUsage,unknownUsageCount,categories,from:query.from||null,to:query.to||null,coverageStart:this.items[0]?.finishedAt||null,coverageEnd:this.items.at(-1)?.finishedAt||null,truncated:this.truncated,invalidRows:this.invalidRows};
 }
 export(query={}){return {format:'modelbridge-diagnostics-v1',createdAt:new Date().toISOString(),summary:this.summary(query),records:this.filtered(query)};}
}
