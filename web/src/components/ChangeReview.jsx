import React from 'react';
import {Modal,Descriptions} from 'antd';
export function ChangeReview({changes,revision,onConfirm,onCancel,busy}){return <Modal title="确认配置改动" open={!!changes} onCancel={onCancel} onOk={()=>onConfirm(revision)} confirmLoading={busy} okText="保存改动" cancelText="继续编辑" width={760}><Descriptions column={1} items={(changes||[]).map(c=>({key:c.key,label:c.key,children:<pre className="config-preview">{JSON.stringify(c.before)} → {JSON.stringify(c.after)}</pre>}))}/></Modal>;}
