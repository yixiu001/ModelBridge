import {randomUUID} from 'node:crypto';
export class QuotaJobs {
 constructor({getAccount,query,persist}){Object.assign(this,{getAccount,query,persist});this.jobs=[];this.settled=Promise.resolve();}
 hydrate(jobs){this.jobs=jobs.slice(-20).map(j=>['queued','running'].includes(j.state)?{...j,state:'interrupted',items:j.items.map(i=>['queued','running'].includes(i.state)?{...i,state:'cancelled',message:'服务重启，查询已中断'}:i)}:j);}
 read(id){const j=id?this.jobs.find(j=>j.id===id):this.jobs.at(-1);return j?structuredClone(j):null;}
 async start({accountKeys}){
  if(!Array.isArray(accountKeys)||!accountKeys.length||accountKeys.length>50||new Set(accountKeys).size!==accountKeys.length||accountKeys.some(k=>typeof k!=='string'||!this.getAccount(k)))throw new Error('配额查询账号无效');
  if(this.controller){const active=this.jobs.at(-1);if(JSON.stringify(active.items.map(i=>i.key))===JSON.stringify(accountKeys))return {jobId:active.id};throw Object.assign(new Error('已有配额查询进行中'),{details:{httpStatus:409,code:'busy'}});}
  const controller=this.controller=new AbortController();
  const job={id:randomUUID(),state:'queued',createdAt:new Date().toISOString(),items:accountKeys.map(key=>({key,credentialRevision:this.getAccount(key).credentialRevision||1,quotaRevision:this.getAccount(key).quotaAuth?.credentialRevision||1,state:'queued'}))};
  this.jobs.push(job);this.jobs=this.jobs.slice(-20);
  try{await this.persist(this.jobs);}catch(e){this.controller=null;this.jobs.pop();throw e;}
  this.settled=this.run(job,controller).catch(()=>{job.state='failed';}).finally(()=>{this.controller=null;});
  return {jobId:job.id};
 }
 async run(job,controller){
  job.state='running';
  for(const item of job.items){
   if(controller.signal.aborted){item.state='cancelled';continue;}
   const canCommit=()=>!controller.signal.aborted&&(this.getAccount(item.key)?.credentialRevision||1)===item.credentialRevision&&!!this.getAccount(item.key)&&(this.getAccount(item.key)?.quotaAuth?.credentialRevision||1)===item.quotaRevision;
   item.state='running';await this.persist(this.jobs);
   try{const r=await this.query(item.key,{signal:controller.signal,canCommit});item.state=!canCommit()?'cancelled':r.status==='available'?'succeeded':'failed';item.message=item.state==='failed'?(r.message||'查询失败'):undefined;}
   catch{item.state=canCommit()?'failed':'cancelled';item.message=item.state==='failed'?'查询失败，请查看账号授权与配额状态':undefined;}
   await this.persist(this.jobs);
  }
  job.state=controller.signal.aborted?'cancelled':job.items.some(i=>i.state==='failed')?'partial':'completed';job.finishedAt=new Date().toISOString();await this.persist(this.jobs);
 }
 cancel(id){if(this.jobs.at(-1)?.id!==id||!this.controller)return {cancelled:false};this.controller.abort();for(const i of this.jobs.at(-1).items)if(i.state==='queued')i.state='cancelled';return {cancelled:true};}
}
