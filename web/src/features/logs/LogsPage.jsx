import React, {useState, useEffect, useRef} from 'react';
import {Alert, Button, Card, Descriptions, Drawer, Input, Select, Space, Table, Tabs, Tag, Typography} from 'antd';
import {DownloadOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined} from '@ant-design/icons';
import {date, download} from '../../console-utils.mjs';
import {failureLabels, sourceLabels} from '../../display-labels.mjs';
const {Text} = Typography;
const eventLabels = {service_started:'服务启动', settings_saved:'设置已保存'};
export function LogsPage({state, api, action}) {
  const [items,setItems]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState('');
  const [paused,setPaused]=useState(false),[loading,setLoading]=useState(false),[updated,setUpdated]=useState(null),[detail,setDetail]=useState(null);
  const [kind,setKind]=useState('request'),[status,setStatus]=useState('all'),[model,setModel]=useState(''),[modelDraft,setModelDraft]=useState(''),[source,setSource]=useState('all'),[hours,setHours]=useState(24);
  const generation=useRef(0),pending=useRef(false),pauseRef=useRef(false),filters={kind,status,model,source};
  const query=()=>({from:new Date(Date.now()-hours*3600000).toISOString(),filters});
  const read=async(more=false)=>{
    if(pending.current)return;
    const gen=++generation.current;pending.current=true;setLoading(true);
    try {
      const r=await api('activity/read',{...query(),limit:100,cursor:more?cursor:undefined});
      if(gen!==generation.current)return;
      setItems(old=>more?[...old,...r.items]:r.items);setCursor(r.nextCursor);
      setError(r.cursorExpired?'历史记录已因保留策略变化，请刷新':'');setUpdated(new Date().toISOString());
    } catch {if(gen===generation.current)setError('日志读取失败，请重试');}
    finally {if(gen===generation.current){pending.current=false;setLoading(false);}}
  };
  useEffect(()=>{pending.current=false;setItems([]);setCursor(null);setUpdated(null);read();return()=>{generation.current++;};},[kind,status,model,source,hours]);
  useEffect(()=>{if(!paused){const timer=setInterval(()=>{if(!pauseRef.current)read();},5000);return()=>clearInterval(timer);}},[paused,kind,status,model,source,hours]);
  const togglePause=()=>{pauseRef.current=!paused;generation.current++;pending.current=false;setLoading(false);setPaused(v=>!v);if(paused)read();};
  const reset=()=>{setStatus('all');setSource('all');setModel('');setModelDraft('');setHours(24);};
  const outcome=r=><Tag color={r.status==='forwarded'?'success':r.status==='failed'?'error':'default'}>{r.status==='forwarded'?'成功':r.status==='cancelled'?'已取消':r.status==='failed'?'失败':r.status||'未知'}{r.httpStatus!=null?` · ${r.httpStatus}`:''}</Tag>;
  return <Card title="运行日志" extra={<Space wrap>
    <Button icon={paused?<PlayCircleOutlined/>:<PauseOutlined/>} onClick={togglePause}>{paused?'继续刷新':'暂停显示'}</Button>
    <Button icon={<ReloadOutlined/>} loading={loading} onClick={()=>read()}>刷新</Button>
    <Button icon={<DownloadOutlined/>} onClick={()=>action(async()=>download('modelbridge-diagnostics.json',await api('activity/export',query())))}>导出脱敏诊断</Button>
  </Space>}>
    <Tabs activeKey={kind} onChange={value=>{setKind(value);setStatus('all');setSource('all');setModel('');setModelDraft('');}} items={[{key:'request',label:'模型请求'},{key:'system',label:'系统事件'}]}/>
    <div className="log-filters">
      <Select aria-label="日志时间" value={hours} onChange={setHours} options={[{value:1,label:'最近 1 小时'},{value:24,label:'最近 24 小时'},{value:168,label:'最近 7 天'}]}/>
      <Select aria-label="日志结果" value={status} onChange={setStatus} options={[{value:'all',label:'全部结果'},{value:'forwarded',label:'成功'},{value:'failed',label:'失败'},{value:'cancelled',label:'取消'}]}/>
      <Select aria-label="错误来源" value={source} onChange={setSource} options={[{value:'all',label:'全部来源'},...Object.entries(sourceLabels).map(([value,label])=>({value,label}))]}/>
      {kind==='request'&&<Input.Search aria-label="日志模型" placeholder="输入完整模型名后按回车" value={modelDraft} onChange={e=>{setModelDraft(e.target.value);if(!e.target.value)setModel('');}} onSearch={value=>setModel(value.trim())} allowClear/>}
      <Button type="text" disabled={status==='all'&&source==='all'&&!modelDraft&&hours===24} onClick={reset}>重置筛选</Button>
    </div>
    <div className="list-status"><Space wrap><Tag color={paused?'default':'success'}>{paused?'已暂停自动刷新':'每 5 秒刷新'}</Tag><Text type="secondary">已显示 {items.length} 条{model?` · 模型：${model}`:''}</Text></Space><Text type="secondary">最近读取：{date(updated)}</Text></div>
    {error&&<Alert className="spaced" showIcon type="warning" title={error} action={<Button disabled={loading} onClick={()=>read()}>重试</Button>}/>}
    {state?.storageError&&<Alert showIcon type="error" title={state.storageError}/>}
    <Table className="spaced" rowKey="id" size="middle" loading={loading} scroll={{x:1050}} pagination={false} dataSource={items} locale={{emptyText:loading?'读取日志中…':'当前条件下没有日志'}} columns={[
      {title:'时间',dataIndex:'finishedAt',render:date,width:175},
      {title:'账号',width:150,render:(_,r)=>state.accounts.find(a=>a.key===r.accountKey)?.note||state.accounts.find(a=>a.key===r.accountKey)?.label||'—'},
      {title:kind==='system'?'事件':'模型',width:230,render:(_,r)=><Text>{kind==='system'?(eventLabels[r.event]||r.event):r.model}</Text>},
      {title:'结果',width:140,render:(_,r)=>outcome(r)},
      {title:'错误类别',width:150,render:(_,r)=>failureLabels[r.failure?.category]||r.failure?.category||'—'},
      {title:'操作',width:80,fixed:'right',render:(_,r)=><Button type="text" size="small" onClick={()=>setDetail(r)}>详情</Button>},
    ]}/>
    <div className="section-footer"><Text type="secondary">暂停后可加载更早记录；恢复刷新会回到最新记录。</Text><Button disabled={!cursor||!paused||loading} onClick={()=>read(true)}>{cursor?'加载更早记录':'没有更多记录'}</Button></div>
    <Drawer title={detail?.kind==='system'?'系统事件详情':'请求诊断'} open={!!detail} onClose={()=>setDetail(null)} size="large">{detail&&<>
      <div className="detail-summary">{outcome(detail)}<Text strong>{detail.model||eventLabels[detail.event]||detail.event||'运行记录'}</Text></div>
      <Descriptions column={1} items={[
        {key:'id',label:detail.kind==='system'?'事件编号':'请求编号',children:<Text copyable>{detail.id}</Text>},
        {key:'time',label:'完成时间',children:date(detail.finishedAt)},
        ...(detail.kind==='system'?[]:[{key:'model',label:'指定 / 实际模型',children:`${detail.requestedModel||'—'} / ${detail.effectiveModel||'—'}`}]),
        {key:'category',label:'错误类别',children:failureLabels[detail.failure?.category]||detail.failure?.category||'无'},
        {key:'source',label:'错误来源',children:sourceLabels[detail.failure?.source]||detail.failure?.source||'无'},
        {key:'field',label:'相关字段',children:detail.failure?.param||'未返回'},
        ...(detail.kind==='system'?[]:[{key:'usage',label:'已知 token 用量',children:detail.usage?.totalTokens??'未返回'}]),
      ]}/>
      {detail.failure&&<Alert className="spaced" showIcon type="info" title="不会自动重试或切换模型" description="参数问题请对照模型能力；授权问题请到账号详情恢复；限流不等于余额为零。"/>}
      <details className="query-details"><summary>完整脱敏记录</summary><pre className="config-preview">{JSON.stringify(detail,null,2)}</pre></details>
    </>}</Drawer>
  </Card>;
}
