import React, {useState} from 'react';
import {App, Alert, Button, Card, Collapse, Space, Steps, Table, Tag, Typography} from 'antd';
import {CopyOutlined, EyeOutlined} from '@ant-design/icons';
const {Text, Paragraph} = Typography;
export function ClientsPage({state, api, action, blocked, copy}) {
  const {modal} = App.useApp(), [preview, setPreview] = useState(null), [result, setResult] = useState(null);
  const access = state?.clientAccess, rotation = access?.rotation;
  const confirm = (title, content, fn) => modal.confirm({title, content, okText:'确认', cancelText:'取消', onOk:async()=>{
    const r = await action(fn); if (r) {setResult(r);setPreview(null);}
  }});
  return <>
    <Card title="连接地址与密钥" extra={<Tag>本机连接</Tag>}>
      <div className="endpoint-grid">
        <section className="endpoint-tile"><Text strong>WorkBuddy 专用接口</Text><Text type="secondary">包含已授权的连接探测与标题兼容处理</Text><code>{location.origin}/workbuddy/v1</code><Button icon={<CopyOutlined/>} onClick={()=>copy('baseUrl')}>复制专用地址</Button></section>
        <section className="endpoint-tile"><Text strong>普通严格接口</Text><Text type="secondary">适用于标准客户端，按模型能力严格校验</Text><Text code copyable={{text:`${location.origin}/v1`}}>{location.origin}/v1</Text></section>
      </div>
      <div className="section-footer"><div><Text strong>本机连接密钥</Text><div><Text type="secondary">用于客户端鉴权，页面不展示密钥内容。</Text></div></div><Button icon={<CopyOutlined/>} onClick={()=>copy('apiKey')}>{rotation?'复制待启用的新密钥':'复制密钥'}</Button></div>
    </Card>
    <Card title="WorkBuddy 配置" extra={<Tag>先预览，再应用</Tag>}>
      <Paragraph type="secondary">加入当前版本工具验证通过的模型，更新已有 ModelBridge 条目。应用前保存加密备份，保留其他模型配置。</Paragraph>
      <Space wrap><Button type="primary" icon={<EyeOutlined/>} disabled={blocked||!state?.engine.reachable} onClick={async()=>{const p=await action(()=>api('client-access/preview',{}));if(p)setPreview(p);}}>预览配置改动</Button><Button disabled={blocked||!access?.lastBackup||!!rotation} onClick={()=>confirm('恢复上次客户端配置？','只在配置未被其他操作修改时恢复加密备份。',()=>api('client-access/restore',{}))}>恢复上次备份</Button></Space>
      {preview && <div className="change-preview spaced">
        <Table size="small" pagination={false} rowKey="key" scroll={{x:360}} dataSource={[['added','新增模型'],['updated','更新模型'],['removed','移除并备份']].map(([key,label])=>({key,label,models:preview.changes[key]||[]}))} columns={[{title:'改动',dataIndex:'label',width:120},{title:'数量',width:70,render:(_,r)=>r.models.length},{title:'模型条目',render:(_,r)=>r.models.length?<Space wrap>{r.models.map(m=><Tag key={m}>{m}</Tag>)}</Space>:<Text type="secondary">无改动</Text>}]}/>
        <Space wrap className="spaced"><Button type="primary" disabled={blocked} onClick={()=>confirm('应用这次 WorkBuddy 配置改动？','保存加密备份后写入；若客户端配置已变化会停止。',()=>api('client-access/apply',{expectedClientRevision:preview.revision,rotationId:preview.rotation?.id}))}>确认应用配置</Button><Button onClick={()=>setPreview(null)}>取消预览</Button></Space>
      </div>}
      {result && <Alert className="spaced" type="success" showIcon title="操作已完成" description={result.message||'配置操作已保存；请在 WorkBuddy 中刷新窗口并验证连接。'}/>}
    </Card>
    <Collapse key={rotation?.id||'idle'} defaultActiveKey={rotation?['rotation']:[]} items={[{key:'rotation',label:rotation?'连接密钥维护 · 更换尚未完成':'连接密钥维护',children:<>
      <Steps size="small" current={!rotation?0:rotation.stage==='pending'?1:rotation.verified?3:2} items={[{title:'生成新密钥'},{title:'更新客户端'},{title:'验证新连接'},{title:'撤销旧密钥'}]}/>
      {rotation?<><Alert className="spaced" type="warning" showIcon title="密钥更换尚未完成，旧密钥仍可用" description="完成新连接验证后，再明确撤销旧密钥。若操作失败可回滚；最终撤销后不会再提供含旧密钥的配置恢复入口。"/><Space wrap className="spaced"><Button disabled={blocked||rotation.stage==='pending'} onClick={async()=>{const r=await action(()=>api('client-access/verify',{}));if(r)setResult(r);}}>验证新密钥连接</Button><Button disabled={blocked||!rotation.verified} type="primary" onClick={()=>confirm('完成更换并撤销旧密钥？','使用旧密钥的其他手动配置客户端将无法连接，请确认已更新。',()=>api('client-access/complete',{rotationId:rotation.id}))}>完成更换，撤销旧密钥</Button><Button disabled={blocked} onClick={()=>confirm('回滚本次密钥更换？','恢复备份配置，撤销新密钥，保留旧密钥。',()=>api('client-access/rollback',{rotationId:rotation.id}))}>回滚本次更换</Button></Space></>:<Button className="spaced" disabled={blocked} onClick={()=>confirm('开始更换本机连接密钥？','生成新密钥后旧密钥暂时保持有效，完成配置及验证后再撤销。',()=>api('client-access/begin',{}))}>开始更换密钥</Button>}
      <Paragraph className="spaced" type="secondary">连接验证只检查本机鉴权和目录，不消耗模型用量。工具与长会话请到调用验证页执行。</Paragraph>
    </>}]} />
  </>;
}
