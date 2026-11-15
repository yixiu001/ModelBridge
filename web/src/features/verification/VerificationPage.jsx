import React, {useState} from 'react';
import {Alert, Button, Card, Descriptions, Drawer, Input, Select, Space, Table, Tabs, Tag, Typography} from 'antd';
import {PlayCircleOutlined} from '@ant-design/icons';
import {date} from '../../console-utils.mjs';
import {verificationKinds as kinds, resultLabels} from '../../display-labels.mjs';
const {Text, Paragraph} = Typography;
export function VerificationPage({state, api, action, blocked, verify}) {
  const [model, setModel] = useState(), [kind, setKind] = useState('tools'), [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('matrix'), [query, setQuery] = useState('');
  const models = state?.models?.filter(m=>m.selectable)||[], selected = models.some(m=>m.slug===model)?model:models[0]?.slug;
  const history = [...(state?.reportHistory||[])].reverse();
  const badge = r => <Tag color={r?.status==='passed'?'success':r?.status==='failed'?'error':'default'}>{resultLabels[r?.status]||r?.status||'未验证'}</Tag>;
  const descriptions = {text:'检查真实文本请求与返回结果。',tools:'验证模型发起工具调用、接收结果并完成回答。',files:'在隔离目录内验证文件读写闭环。',mcp:'通过隔离的 MCP 工具验证调用与结果返回。',long:'执行 12 轮、约 64 KiB 内容和历史回忆检查，可能需要数分钟。'};
  return <>
    <Card title="发起验证" extra={<Tag>{models.length} 个可选模型</Tag>}>
      <div className="task-form">
        <div><Text strong>验证模型</Text><Select aria-label="验证模型" showSearch optionFilterProp="label" value={selected} onChange={setModel} options={models.map(m=>({value:m.slug,label:m.slug}))}/></div>
        <div><Text strong>验证项目</Text><Select aria-label="验证项目" value={kind} onChange={setKind} options={Object.entries(kinds).map(([value,label])=>({value,label}))}/></div>
        <Space wrap><Button type="primary" icon={<PlayCircleOutlined/>} disabled={blocked||!selected} onClick={()=>verify(selected,kind)}>开始验证</Button>{state?.busy&&<Button onClick={()=>action(()=>api('cancel',{}))}>取消当前验证</Button>}</Space>
      </div>
      <Paragraph type="secondary" className="spaced">{descriptions[kind]}</Paragraph>
      <Alert showIcon type="warning" title="验证会使用会员用量" description="执行真实模型请求；文件与 MCP 测试只访问隔离数据。"/>
    </Card>
    <Card className="verification-results">
      <Tabs activeKey={tab} onChange={setTab} items={[{key:'matrix',label:`当前验证矩阵 · ${models.length}`},{key:'history',label:`验证历史 · ${history.length}`}]}/>
      <div className="toolbar"><Input.Search aria-label="筛选验证模型" placeholder="按模型名称筛选结果" value={query} onChange={e=>setQuery(e.target.value)} allowClear/><Text type="secondary">点击结果查看验证证据</Text></div>
      {tab==='matrix'?<><Paragraph type="secondary">仅账号、授权、目录、规则和适配器版本匹配的结果有效；官方能力声明不等于实际验证。</Paragraph><Table rowKey="slug" size="middle" scroll={{x:800}} pagination={false} dataSource={models.filter(m=>m.slug.toLowerCase().includes(query.toLowerCase()))} columns={[{title:'模型',dataIndex:'slug',width:230},...Object.entries(kinds).map(([key,title])=>({title,width:114,render:(_,m)=><Button className="matrix-result" type="text" aria-label={`${m.slug} ${title} ${resultLabels[m.checks?.[key]?.status]||m.checks?.[key]?.status||'未验证'}`} disabled={!m.checks?.[key]} onClick={()=>setDetail(m.checks[key])}>{badge(m.checks?.[key])}</Button>}))]}/></>:
      <Table rowKey={(r,i)=>`${r.verificationKey||r.model}-${r.startedAt}-${i}`} size="middle" scroll={{x:900}} dataSource={history.filter(r=>(r.model||'').toLowerCase().includes(query.toLowerCase()))} columns={[{title:'时间',dataIndex:'startedAt',render:date,width:175},{title:'模型',dataIndex:'model',width:210},{title:'场景',render:(_,r)=>kinds[r.kind]||r.kind,width:110},{title:'适用范围',render:(_,r)=><Tag>{r.current?'当前版本':'历史证据'}</Tag>,width:125},{title:'结果',render:(_,r)=>badge(r),width:140},{title:'操作',width:90,fixed:'right',render:(_,r)=><Button type="text" size="small" onClick={()=>setDetail(r)}>详情</Button>}]}/>}
    </Card>
    <Drawer title="验证证据" open={!!detail} onClose={()=>setDetail(null)} size="large">{detail&&<>
      <div className="detail-summary">{badge(detail)}<Text strong>{detail.model||'验证结果'}</Text></div>
      {detail.error&&<Alert className="detail-error" type="warning" showIcon title={typeof detail.error==='string'?detail.error:detail.error.message||'验证未完成，请查看完整数据'}/>}
      <Descriptions column={1} items={[{key:'kind',label:'验证项目',children:kinds[detail.kind]||detail.kind||'—'},{key:'start',label:'开始时间',children:date(detail.startedAt)},{key:'end',label:'完成时间',children:date(detail.finishedAt)},{key:'requests',label:'请求次数',children:detail.requests??'未记录'},{key:'tools',label:'工具调用次数',children:detail.toolCalls??'未记录'}]}/>
      <details className="query-details"><summary>完整验证数据</summary><pre className="config-preview">{JSON.stringify(detail,null,2)}</pre></details>
    </>}</Drawer>
  </>;
}
