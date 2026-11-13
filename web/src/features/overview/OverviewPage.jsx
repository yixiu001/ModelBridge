import React from 'react';
import {Alert,Button,Card,Col,Descriptions,Progress,Row,Space,Statistic,Typography} from 'antd';
import {date} from '../../console-utils.mjs';
export function OverviewPage({state}){
 const s=state.activitySummary,a=state.accounts.find(a=>a.active);
 return <><Row gutter={[16,16]}>{[['今日请求',s?.requests],['成功',s?.successes],['失败',s?.failures],['取消',s?.cancelled]].map(([title,value])=><Col xs={12} lg={6} key={title}><Card><Statistic title={title} value={value??'—'}/></Card></Col>)}</Row>
 <Card title="当前运行状态"><Descriptions column={1} items={[{key:'account',label:'当前账号',children:a?.note||a?.label||'未选择账号'},{key:'auth',label:'调用 / 配额授权',children:`${a?.health?.inference.state==='ready'?'调用授权已保存':'调用授权待检查'} · ${a?.health?.quota.state==='ready'?'配额授权已保存':'配额授权待检查'}`},{key:'quota',label:'配额快照时间',children:date(a?.quota?.checkedAt)},{key:'coverage',label:'本机记录覆盖起点',children:date(s?.coverageStart)},{key:'tokens',label:'上游实际返回token合计',children:s?`${s.knownUsage.totalTokens}（${s.unknownUsageCount}次未返回用量）`:'尚无统计'}]}/><Space wrap className="spaced"><Button onClick={()=>location.hash='accounts'}>管理账号</Button><Button onClick={()=>location.hash='quota'}>查看配额</Button><Button onClick={()=>location.hash='logs'}>排查请求</Button></Space></Card>
 {s?.truncated&&<Alert type="warning" title="历史记录已达到保留限制，统计仅覆盖当前留存范围"/>}
 {state.storageError&&<Alert type="error" title={state.storageError}/>}
 <Card title="今日失败分类">{Object.keys(s?.categories||{}).length?Object.entries(s.categories).map(([key,count])=><div key={key}><Typography.Text>{key} · {count}</Typography.Text><Progress percent={s.failures?Math.round(count/s.failures*100):0} showInfo={false}/></div>):<Typography.Text type="secondary">当前统计范围内没有失败分类记录</Typography.Text>}<Typography.Paragraph type="secondary" className="spaced">统计从本机当天零点开始，受保留范围限制；本机请求量和token合计不代表会员剩余额度。</Typography.Paragraph></Card></>;
}
