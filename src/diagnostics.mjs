const field=v=>typeof v==='string'&&/^[a-zA-Z0-9_.:/\[\]-]{1,180}$/.test(v)?v:undefined;
export function classifyFailure(error,{requestId,stage='validate'}={}){
 const d=error.details||{};
 let code=field(d.code)||'request_failed',httpStatus=d.httpStatus||400,source=d.source||(stage==='validate'?'client':'upstream'),category='validation';
 if(error.name==='AbortError'){code='cancelled';httpStatus=499;category='cancelled';source='client';}
 else if(error.name==='TimeoutError'){code='timeout';httpStatus=504;category='timeout';source='network';}
 else if(error instanceof TypeError && !d.source){code='network_error';httpStatus=502;category='network';source='network';}
 else if(httpStatus===401||httpStatus===403||/invalid_grant|sign_in|authorization/.test(code))category='authentication';
 else if(/usage_limit|quota/.test(code))category='quota';
 else if(/capacity|overloaded/.test(code))category='capacity';
 else if(httpStatus===429)category='rate_limit';
 else if(httpStatus>=500)category=source==='network'?'network':'internal';
 const descriptions={validation:['请求参数或历史不受支持','查看字段与模型能力，修正后重新发送'],authentication:['授权不可用','在账号详情检查对应授权并按提示恢复'],quota:['官方报告额度已用尽','查看配额及恢复时间'],rate_limit:['请求暂时受限','稍后手动重试；此错误不代表额度为零'],capacity:['模型暂时繁忙','稍后重试指定模型'],timeout:['请求超时','检查网络与超时设置；未自动重试'],cancelled:['请求已取消','需要时重新发起'],network:['无法完成网络连接','检查网络与代理；未自动重试'],internal:['服务或上游响应异常','按请求编号查看诊断；未自动重试']};
 const [message,nextAction]=descriptions[category];
 return {requestId,source,category,code,httpStatus,param:field(d.param),message,nextAction};
}
export function normalizedUsage(value){
 const n=v=>Number.isFinite(v)&&v>=0?v:null;
 return {inputTokens:n(value?.input_tokens??value?.prompt_tokens),outputTokens:n(value?.output_tokens??value?.completion_tokens),totalTokens:n(value?.total_tokens)};
}
