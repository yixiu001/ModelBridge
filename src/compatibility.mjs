import { requireModel } from './protocol.mjs';

// Explicit, opt-in endpoint policy. This is not semantic equivalence: callers
// accept the documented deviations; strict /v1 requests are never rewritten.
export function prepareCompatibility(body,catalog,profile='strict') {
  if(profile==='strict')return {body,adjustments:[]};
  if(profile!=='workbuddy')throw new Error('unknown_compatibility_profile');
  const model=requireModel(catalog,body.model);
  const probeKeys=['model','stream','max_tokens','messages'];
  const isProbe=Object.keys(body).every(k=>probeKeys.includes(k))&&body.stream===true&&body.max_tokens===1&&body.messages.length===1&&body.messages[0].role==='user'&&body.messages[0].content==='Reply with OK.'&&Object.keys(body.messages[0]).every(k=>['role','content'].includes(k));
  if(isProbe) {
    const next={...body};delete next.max_tokens;
    return {body:next,adjustments:[{code:'connection_probe_output_limit_not_forwarded',requested:1,effective:'upstream_default',note:'Real upstream inference; the requested one-token generation cap is not enforced.'}]};
  }
  const [system,user]=body.messages;
  const isTitle=body.reasoning_effort==='none'&&body.stream===true&&body.messages.length===2&&system?.role==='system'&&typeof system.content==='string'&&/title/i.test(system.content)&&user?.role==='user'&&typeof user.content==='string'&&user.content.startsWith('<session>\n')&&user.content.endsWith('\n</session>')&&(!body.tools||body.tools.length===0);
  if(isTitle) {
    if(!model.declared?.supported_reasoning_levels?.some(r=>r.effort==='low'))throw new Error('low_reasoning_unavailable');
    return {body:{...body,reasoning_effort:'low'},adjustments:[{code:'title_reasoning_none_to_low',requested:'none',effective:'low',note:'Reasoning is enabled at low effort; latency and usage may exceed a no-reasoning request.'}]};
  }
  return {body,adjustments:[]};
}
