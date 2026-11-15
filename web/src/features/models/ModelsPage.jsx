import React,{useState} from 'react';
import {Alert,Button,Card,Descriptions,Drawer,Input,Segmented,Space,Table,Tag,Typography} from 'antd';
import {date} from '../../console-utils.mjs';
const {Text,Paragraph}=Typography;
export function ModelsPage({state,api,action,blocked,verify}){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[detail,setDetail]=useState(null);
 const models=state?.models||[],catalog=state?.catalog;
 return <><Card title={`模型目录 · ${models.length}`} extra={<Button disabled={blocked||!state?.account?.connected} onClick={()=>action(()=>api('models/refresh',{}),'目录已刷新')}>刷新目录</Button>}>
  <div className="toolbar"><Input.Search aria-label="搜索模型" placeholder="搜索模型名称" value={query} onChange={e=>setQuery(e.target.value)} allowClear/><Segmented value={filter} onChange={setFilter} options={[{value:'all',label:`全部 ${models.length}`},{value:'available',label:`可用 ${models.filter(m=>m.selectable).length}`},{value:'hidden',label:'不可选 / 已禁用'}]}/></div>
  <Alert className="spaced" type={catalog?.stale?'warning':'info'} title={catalog?.stale?'官方目录刷新失败或尚未刷新；显示的是历史快照':'目录声明与实测结果分别展示；规则或授权变化后需要重新验证'}/>
  <Paragraph type="secondary" className="spaced">来源：{catalog?.source||'官方账号目录'} · 更新时间：{date(catalog?.checkedAt)} · 当前账号：{state?.account?.label||'未登录'}</Paragraph>
  {catalog?.changes&&<Paragraph>最近目录变动：新增 {catalog.changes.added.join('、')||'无'}；移除 {catalog.changes.removed.join('、')||'无'}；能力变化 {catalog.changes.changed.join('、')||'无'}</Paragraph>}
  <Table className="model-table" size="middle" rowKey="slug" scroll={{x:880}} dataSource={models.filter(m=>(m.slug+' '+m.displayName).toLowerCase().includes(query.toLowerCase())&&(filter==='all'||filter==='available'&&m.selectable||filter==='hidden'&&!m.selectable))} columns={[
   {title:'模型名称',width:230,dataIndex:'slug',render:v=><Text copyable>{v}</Text>},{title:'可用性',width:90,render:(_,m)=><Tag color={m.selectable?'success':'default'}>{m.selectable?'可用':'不可选'}</Tag>},
   ...[['tools','基础工具'],['files','文件工具'],['mcp','MCP工具'],['long','长会话']].map(([key,title])=>({title,width:100,render:(_,m)=><Tag title={m.checks?.[key]?.status==='passed'?'当前版本已通过实际验证':undefined} color={m.checks?.[key]?.status==='passed'?'success':m.checks?.[key]?.status==='failed'?'error':'default'}>{m.checks?.[key]?.status==='passed'?'已通过':m.checks?.[key]?.status==='failed'?'失败':'待验证'}</Tag>})),
   {title:'操作',width:160,fixed:'right',render:(_,m)=><Space size={4}><Button type="text" size="small" onClick={()=>setDetail(m)}>详情</Button><Button size="small" disabled={blocked||!m.selectable} onClick={()=>verify(m.slug,'tools')}>验证工具</Button></Space>}
  ]}/>
 </Card><Drawer title="模型能力与验证" open={!!detail} onClose={()=>setDetail(null)} size="large">{detail&&<><Descriptions column={1} items={[{key:'model',label:'模型',children:detail.slug},{key:'upstream',label:'实际请求模型',children:detail.upstreamModel||detail.slug},{key:'declared',label:'能力来源',children:'官方声明，不等于全部实测'}]}/><pre className="config-preview">{JSON.stringify(detail.declared,null,2)}</pre><Button onClick={()=>location.hash='tests'}>打开验证矩阵</Button></>}</Drawer></>;
}
