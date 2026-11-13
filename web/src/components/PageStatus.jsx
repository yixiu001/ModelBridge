import React from 'react';
import {Alert,Button,Empty,Skeleton} from 'antd';
export function PageStatus({state,error,onRetry}){if(state==='loading')return <Skeleton active/>;if(state==='empty')return <Empty description="暂无数据"/>;if(['partial','stale','failed'].includes(state))return <Alert className="spaced" type={state==='failed'?'error':'warning'} title={error||{partial:'部分操作未成功',stale:'显示过期数据',failed:'操作失败'}[state]} action={onRetry&&<Button onClick={onRetry}>重试</Button>}/>;return null;}
