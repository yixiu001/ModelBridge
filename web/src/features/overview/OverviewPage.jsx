import React from 'react';
import {Alert,Button,Card,Col,Descriptions,Empty,Progress,Row,Space,Statistic,Typography} from 'antd';
import {date} from '../../console-utils.mjs';
export function OverviewPage({state}) {
 const s=state.activitySummary,a=state.accounts.find(a=>a.active);
 const trend=s?.trend||[],max=Math.max(...trend.map(r=>r.successes+r.failures+r.cancelled),1);
 return <>
  <Row gutter={[16,16]}>{[['今日请求',s?.requests],['成功',s?.successes],['失败',s?.failures],['取消',s?.cancelled]].map(([title,value])=><Col xs={12} lg={6} key={title}><Card className="metric-card"><Statistic title={title} value={value??'—'}/></Card></Col>)}</Row>
  {s?.truncated&&<Alert type="warning" title="历史记录已达到保留限制，统计仅覆盖当前留存范围"/>}
  {state.storageError&&<Alert type="error" title={state.storageError}/>}
  <Row gutter={[20,20]} className="overview-grid">
   <Col xs={24} lg={14}><Card title="今日每小时请求趋势" extra={<Typography.Text type="secondary">本机时间</Typography.Text>}>
    <Typography.Text type="secondary">绿：成功 · 红：失败 · 灰：取消</Typography.Text>
    {trend.length?<div className="trend-chart">{trend.map(r=>{const total=r.successes+r.failures+r.cancelled;return <div className="trend-hour" key={r.hour}><div className="trend-column" role="img" aria-label={`${date(r.hour)} 成功${r.successes} 失败${r.failures} 取消${r.cancelled}`}><div className="trend-stack" style={{height:Math.max(2,total/max*125)}}>{[['successes','var(--success)'],['failures','var(--failure)'],['cancelled','#8b8680']].map(([key,color])=><div key={key} style={{height:(total?r[key]/total*100:0)+'%',background:color}}/>)}</div><span>{total}</span></div><Typography.Text>{new Date(r.hour).getHours()}:00</Typography.Text></div>;})}</div>:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今天还没有请求记录"/>}
    <Typography.Paragraph type="secondary" className="spaced">仅显示有记录的小时，统计受本机保留范围限制。</Typography.Paragraph>
   </Card></Col>
   <Col xs={24} lg={10}><Card title="当前运行状态"><Descriptions column={1} items={[
    {key:'account',label:'当前账号',children:a?.note||a?.label||'未选择账号'},
    {key:'auth',label:'授权状态',children:`${a?.health?.inference.state==='ready'?'调用授权已保存':'调用授权待检查'} · ${a?.health?.quota.state==='ready'?'配额授权已保存':'配额授权待检查'}`},
    {key:'quota',label:'配额快照',children:date(a?.quota?.checkedAt)},
    {key:'coverage',label:'记录起点',children:date(s?.coverageStart)},
    {key:'tokens',label:'已知 token',children:s?`${s.knownUsage.totalTokens.toLocaleString()}（${s.unknownUsageCount} 次未返回用量）`:'尚无统计'},
   ]}/><Space wrap className="spaced"><Button onClick={()=>location.hash='accounts'}>管理账号</Button><Button onClick={()=>location.hash='quota'}>查看配额</Button><Button onClick={()=>location.hash='logs'}>排查请求</Button></Space></Card></Col>
  </Row>
  <Card title="今日失败分类">{Object.keys(s?.categories||{}).length?Object.entries(s.categories).map(([key,count])=><div key={key}><Typography.Text>{key} · {count}</Typography.Text><Progress percent={s.failures?Math.round(count/s.failures*100):0} strokeColor="var(--failure)" showInfo={false}/></div>):<Typography.Text type="secondary">当前统计范围内没有失败分类记录</Typography.Text>}<Typography.Paragraph type="secondary" className="spaced">统计从本机当天零点开始；本机请求量和 token 合计不代表会员剩余额度。</Typography.Paragraph></Card>
 </>;
}
