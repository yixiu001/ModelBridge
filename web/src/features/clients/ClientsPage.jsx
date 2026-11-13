import React,{useState} from 'react';
import {App,Alert,Button,Card,Descriptions,Space,Steps,Typography} from 'antd';
const {Text,Paragraph}=Typography;
export function ClientsPage({state,api,action,blocked,copy}){
 const {modal}=App.useApp(),[preview,setPreview]=useState(null),[result,setResult]=useState(null);
 const access=state?.clientAccess,rotation=access?.rotation;
 const confirm=(title,content,fn)=>modal.confirm({title,content,okText:'确认',cancelText:'取消',onOk:async()=>{const r=await action(fn);if(r){setResult(r);setPreview(null);}}});
 return <><Card title="客户端连接信息"><Descriptions column={1} items={[{key:'dedicated',label:'WorkBuddy专用地址',children:<Space wrap><Text code>{location.origin}/workbuddy/v1</Text><Button onClick={()=>copy('baseUrl')}>复制地址</Button></Space>},{key:'strict',label:'普通严格接口',children:<Text code>{location.origin}/v1</Text>},{key:'key',label:'本机连接密钥',children:<Button onClick={()=>copy('apiKey')}>{rotation?'复制待启用的新密钥':'复制密钥'}</Button>}]}/><Paragraph className="spaced" type="secondary">WorkBuddy专用接口只执行已经确认的连接探测和标题兼容转换，模型不会替换；普通接口保持严格校验。</Paragraph></Card>
 <Card title="WorkBuddy配置预览与恢复"><Paragraph>只加入当前版本工具验证通过的模型，并更新本项目已有条目。应用前保存加密备份，其他模型配置保持原样。</Paragraph>
 <Space wrap><Button type="primary" disabled={blocked||!state?.engine.reachable} onClick={async()=>{const p=await action(()=>api('client-access/preview',{}));if(p)setPreview(p);}}>预览配置改动</Button><Button disabled={blocked||!access?.lastBackup||!!rotation} onClick={()=>confirm('恢复上次客户端配置？','只在配置未被其他操作修改时恢复加密备份。',()=>api('client-access/restore',{}))}>恢复上次备份</Button></Space>
 {preview&&<><pre className="config-preview">{JSON.stringify({新增:preview.changes.added,更新:preview.changes.updated,移除并备份:preview.changes.removed},null,2)}</pre><Button disabled={blocked} onClick={()=>confirm('应用这次WorkBuddy配置改动？','保存加密备份后写入；若客户端配置已变化会停止。',()=>api('client-access/apply',{expectedClientRevision:preview.revision,rotationId:preview.rotation?.id}))}>确认应用配置</Button></>}
 {result&&<Alert className="spaced" type="success" title="操作已完成" description={result.message||'配置操作已保存；在WorkBuddy中刷新窗口并进行原生界面验证。'}/>}
 </Card><Card title="更换连接密钥">
  <Steps size="small" current={!rotation?0:rotation.stage==='pending'?1:rotation.verified?3:2} items={[{title:'生成新密钥'},{title:'更新客户端配置'},{title:'验证新连接'},{title:'撤销旧密钥'}]}/>
  {rotation?<><Alert className="spaced" type="warning" title="密钥更换尚未完成，旧密钥仍可用" description="完成新连接验证后，再明确撤销旧密钥。若操作失败可回滚；最终撤销后不会再提供含旧密钥的配置恢复入口。"/><Space wrap className="spaced"><Button disabled={blocked||rotation.stage==='pending'} onClick={async()=>{const r=await action(()=>api('client-access/verify',{}));if(r)setResult(r);}}>验证新密钥连接</Button><Button disabled={blocked||!rotation.verified} type="primary" onClick={()=>confirm('完成更换并撤销旧密钥？','使用旧密钥的其他手动配置客户端将无法连接，请确认已更新。',()=>api('client-access/complete',{rotationId:rotation.id}))}>完成更换，撤销旧密钥</Button><Button disabled={blocked} onClick={()=>confirm('回滚本次密钥更换？','恢复备份配置，撤销新密钥，保留旧密钥。',()=>api('client-access/rollback',{rotationId:rotation.id}))}>回滚本次更换</Button></Space></>:<Button className="spaced" disabled={blocked} onClick={()=>confirm('开始更换本机连接密钥？','生成新密钥后旧密钥暂时保持有效，完成配置及验证后再撤销。',()=>api('client-access/begin',{}))}>开始更换密钥</Button>}
  <Paragraph className="spaced" type="secondary">连接验证检查本机鉴权和目录读取，不消耗模型用量；工具与长会话需要到调用验证页面执行。</Paragraph>
 </Card></>;
}
