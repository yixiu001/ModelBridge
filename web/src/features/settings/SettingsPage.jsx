import React,{useState,useEffect,useRef} from 'react';
import {App,Alert,Button,Card,Descriptions,Form,Input,InputNumber,Space,Switch,Tabs,Typography} from 'antd';
import {createDraft,editDraft,receiveSnapshot,draftCache,OperationEpoch} from '../../console-state.mjs';
import {ChangeReview} from '../../components/ChangeReview.jsx';
import {PageStatus} from '../../components/PageStatus.jsx';
import {download,date} from '../../console-utils.mjs';
const {Paragraph,Text}=Typography;
export function SettingsPage({api,action,blocked}){
 const {modal,message}=App.useApp(),[draft,setDraft]=useState(()=>draftCache.get('settings')||null),[error,setError]=useState(''),[pending,setPending]=useState(null),[system,setSystem]=useState(null),[release,setRelease]=useState(null),[source,setSource]=useState(()=>draftCache.get('settings')?.sourceText||''),[mode,setMode]=useState('form');
 const [form]=Form.useForm(),epochs=useRef(new OperationEpoch()),importInput=useRef(null);
 const adopt=d=>{draftCache.set('settings',d);setDraft(d);form.setFieldsValue(d.values);setSource(d.sourceText??JSON.stringify(d.values,null,2));};
 async function read(discard=false){const ticket=epochs.current.begin('settings');try{const value=await api('settings/document',{});if(epochs.current.current(ticket,'settings')){adopt(receiveSnapshot(draftCache.get('settings'),value,{discard}));setError('');}}catch(e){if(epochs.current.current(ticket,'settings'))setError(e.message);}}
 useEffect(()=>{read();api('system/read',{}).then(setSystem).catch(()=>{});return()=>epochs.current.invalidate();},[]);
 const preview=async()=>{if(draft?.sourceInvalid){setError('JSON格式无效，请先修正');return;}const r=await action(()=>api('settings/preview',{values:draft.values}));if(!r)return;if(r.errors.length){setError(r.errors.join('；'));return;}if(!r.changes.length){setError('没有待保存的改动');return;}setPending({changes:r.changes,revision:draft.revision,values:structuredClone(draft.values)});};
 const save=async revision=>{const ticket=epochs.current.begin('settings');const r=await action(()=>api('settings/save',{revision,values:pending.values}));setPending(null);if(!epochs.current.current(ticket,'settings'))return;if(r){await read(true);}else{setError('保存未完成，草稿已保留；请读取当前配置比较。');await read();}};
 const importFile=async file=>{if(!file)return;try{if(file.size>262144)throw new Error('配置文件超过256KiB');const document=JSON.parse(await file.text());if(document.schemaVersion!==1||!document.values||Object.keys(document).some(k=>!['schemaVersion','values'].includes(k)))throw new Error('请选择ModelBridge导出的配置备份');adopt(editDraft(draft,document.values));setError('');message.success('备份已载入草稿，请查看差异后保存');}catch(e){setError(e.message);}};
 return <><Card title="运行配置" extra={<Space wrap><Button disabled={blocked} onClick={()=>read()}>读取当前配置</Button><Button disabled={!draft?.dirty||blocked} onClick={()=>modal.confirm({title:'放弃当前未保存草稿？',okText:'放弃并重载',cancelText:'继续编辑',onOk:()=>read(true)})}>放弃草稿</Button></Space>}>
 <PageStatus state={!draft?'loading':error?'partial':'ready'} error={error} onRetry={()=>read()}/>
 {draft?.conflict&&<Alert className="spaced" type="warning" title="服务器配置已变化，当前草稿仍保留" description="可放弃草稿重载，或导出草稿后重新比较；不能直接覆盖其他窗口的新配置。" action={<Button onClick={()=>{adopt({...draft,revision:draft.remote.revision,baseValues:draft.remote.values,conflict:false});setError('已采用最新版本作为比较基准，请检查差异再保存');}}>保留草稿，重新比较</Button>}/>}
 {draft&&<><Tabs activeKey={mode} onChange={setMode} items={[{key:'form',label:'可视化配置',children:<Form className="settings-form" form={form} layout="vertical" onValuesChange={(_,values)=>adopt(editDraft(draft,{...draft.values,...values}))}>
 <section className="settings-section"><div className="settings-section-heading"><Text strong>请求与连接</Text><Paragraph type="secondary">控制等待时间和流式连接心跳。</Paragraph></div><div className="settings-fields">
 <Form.Item label="单次请求超时（秒）" name="timeoutSeconds" extra="允许 30–600 秒"><InputNumber min={30} max={600}/></Form.Item>
 <Form.Item label="SSE 心跳间隔（秒）" name="heartbeatSeconds" extra="0 为关闭，启用时至少 5 秒"><InputNumber min={0} max={60}/></Form.Item>
 </div></section>
 <section className="settings-section"><div className="settings-section-heading"><Text strong>请求记录</Text><Paragraph type="secondary">仅保存脱敏摘要；三个保留限制以先到者为准。</Paragraph></div><div className="settings-fields">
 <Form.Item className="settings-toggle" label="保存脱敏请求摘要" name="loggingToFile" valuePropName="checked"><Switch/></Form.Item>
 {[['logRetentionDays','保留天数',1,90],['logMaxMiB','容量上限（MiB）',1,500],['logMaxRecords','记录条数上限',100,500000]].map(([name,label,min,max])=><Form.Item key={name} name={name} label={label}><InputNumber min={min} max={max}/></Form.Item>)}
 </div></section>
 <Paragraph type="secondary">固定使用选中账号，不自动重试。模型禁用和别名规则请在模型目录编辑。</Paragraph>
 </Form>},{key:'json',label:'受限JSON配置',children:<Input.TextArea aria-label="配置JSON" rows={16} value={source} onChange={e=>{const text=e.target.value;setSource(text);try{const values=JSON.parse(text);const d={...editDraft(draft,values),sourceText:text,sourceInvalid:false};draftCache.set('settings',d);setDraft(d);form.setFieldsValue(values);}catch{const d={...draft,dirty:true,sourceText:text,sourceInvalid:true};draftCache.set('settings',d);setDraft(d);}}}/>}]} />
 <Space wrap className="settings-actions"><Button type="primary" disabled={blocked||!draft.dirty} onClick={preview}>查看改动并保存</Button><Button onClick={()=>download('modelbridge-settings-draft.json',{schemaVersion:1,values:draft.values})}>导出草稿</Button><Button onClick={()=>action(async()=>download('modelbridge-settings.json',await api('settings/export',{})))}>导出当前配置</Button><Button disabled={blocked} onClick={()=>importInput.current?.click()}>载入配置备份</Button><input ref={importInput} type="file" accept=".json,application/json" hidden disabled={blocked} onChange={e=>{importFile(e.target.files?.[0]);e.target.value='';}}/></Space>
 <Paragraph className="spaced" type="secondary">备份不含授权凭据和连接密钥；载入备份只修改草稿，保存前会显示差异。</Paragraph></>}
 </Card><ChangeReview changes={pending?.changes} revision={pending?.revision} onConfirm={save} onCancel={()=>setPending(null)} busy={blocked}/>
 <Card title="设置与系统" extra={<Button disabled={blocked} onClick={async()=>{const r=await action(()=>api('system/latest',{}));if(r)setRelease(r);}}>手动检查更新</Button>}><Descriptions column={1} items={Object.entries({版本:system?.version,构建提交:system?.commit,Node版本:system?.nodeVersion,启动时间:date(system?.startedAt),监听范围:system?.listener,网络模式:system?.networkMode,支持:system?.supported?.join('、'),当前不支持:system?.unsupported?.join('、')}).map(([label,value])=>({key:label,label,children:value||'—'}))}/>{release&&<Alert className="spaced" type="info" title={release.message||`最新发布：${release.version}`} description={release.url?<a href={release.url} target="_blank" rel="noreferrer">查看本项目发布说明</a>:null}/>}<Paragraph className="spaced" type="secondary">独立运行，不连接CLIProxyAPI服务。更新检查不会自动下载或安装。</Paragraph></Card></>;
}
