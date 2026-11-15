import React from 'react';
import {Modal,Descriptions} from 'antd';
const labels = {timeoutSeconds:'单次请求超时（秒）',loggingToFile:'保存脱敏请求摘要',logRetentionDays:'保留天数',logMaxMiB:'容量上限（MiB）',logMaxRecords:'记录条数上限',heartbeatSeconds:'SSE 心跳间隔（秒）',excluded:'禁用模型',aliases:'模型别名'};
const display = value => typeof value === 'boolean' ? value ? '开启' : '关闭' : JSON.stringify(value);
export function ChangeReview({changes,revision,onConfirm,onCancel,busy}){return <Modal title="确认配置改动" open={!!changes} onCancel={onCancel} onOk={()=>onConfirm(revision)} confirmLoading={busy} okText="保存改动" cancelText="继续编辑" width={760}><Descriptions column={1} items={(changes||[]).map(c=>({key:c.key,label:labels[c.key]||c.key,children:<pre className="config-preview">{display(c.before)} → {display(c.after)}</pre>}))}/></Modal>;}
