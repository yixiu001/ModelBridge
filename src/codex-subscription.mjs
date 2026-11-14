import {parseCodexSubscription} from './vendor/codex-quota.mjs';

// Request contract and 8s optional timeout selectively follow Management Center
// 3d893ec88938c3ceef200a15be6af8cf972564b3 data.ts/constants.ts (MIT).
// Uses only ModelBridge's own grant; no proxy management API or token fallback.
export async function readCodexSubscription(fetcher, grant, {signal, timeoutMs=8000}={}) {
  const snapshot=(status,fields={})=>({status,activeUntil:null,checkedAt:new Date().toISOString(),...fields});
  if (!grant.accountId) return snapshot('unavailable',{reason:'missing_account_id'});
  const timeout=AbortSignal.timeout(timeoutMs);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  try {
    const url=new URL('https://chatgpt.com/backend-api/subscriptions');
    url.searchParams.set('account_id',grant.accountId);
    const response=await fetcher(url.href,{
      method:'GET',redirect:'error',signal:combined,
      headers:{Authorization:'Bearer '+grant.access_token,'Chatgpt-Account-Id':grant.accountId,Accept:'application/json'},
    });
    if (!response.ok) {
      await response.body?.cancel();
      return snapshot('error',{reason:'http_error',httpStatus:response.status});
    }
    const reader=response.body?.getReader();
    if (!reader) return snapshot('unavailable',{reason:'not_returned'});
    const chunks=[];let size=0;
    try {
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>65536){await reader.cancel();return snapshot('error',{reason:'invalid_response'});}chunks.push(value);}
    } finally { reader.releaseLock(); }
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const activeUntil=parseCodexSubscription(payload);
    return activeUntil?snapshot('available',{activeUntil}):snapshot('unavailable',{reason:'not_returned'});
  } catch {
    return snapshot('error',{reason:signal?.aborted?'cancelled':timeout.aborted?'timeout':'request_failed'});
  }
}
