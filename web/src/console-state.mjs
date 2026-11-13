export const createDraft=s=>({revision:s.revision,baseValues:structuredClone(s.values),values:structuredClone(s.values),dirty:false,conflict:false});
export const editDraft=(d,values)=>({...d,sourceInvalid:false,sourceText:undefined,values:structuredClone(values),dirty:JSON.stringify(d.baseValues)!==JSON.stringify(values)});
export function receiveSnapshot(d,s,{discard=false}={}){return d?.dirty&&!discard?{...d,conflict:d.revision!==s.revision,remote:s}:createDraft(s);}
export class OperationEpoch{constructor(){this.value=0;}begin(target){return {value:++this.value,target};}current(ticket,target){return ticket.value===this.value&&ticket.target===target;}invalidate(){this.value++;}}
export const failedItems=items=>items.filter(i=>i.state==='failed').map(i=>i.key);
export const draftCache=new Map();
export const hasUnsavedDrafts=()=>[...draftCache.values()].some(d=>d?.dirty);
