const $ = id => document.getElementById(id);
let working = false;
async function api(path, body) {
  const response = await fetch('/api/'+path, body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || '请求失败');
  return data;
}
function error(e) { $('error').textContent = e.message; }
async function action(fn) { try { working=true; await fn(); } catch(e) { error(e); } finally { working=false; await update(); } }
async function login(newAccount) { await action(async()=>{ const data=await api('login',{newAccount}); location.assign(data.url); }); }
$('login').onclick=()=>login(false);
$('new-account').onclick=()=>login(true);
$('refresh').onclick=()=>action(()=>api('models/refresh',{}));
$('cancel').onclick=()=>action(()=>api('cancel',{}));
$('accounts').onchange=()=>action(()=>api('account',{key:$('accounts').value}));
async function update() {
  try {
    const s=await api('status');
    $('account').textContent=s.account.connected ? `${s.account.label} · ${s.account.planEnabled?'已授权使用会员用量':'未授予会员用量权限'}` : s.loginPending?'等待你在 OpenAI 页面完成授权…':'尚未登录。请使用你的 ChatGPT 账号继续。';
    $('refresh').disabled=!s.account.planEnabled || !!s.busy || working;
    $('login').disabled=!!s.busy || working;
    $('new-account').disabled=!!s.busy || working;
    $('cancel').disabled=!s.busy;
    const selected=s.accounts.find(a=>a.active)?.key;
    if ([...$('accounts').options].map(o=>o.value).join(',')!==s.accounts.map(a=>a.key).join(',')) {
      $('accounts').replaceChildren(...s.accounts.map(a=>{const o=document.createElement('option');o.value=a.key;o.textContent=a.label;return o;}));
    }
    $('accounts').value=selected || ''; $('accounts').hidden=!s.accounts.length; $('accounts').disabled=!!s.busy;
    $('catalog-info').textContent=s.catalogAt?`目录共 ${s.models.length} 个条目，${s.models.filter(m=>m.selectable).length} 个可显示选择。刷新于 ${new Date(s.catalogAt).toLocaleString()}`:'登录后点击“刷新目录”。目录尚未验证。';
    $('busy').textContent=s.busy?`正在验证 ${s.busy.model} · ${s.busy.kind==='tools'?'工具闭环':'文本响应'}。最多等待两分钟。`:'当前没有运行中的测试。';
    $('limits').textContent=s.limits;
    if(s.lastError) $('error').textContent=JSON.stringify(s.lastError,null,2);
    else if(!working) $('error').textContent='';
    $('models').replaceChildren(...s.models.map(m=>{
      const tr=document.createElement('tr');
      const name=document.createElement('td');name.textContent=m.displayName;
      const slug=document.createElement('small');slug.textContent=m.slug;name.append(slug);
      const visibility=document.createElement('td');visibility.textContent=m.selectable?'可选择':`未开放选择 (${m.visibility})`;
      const state=document.createElement('td'); const reports=s.reports.filter(r=>r.model===m.slug);
      state.textContent=reports.length?reports.map(r=>`${r.kind==='tools'?'工具':'文本'}：${r.status==='passed'?'通过':'未通过'}`).join(' / '):'未验证';
      const actions=document.createElement('td');
      for(const [kind,label] of [['text','测试文本'],['tools','测试工具闭环']]){
        const b=document.createElement('button');b.className='secondary';b.textContent=label;b.disabled=!m.selectable||!!s.busy||working;
        b.onclick=()=>action(()=>api('verify',{model:m.slug,kind}));actions.append(b);
      }
      tr.append(name,visibility,state,actions);return tr;
    }));
    $('reports').replaceChildren(...s.reports.slice().reverse().map(r=>{
      const div=document.createElement('div');div.className='report';const title=document.createElement('strong');title.className=r.status==='passed'?'passed':'failed';title.textContent=`${r.model} · ${r.kind} · ${r.status==='passed'?'通过':'未通过'}`;
      const detail=document.createElement('pre');detail.textContent=JSON.stringify(r,null,2);div.append(title,detail);return div;
    }));
  } catch(e) { error(e); }
}
await update(); setInterval(update,3000);
