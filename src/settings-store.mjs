import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const DEFAULT_SETTINGS = Object.freeze({timeoutSeconds:180,loggingToFile:true,excluded:[],aliases:[],logRetentionDays:7,logMaxMiB:50,logMaxRecords:50000,heartbeatSeconds:0});
const queues = new Map();
const digest = v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const error = (message,code='invalid_config',httpStatus=400)=>Object.assign(new Error(message),{details:{code,httpStatus}});
const object = v=>v && typeof v==='object' && !Array.isArray(v);
const name = v=>typeof v==='string' && /^[-a-zA-Z0-9_.]{1,64}$/.test(v);
export function validateSettings(v) {
 const errors=[];
 if (!object(v)) return ['配置必须是对象'];
 if (Object.keys(v).some(k=>!Object.hasOwn(DEFAULT_SETTINGS,k))) errors.push('包含不支持的配置字段');
 for (const [key,min,max] of [['timeoutSeconds',30,600],['logRetentionDays',1,90],['logMaxMiB',1,500],['logMaxRecords',100,500000],['heartbeatSeconds',0,60]])
  if(!Number.isInteger(v[key])||v[key]<min||v[key]>max) errors.push(`${key}不在允许范围`);
 if(v.heartbeatSeconds>0&&v.heartbeatSeconds<5) errors.push('心跳最小5秒');
 if(typeof v.loggingToFile!=='boolean') errors.push('摘要保存开关无效');
 if(!Array.isArray(v.excluded)||v.excluded.length>100||v.excluded.some(x=>!name(x))||new Set(v.excluded).size!==v.excluded.length) errors.push('禁用规则须为不重复的精确模型名称');
 if(!Array.isArray(v.aliases)||v.aliases.length>100) errors.push('别名规则无效');
 else {
  const targets=new Set(v.aliases.map(a=>a?.name)), seen=new Set();
  for(const a of v.aliases){
   if(!object(a)||!name(a.name)||!name(a.alias)||typeof a.fork!=='boolean'||Object.keys(a).some(k=>!['name','alias','fork'].includes(k))||seen.has(a.alias)||targets.has(a.alias)) errors.push('别名无效、重复或形成链式映射');
   seen.add(a?.alias);
  }
 }
 return errors;
}
export function settingsSnapshot(values) { const clean=structuredClone(values); return {schemaVersion:1,revision:digest(clean),values:clean}; }
export function previewSettings(current,values) {
 return {changes:Object.keys(DEFAULT_SETTINGS).filter(k=>JSON.stringify(current.values[k])!==JSON.stringify(values?.[k])).map(key=>({key,before:current.values[key],after:values?.[key]})),errors:validateSettings(values)};
}
async function read(path) {try{return JSON.parse(await fs.readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function loadSettings(dataDir) {
 const current=await read(join(dataDir,'settings.json'));
 if(current){if(current.schemaVersion!==1||validateSettings(current.values).length)throw error('已保存配置无效，请从备份恢复');return settingsSnapshot(current.values);}
 const legacy=await read(join(dataDir,'direct-preferences.json'))||{};
 const values={...structuredClone(DEFAULT_SETTINGS),...legacy};
 if(validateSettings(values).length)throw error('原配置无法安全迁移');
 return settingsSnapshot(values);
}
export async function saveSettings(dataDir,{revision,values}) {
 const dir=resolve(dataDir), previous=queues.get(dir)||Promise.resolve();
 const pending=previous.catch(()=>{}).then(async()=>{
  const current=await loadSettings(dir);
  if(revision!==current.revision)throw error('设置已变化，请保留草稿并重新比较','stale_config',409);
  const errors=validateSettings(values);if(errors.length)throw error(errors.join('；'));
  const legacy=await fs.readFile(join(dir,'direct-preferences.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(legacy)await fs.writeFile(join(dir,'direct-preferences.pre-upgrade.json'),legacy,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const result=settingsSnapshot(values), tmp=join(dir,`settings.${randomUUID()}.tmp`);
  try{await fs.writeFile(tmp,JSON.stringify(result,null,2),{mode:0o600});await fs.rename(tmp,join(dir,'settings.json'));}
  finally{await fs.unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return result;
 });
 queues.set(dir,pending);
 try{return await pending;}finally{if(queues.get(dir)===pending)queues.delete(dir);}
}
export function exportSettings(snapshot){return {schemaVersion:1,values:structuredClone(snapshot.values)};}
export function restoreSettings(dataDir,{revision,document}){
 if(!object(document)||document.schemaVersion!==1||Object.keys(document).some(k=>!['schemaVersion','values'].includes(k)))return Promise.reject(error('不是受支持的ModelBridge配置备份'));
 return saveSettings(dataDir,{revision,values:document.values});
}
