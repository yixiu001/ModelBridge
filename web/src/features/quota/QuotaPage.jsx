import React,{useState} from 'react';
import {Alert,Button,Card,Checkbox,Col,Empty,Input,Progress,Row,Select,Space,Table,Tag,Typography} from 'antd';
import {date} from '../../console-utils.mjs';
const {Text,Paragraph}=Typography;
const remaining=a=>a.quota?.freshness==='current'?Math.min(...(a.quota.windows||[]).filter(w=>w.usedPercent!==null).map(w=>100-w.usedPercent),Infinity):Infinity;
export function QuotaPage({state,api,action,blocked}){
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[sort,setSort]=useState('default'),[selected,setSelected]=useState([]),[loginUrl,setLoginUrl]=useState('');
 const job=state.quotaJob,running=['queued','running'].includes(job?.state),locked=blocked||state.loginPending||running;
 const rows=state.accounts.filter(a=>(a.label+' '+a.note).toLowerCase().includes(search.toLowerCase())&&(filter==='all'||filter==='low'&&remaining(a)<=20||filter==='unknown'&&!Number.isFinite(remaining(a))));
 if(sort!=='default')rows.sort((a,b)=>{const x=remaining(a),y=remaining(b);return !Number.isFinite(x)?!Number.isFinite(y)?0:1:!Number.isFinite(y)?-1:sort==='low'?x-y:y-x;});
 const start=keys=>action(()=>api('quota-jobs/start',{accountKeys:keys}));
 const authorize=async key=>{const r=await action(()=>api('accounts/quota/login',{key}));if(r)setLoginUrl(r.url);};
 const names={queued:'排队中',running:'查询中',succeeded:'成功',failed:'失败',cancelled:'已取消'};
 return <>
  <Card title="配额管理" extra={<Space wrap><Button disabled={locked||!selected.length} onClick={()=>start(selected.filter(k=>state.accounts.some(a=>a.key===k)))}>刷新所选（{selected.length}）</Button><Button type="primary" disabled={locked||!rows.length} onClick={()=>start(rows.map(a=>a.key))}>刷新当前筛选账号</Button></Space>}>
   <Space wrap><Input.Search aria-label="搜索配额账号" placeholder="搜索账号或备注" value={search} onChange={e=>setSearch(e.target.value)} allowClear/>
   <Select aria-label="配额筛选" value={filter} onChange={setFilter} options={[{value:'all',label:'全部账号'},{value:'low',label:'剩余 ≤ 20%'},{value:'unknown',label:'未知 / 已过期'}]}/>
   <Select aria-label="配额排序" value={sort} onChange={setSort} options={[{value:'default',label:'默认排序'},{value:'low',label:'剩余从低到高'},{value:'high',label:'剩余从高到低'}]}/></Space>
   <Paragraph className="spaced" type="secondary">显示官方查询快照，5分钟后标记过期；不会自动刷新或把恢复时间到达视为余额恢复。过期与未知数据不参与低额度筛选。</Paragraph>
  </Card>
  {job&&<Card title={`最近查询 · ${job.items.filter(i=>['succeeded','failed','cancelled'].includes(i.state)).length}/${job.items.length}`} extra={<Space>{running?<Button onClick={()=>action(()=>api('quota-jobs/cancel',{jobId:job.id}))}>取消查询</Button>:<Button disabled={locked||!job.items.some(i=>i.state==='failed')} onClick={()=>start(job.items.filter(i=>i.state==='failed').map(i=>i.key))}>仅重试失败项</Button>}</Space>}>
   {job.state==='interrupted'&&<Alert type="warning" title="服务重启，未完成查询已中断；没有自动重试"/>}
   <Table rowKey="key" size="small" pagination={false} dataSource={job.items} columns={[{title:'账号',render:(_,i)=>state.accounts.find(a=>a.key===i.key)?.note||state.accounts.find(a=>a.key===i.key)?.label||'已移除账号'},{title:'结果',render:(_,i)=><Tag color={i.state==='failed'?'error':i.state==='succeeded'?'success':'default'}>{names[i.state]}</Tag>},{title:'说明',dataIndex:'message'}]}/>
  </Card>}
  {state.quotaLoginPending&&<Alert className="spaced" type="info" title="等待同一ChatGPT账号的配额授权" description={<Space><Button href={loginUrl||undefined} disabled={!loginUrl} target="_blank" rel="noreferrer">打开配额授权页面</Button><Button onClick={()=>action(()=>api('login/cancel',{}))}>取消授权</Button></Space>}/>}
  <Row gutter={[16,16]}>{rows.map(a=>{
   const q=a.quota,old=q?.previous,windows=q?.windows||old?.windows||[],stale=q?.freshness==='stale';
   return <Col xs={24} lg={12} key={a.key}><Card title={<Space><Checkbox checked={selected.includes(a.key)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,a.key]:prev.filter(k=>k!==a.key))}/>{a.note||a.label}</Space>} extra={<Button disabled={locked} onClick={()=>start([a.key])}>刷新配额</Button>}>
    <Space wrap><Tag>{q?.planType||old?.planType||'套餐待查询'}</Tag><Tag color={q?.freshness==='current'?'success':'warning'}>{q?.freshness==='current'?'查询快照有效':stale?'已过期':'尚无有效快照'}</Tag>{a.disabled&&<Tag>账号已停用</Tag>}</Space>
    {q?.status!=='available'&&<Alert className="spaced" type="warning" title={q?.message||'尚未查询'} action={q?.status==='authorization_required'?<Button disabled={locked} onClick={()=>authorize(a.key)}>授权读取配额</Button>:null}/>}
    {stale&&<Alert className="spaced" type="warning" title="以下是历史快照，不能据此判断当前可用额度"/>}
    {windows.map(w=><div className="quota-window" key={w.id}><div className="between"><Text>{w.label}</Text><Text>{w.usedPercent===null?'用量未知':`剩余 ${(100-w.usedPercent).toFixed(0)}%`}</Text></div>{w.usedPercent!==null&&<Progress percent={100-w.usedPercent} showInfo={false} status={w.usedPercent>=80?'exception':'normal'}/>}<Text type="secondary">恢复时间：{date(w.resetAtMs)}{w.resetAtMs? w.resetAtMs>Date.now()?`（约${Math.ceil((w.resetAtMs-Date.now())/60000)}分钟后）`:'（已到达，可重新查询）':''}</Text></div>)}
    {!windows.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="官方未返回额度窗口"/>}
    <Paragraph className="spaced" type="secondary">额外积分：{q?.creditsUnlimited?'不限额':q?.creditBalance??old?.creditBalance??'未返回'}<br/>成功查询时间：{date(q?.status==='available'?q.checkedAt:old?.checkedAt)}<br/>最近尝试：{date(q?.checkedAt)}<br/>订阅到期：{q?.subscriptionActiveUntil?date(q.subscriptionActiveUntil):'未返回'}</Paragraph>
   </Card></Col>;
  })}</Row>{!rows.length&&<Empty description="没有符合筛选条件的账号"/>}
 </>;
}
