export function projectAccountState(account,evidence={},now=Date.now()){
 const partition=(grant,verified)=>{
  const failure=grant?.refreshError;
  const terminal=failure&&([401,403].includes(failure.httpStatus)||['invalid_grant','authorization_revoked','refresh_token_reused'].includes(failure.code));
  const state=!grant?.access_token?'missing':terminal?'sign_in_required':failure?'refresh_failed':grant.expiresAt<=now?'expired':'ready';
  return {state,expiresAt:grant?.expiresAt??null,lastRefreshAt:grant?.lastRefresh??null,lastVerifiedAt:verified??null,nextAction:state==='ready'?null:['missing','sign_in_required'].includes(state)?'sign_in':'refresh',renewalVerified:!!grant?.lastAutomaticRefresh};
 };
 return {accountKey:evidence.accountKey,credentialRevision:account.credentialRevision||1,inference:partition(account,evidence.inferenceVerifiedAt),quota:partition(account.quotaAuth,evidence.quotaVerifiedAt)};
}
