export function buildWorkBuddyModel(model,{url,key}) {
  const clientEfforts=['low','medium','high','xhigh','max'];
  const advertised=model.declared?.supported_reasoning_levels?.map(r=>r.effort)||[];
  const supportedEfforts=clientEfforts.filter(e=>advertised.includes(e));
  const onlyReasoning=supportedEfforts.length>0&&!advertised.includes('none');
  const config={id:model.slug,name:`ModelBridge · ${model.displayName}`,vendor:'custom',url,apiKey:key,supportsToolCall:true,supportsImages:false,supportsReasoning:supportedEfforts.length>0,useCustomProtocol:true};
  if(supportedEfforts.length) {
    const defaultEffort=model.declared.default_reasoning_level;
    if(!supportedEfforts.includes(defaultEffort))throw new Error('Catalog default reasoning effort is unavailable in WorkBuddy');
    config.onlyReasoning=onlyReasoning;
    config.reasoning={defaultEffort,supportedEfforts,canDisableThinking:!onlyReasoning};
    config.thinkingLevelMap={off:onlyReasoning?null:'none',...Object.fromEntries(supportedEfforts.map(e=>[e,e]))};
  }
  return config;
}
