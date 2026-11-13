import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {loadVault,saveVault} from './vault.mjs';
import {secureEqual} from './auth.mjs';
import {mergeWorkBuddyModels} from './client-config.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const fail=(message,code='client_config_conflict')=>{throw Object.assign(new Error(message),{details:{code,httpStatus:409}});};
export class ClientAccess {
 constructor({dataDir,targetPath,base,getModels}){Object.assign(this,{dataDir,targetPath,base,getModels});this.path=join(dataDir,'gateway-key.dpapi');}
 async init(){this.data=await loadVault(this.path);if(typeof this.data.key!=='string'||!this.data.key)throw new Error('连接密钥文件无效');}
 status(){const r=this.data.rotation;return {rotation:r?{id:r.id,stage:r.stage,verified:!!r.verifiedAt,createdAt:r.createdAt}:null,lastBackup:this.data.lastBackup?{id:this.data.lastBackup.id}:null};}
 copyKey(){return this.data.rotation?.newKey||this.data.key;}
 accepts(key){return secureEqual(key,this.data.key)||secureEqual(key,this.data.rotation?.newKey);}
 async commit(next){await saveVault(this.path,next);this.data=next;}
 async mutate(fn){if(this.busy)fail('连接配置操作进行中','busy');this.busy=true;try{return await fn();}finally{this.busy=false;}}
 async prepare(){
  const original=await readFile(this.targetPath,'utf8');
  const next=mergeWorkBuddyModels(JSON.parse(original),this.getModels(),{url:this.base+'/workbuddy/v1/chat/completions',key:this.copyKey(),archiveUnavailable:true});
  return {original,content:JSON.stringify(next,null,2),next,revision:digest(original)};
 }
 async preview(){const p=await this.prepare(),before=JSON.parse(p.original);return {revision:p.revision,changes:{added:p.next.filter(m=>!before.some(x=>x.id===m.id)).map(m=>m.id),removed:before.filter(m=>!p.next.some(x=>x.id===m.id)).map(m=>m.id),updated:p.next.filter(m=>before.some(x=>x.id===m.id&&JSON.stringify(x)!==JSON.stringify(m))).map(m=>m.id)},warnings:['只更新本项目模型；原配置将在应用前加密备份。'],rotation:this.status().rotation};}
 async begin(){return this.mutate(async()=>{if(this.data.rotation)fail('已有密钥轮换，请完成或回滚');const r={id:randomUUID(),newKey:'mb_'+randomBytes(32).toString('base64url'),stage:'pending',createdAt:new Date().toISOString()};await this.commit({...this.data,rotation:r});return {rotationId:r.id};});}
 async writeClient(content,expected){if(digest(await readFile(this.targetPath,'utf8'))!==expected)fail('WorkBuddy 配置已变化，请重新预览');const temp=this.targetPath+'.'+randomUUID()+'.tmp';try{await writeFile(temp,content,{flag:'wx',mode:0o600});if(digest(await readFile(this.targetPath,'utf8'))!==expected)fail('WorkBuddy 配置已变化，请重新预览');await rename(temp,this.targetPath);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 async apply({rotationId,expectedClientRevision}){return this.mutate(async()=>{
  const r=this.data.rotation;if((r?.id||undefined)!==(rotationId||undefined))fail('密钥轮换状态已变化');
  if(r&&r.stage!=='pending')fail('新密钥配置已应用，请先完成或回滚');
  const p=await this.prepare();if(p.revision!==expectedClientRevision)fail('WorkBuddy 配置已变化，请重新预览');
  const id=randomUUID();await saveVault(join(this.dataDir,`client-backup-${id}.dpapi`),{path:this.targetPath,content:p.original});
  const backup={id,appliedRevision:digest(p.content),originalRevision:p.revision};
  await this.commit({...this.data,lastBackup:backup,...(r?{rotation:{...r,stage:'applying',backup}}:{})});
  await this.writeClient(p.content,p.revision);
  if(r)await this.commit({...this.data,rotation:{...this.data.rotation,stage:'applied'}});
  return {state:'applied',backupId:id,configured:p.next.filter(m=>m.url===this.base+'/workbuddy/v1/chat/completions').map(m=>m.id)};
 });}
 async noteSuccessfulKey(key){const r=this.data.rotation;if(!r||!secureEqual(key,r.newKey)||r.verifiedAt||!['applied','applying'].includes(r.stage)||this.busy)return;await this.mutate(()=>this.commit({...this.data,rotation:{...r,stage:'verified',verifiedAt:new Date().toISOString()}}));}
 async complete(rotationId){return this.mutate(async()=>{const r=this.data.rotation;if(!r||r.id!==rotationId||!r.verifiedAt)fail('请先使用新密钥完成连接验证');await this.commit({...this.data,key:r.newKey,rotation:null,lastBackup:null});return {state:'completed'};});}
 async restoreBackup(backup){
  if(!backup||!/^[a-f0-9-]{36}$/.test(backup.id))fail('没有可恢复的备份');
  const original=await loadVault(join(this.dataDir,`client-backup-${backup.id}.dpapi`));
  if(original.path!==this.targetPath||typeof original.content!=='string'||digest(original.content)!==backup.originalRevision)fail('备份校验失败');
  const current=digest(await readFile(this.targetPath,'utf8'));
  if(current===backup.originalRevision)return;
  if(current!==backup.appliedRevision)fail('应用后客户端配置发生变化，为保留其他修改已停止恢复');
  await this.writeClient(original.content,current);
 }
 async rollback(rotationId){return this.mutate(async()=>{const r=this.data.rotation;if(!r||r.id!==rotationId)fail('轮换不存在');if(r.backup)await this.restoreBackup(r.backup);await this.commit({...this.data,rotation:null,lastBackup:r.backup?null:this.data.lastBackup});return {state:'rolled_back'};});}
 async restore(){return this.mutate(async()=>{if(this.data.rotation)fail('请先完成或回滚密钥轮换');await this.restoreBackup(this.data.lastBackup);await this.commit({...this.data,lastBackup:null});return {state:'restored'};});}
}
