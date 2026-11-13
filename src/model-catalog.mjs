import {createHash} from 'node:crypto';
import {DEFAULT_SETTINGS,validateSettings} from './settings-store.mjs';
export const catalogRevision=models=>createHash('sha256').update(JSON.stringify([...models].sort((a,b)=>a.slug.localeCompare(b.slug)))).digest('hex');
export function diffCatalog(before,after){const b=new Map(before.map(m=>[m.slug,m])),a=new Map(after.map(m=>[m.slug,m]));return {added:[...a.keys()].filter(k=>!b.has(k)),removed:[...b.keys()].filter(k=>!a.has(k)),changed:[...a.keys()].filter(k=>b.has(k)&&JSON.stringify(a.get(k))!==JSON.stringify(b.get(k)))};}
export function previewModelRules({catalog,rules}){
 const errors=validateSettings({...DEFAULT_SETTINGS,...rules});
 if(!errors.length)for(const a of rules.aliases){if(!catalog.some(m=>m.slug===a.name&&m.selectable)||catalog.some(m=>m.slug===a.alias))errors.push('别名目标不可选或与真实模型冲突');}
 if(errors.length)return {effectiveModels:[],changes:{added:[],removed:[],changed:[]},errors};
 const effectiveModels=catalog.map(m=>({...m,selectable:m.selectable&&!rules.excluded.includes(m.slug)&&!rules.aliases.some(a=>a.name===m.slug&&!a.fork)}));
 for(const a of rules.aliases){const m=catalog.find(m=>m.slug===a.name);effectiveModels.push({...m,slug:a.alias,displayName:a.alias+' → '+a.name,upstreamModel:a.name,selectable:!rules.excluded.includes(a.name)&&!rules.excluded.includes(a.alias)});}
 return {effectiveModels,changes:diffCatalog(catalog.filter(m=>m.selectable),effectiveModels.filter(m=>m.selectable)),errors};
}
export function verificationKey(value){const {accountKey,credentialRevision,catalogRevision,rulesRevision,adapterVersion,model,scenario}=value;return createHash('sha256').update(JSON.stringify({accountKey,credentialRevision,catalogRevision,rulesRevision,adapterVersion,model,scenario})).digest('hex');}
