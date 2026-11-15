import React, {useState} from 'react';
import {Alert, Button, Card, Checkbox, Collapse, Empty, Input, Progress, Select, Space, Table, Tag, Typography} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import {date, subscriptionSummary} from '../../console-utils.mjs';
const {Text, Paragraph} = Typography;
const remaining = a => a.quota?.freshness === 'current'
  ? Math.min(...(a.quota.windows || []).filter(w => w.usedPercent !== null).map(w => 100 - w.usedPercent), Infinity)
  : Infinity;

export function QuotaPage({state, api, action, blocked}) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('default'), [selected, setSelected] = useState([]), [loginUrl, setLoginUrl] = useState('');
  const job = state.quotaJob, running = ['queued', 'running'].includes(job?.state);
  const locked = blocked || state.loginPending || running;
  const selectedKeys = selected.filter(k => state.accounts.some(a => a.key === k));
  const rows = state.accounts.filter(a => ((a.label || '') + ' ' + (a.note || '')).toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' || filter === 'low' && remaining(a) <= 20 || filter === 'unknown' && !Number.isFinite(remaining(a))));
  if (sort !== 'default') rows.sort((a, b) => {
    const x = remaining(a), y = remaining(b);
    return !Number.isFinite(x) ? !Number.isFinite(y) ? 0 : 1 : !Number.isFinite(y) ? -1 : sort === 'low' ? x - y : y - x;
  });
  const start = keys => action(() => api('quota-jobs/start', {accountKeys: keys}));
  const authorize = async key => {const r = await action(() => api('accounts/quota/login', {key})); if (r) setLoginUrl(r.url);};
  const names = {queued: '排队中', running: '查询中', succeeded: '成功', failed: '失败', cancelled: '已取消'};
  const completed = job?.items.filter(i => ['succeeded', 'failed', 'cancelled'].includes(i.state)).length;
  const failed = job?.items.filter(i => i.state === 'failed') || [];

  return <>
    <Card className="quota-toolbar-card">
      <div className="toolbar quota-toolbar">
        <Input.Search aria-label="搜索配额账号" placeholder="搜索账号或备注" value={search} onChange={e => setSearch(e.target.value)} allowClear/>
        <Space wrap>
          <Select aria-label="配额筛选" value={filter} onChange={setFilter} options={[{value:'all',label:'全部账号'},{value:'low',label:'剩余 ≤ 20%'},{value:'unknown',label:'未知 / 快照过期'}]}/>
          <Select aria-label="配额排序" value={sort} onChange={setSort} options={[{value:'default',label:'默认排序'},{value:'low',label:'剩余从低到高'},{value:'high',label:'剩余从高到低'}]}/>
          <Button type="primary" icon={<ReloadOutlined/>} disabled={locked || !rows.length} onClick={() => start(rows.map(a => a.key))}>刷新筛选结果</Button>
        </Space>
      </div>
      <div className="quota-toolbar-note"><Text type="secondary">共 {rows.length} 个账号 · 快照保留 5 分钟有效期，需手动刷新。</Text><Text type="secondary">过期与未知数据不参与低额度筛选。</Text></div>
      {selectedKeys.length > 0 && <Space wrap className="selection-toolbar spaced"><Text>已选 {selectedKeys.length} 个账号</Text><Button disabled={locked} onClick={() => start(selectedKeys)}>刷新所选</Button><Button type="text" onClick={() => setSelected([])}>取消选择</Button></Space>}
    </Card>
    {state.quotaLoginPending && <Alert type="info" title="等待同一 ChatGPT 账号的配额授权" description={<Space wrap><Button href={loginUrl || undefined} disabled={!loginUrl} target="_blank" rel="noreferrer">打开配额授权页面</Button><Button onClick={() => action(() => api('login/cancel', {}))}>取消授权</Button></Space>}/>}
    <div className="quota-account-list">{rows.map(a => {
      const q = a.quota, old = q?.previous, windows = q?.windows || old?.windows || [];
      const current = q?.freshness === 'current', stale = q?.freshness === 'stale', subscription = subscriptionSummary(q);
      return <Card key={a.key} className="quota-account-card" title={<Space wrap><Checkbox aria-label={`选择配额账号 ${a.note || a.label}`} checked={selectedKeys.includes(a.key)} onChange={e => setSelected(prev => e.target.checked ? [...prev, a.key] : prev.filter(k => k !== a.key))}/><span>{a.note || a.label}</span><Tag>{q?.planType || old?.planType || '套餐待查询'}</Tag>{a.disabled && <Tag>已停用</Tag>}</Space>} extra={<Button icon={<ReloadOutlined/>} disabled={locked} onClick={() => start([a.key])}>刷新配额</Button>}>
        <div className="quota-card-status"><Tag color={current ? 'success' : 'warning'}>{current ? '快照有效' : stale ? '快照已过期' : '尚无有效快照'}</Tag><Text type="secondary">成功查询：{date(q?.status === 'available' ? q.checkedAt : old?.checkedAt)}</Text></div>
        {q?.status !== 'available' && <Alert className="spaced" type="warning" title={q?.message || '尚未查询'} action={q?.status === 'authorization_required' ? <Button disabled={locked} onClick={() => authorize(a.key)}>授权读取配额</Button> : null}/>}
        {stale && <Alert className="spaced" type="warning" showIcon title="以下为历史快照，当前剩余额度请刷新确认"/>}
        <div className="quota-account-content">
          <section className="quota-balances" aria-label="额度窗口">
            {windows.map(w => <div className="quota-balance" key={w.id}>
              <div className="between"><Text strong>{w.label}</Text><Text type="secondary">{current ? '剩余额度' : '历史剩余'}</Text></div>
              <div className="quota-value">{w.usedPercent === null ? <span className="quota-unknown">用量未知</span> : <>{(100-w.usedPercent).toFixed(0)}<span>%</span></>}</div>
              {w.usedPercent !== null && <Progress percent={100-w.usedPercent} showInfo={false} strokeColor={!current ? 'var(--secondary)' : w.usedPercent >= 80 ? 'var(--failure)' : 'var(--success)'}/>}
              <Text type="secondary">恢复时间：{date(w.resetAtMs)}</Text>
              {w.resetAtMs && <div><Text type="secondary">{w.resetAtMs > Date.now() ? `约 ${Math.ceil((w.resetAtMs-Date.now())/60000)} 分钟后` : '已到达，可重新查询；不代表额度已恢复'}</Text></div>}
            </div>)}
            {!windows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="官方未返回额度窗口"/>}
          </section>
          <section className="subscription-summary" aria-label="订阅与积分">
            <Text type="secondary">订阅到期</Text>
            <div className="subscription-date">{subscription.activeUntil ? date(subscription.activeUntil) : '暂未获取'}</div>
            <Paragraph type="secondary">{subscription.message}</Paragraph>
            {subscription.previous && <Paragraph type="warning">上次查到：{date(subscription.previous.activeUntil)}（历史记录，查询于 {date(subscription.previous.checkedAt)}）</Paragraph>}
            <div className="quota-credit"><Text type="secondary">额外积分</Text><Text strong>{q?.creditsUnlimited ? '不限额' : q?.creditBalance ?? old?.creditBalance ?? '未返回'}</Text></div>
            <Text type="secondary">订阅查询不影响配额结果。</Text>
          </section>
        </div>
        <details className="query-details"><summary>查询时间与数据说明</summary><div><Text type="secondary">最近配额尝试：{date(q?.checkedAt)}</Text><br/><Text type="secondary">订阅查询时间：{date(subscription.checkedAt)}</Text><br/><Text type="secondary">不会自动刷新，也不会把恢复时间到达视为额度恢复。</Text></div></details>
      </Card>;
    })}</div>
    {!rows.length && <Card><Empty description="没有符合筛选条件的账号"/></Card>}
    {job && <Collapse key={job.id} defaultActiveKey={running || failed.length || job.state === 'interrupted' ? ['job'] : []} items={[{key:'job',label:`最近查询 · 已处理 ${completed}/${job.items.length}${failed.length ? ` · ${failed.length} 项失败` : ''}`,children:<>
      <div className="query-job-actions"><Text type="secondary">{running ? '正在逐个查询账号' : '查询记录'}</Text>{running ? <Button onClick={() => action(() => api('quota-jobs/cancel', {jobId:job.id}))}>取消查询</Button> : <Button disabled={locked || !failed.length} onClick={() => start(failed.map(i => i.key))}>仅重试失败项</Button>}</div>
      {job.state === 'interrupted' && <Alert type="warning" title="服务重启，未完成查询已中断；没有自动重试"/>}
      <Table rowKey="key" size="small" scroll={{x:420}} pagination={false} dataSource={job.items} columns={[{title:'账号',render:(_,i)=>state.accounts.find(a=>a.key===i.key)?.note||state.accounts.find(a=>a.key===i.key)?.label||'已移除账号'},{title:'结果',render:(_,i)=><Tag color={i.state==='failed'?'error':i.state==='succeeded'?'success':'default'}>{names[i.state] || i.state}</Tag>},{title:'说明',render:(_,i)=>i.message || '—'}]}/>
    </>}]} />}
  </>;
}
