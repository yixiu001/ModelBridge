import { MoreOutlined } from '@ant-design/icons';
import {OperationEpoch} from "../../console-state.mjs";
import {BatchResults} from "../../components/BatchResults.jsx";
import React, { useState, useEffect, useRef } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Typography,
} from "antd";
import { date, count, accountState, remaining } from "../../console-utils.mjs";
const { Text, Paragraph } = Typography;
export function AccountsPage({
  state,
  api,
  action,
  blocked,
  login,
  loginUrl,
}) {
  const { modal } = App.useApp();
  const accounts = state.accounts;
  const healthLabel=s=>({missing:'未授权',ready:'授权已保存',expired:'已过期，可刷新',refresh_failed:'刷新失败，可重试',sign_in_required:'需重新登录'}[s]||'未知');
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState([]),
    [detail, setDetail] = useState(null),
    [models, setModels] = useState(null),
    [edit, setEdit] = useState(null),
    [batch, setBatch] = useState(null),
    [callback, setCallback] = useState("");
  const modelEpoch=useRef(new OperationEpoch());
  useEffect(()=>()=>modelEpoch.current.invalidate(),[]);
  const batchControl=useRef({running:false,cancel:false});
  useEffect(()=>()=>{batchControl.current.cancel=true;},[]);
  const [form] = Form.useForm();
  useEffect(() => {
    setSelected((prev) =>
      prev.filter((k) => accounts.some((a) => a.key === k)),
    );
  }, [accounts.map((a) => a.key).join(",")]);
  useEffect(()=>{setDetail(old=>old?accounts.find(a=>a.key===old.key)||null:null);},[accounts]);
  useEffect(() => {
    if (!state.loginPending) setCallback("");
  }, [state.loginPending]);
  const locked = batchControl.current.running || blocked || state.loginPending || !!state.gatewayActive;
  const rows = accounts.filter(
    (a) =>
      (filter === "all" || accountState(a) === filter) &&
      [a.label, a.note, a.statusMessage]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function batchAction(keys,type) {
    if(batchControl.current.running)return;
    batchControl.current={running:true,cancel:false};
    const items=keys.map(key=>({key,label:accounts.find(a=>a.key===key)?.note||accounts.find(a=>a.key===key)?.label||key,state:'queued'}));
    const publish=()=>setBatch({type,items:items.map(i=>({...i}))});publish();
    try{for(const item of items){if(batchControl.current.cancel){item.state='cancelled';publish();continue;}item.state='running';publish();
      const r=await action(()=>api('accounts/batch',{keys:[item.key],action:type}));const result=r?.results?.[0];item.state=result?.ok?'succeeded':'failed';item.message=result?.error?.message||result?.message||(!r?'操作未完成':'');publish();
    }}finally{batchControl.current.running=false;publish();}
  }
  const confirmBatch = (keys, type) =>
    modal.confirm({
      title: `${{ enable: "启用", disable: "停用", refresh: "刷新授权" }[type]} ${keys.length} 个账号？`,
      content:
        type === "refresh"
          ? "由 ModelBridge 更新登录凭证，不会展示或导出令牌。"
          : "只操作已勾选的账号，正在执行请求时不能变更。",
      okText: "确认执行",
      cancelText: "取消",
      onOk: () => batchAction(keys, type),
    });
  return (
    <>
      <Collapse className="account-guide" defaultActiveKey={accounts.length?[]:["guide"]} items={[{key:"guide",label:"账号接入指南",children:<>
        <Steps size="small" current={accounts.length ? (accounts.some(a=>a.health?.quota.state!=='missing')?2:1):0} items={[{title:'模型调用授权'},{title:'配额授权（可稍后）'},{title:'目录与验证'},{title:'接入客户端'}]}/>
        <Paragraph className="spaced">模型调用和配额读取分别授权；跳过配额授权不影响已完成的模型授权。</Paragraph>
        <Space wrap><Button onClick={()=>location.hash='models'}>查看模型目录</Button><Button onClick={()=>location.hash='tests'}>调用验证</Button><Button onClick={()=>location.hash='connection'}>客户端接入</Button></Space>
      </>}]} />
      <Row gutter={[16, 16]}>
        {[
          ["全部账号", accounts.length],
          ["可用", accounts.filter((a) => accountState(a) === "active").length],
          [
            "需要检查",
            accounts.filter((a) => accountState(a) === "problem").length,
          ],
        ].map(([title, value]) => (
          <Col xs={8} key={title}>
            <Card className="metric-card">
              <Statistic title={title} value={value} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card
        title="Codex OAuth 账号"
        extra={
          <Space wrap>
            <Button
              disabled={blocked}
              onClick={() => action(() => api("models/refresh", {}))}
            >
              刷新列表
            </Button>
            <Button type="primary" disabled={locked} onClick={login}>
              添加 Codex 账号
            </Button>
          </Space>
        }
      >
        <div className="toolbar">
          <Input.Search
            aria-label="搜索账号"
            placeholder="搜索账号备注、标识或错误"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "全部" },
              { value: "active", label: "可用" },
              { value: "disabled", label: "停用" },
              { value: "problem", label: "问题" },
            ]}
          />
        </div>
        {selected.length>0 && <Space wrap className="selection-toolbar">
          <Text>已选 {selected.length} 个</Text>
          {["enable", "disable", "refresh"].map((type) => (
            <Button
              key={type}
              disabled={!selected.length || locked}
              onClick={() => confirmBatch(selected, type)}
            >
              {
                {
                  enable: "批量启用",
                  disable: "批量停用",
                  refresh: "刷新凭证",
                }[type]
              }
            </Button>
          ))}
          <Button disabled={!selected.length} onClick={() => setSelected([])}>
            取消选择
          </Button>
        </Space>}
        <Table
          className="spaced"
          rowKey="key"
          dataSource={[...rows].sort((a, b) => b.priority - a.priority)}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            getCheckboxProps: (account) => ({ disabled: locked, 'aria-label': `选择 ${account.note || account.label}` }),
          }}
          scroll={{ x: 760 }}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            showTotal: (n) => `共 ${n} 个账号`,
          }}
          columns={[
            {
              title: "账号 / 备注",
              render: (_, a) => (
                <>
                  <Button type="link" onClick={() => setDetail(a)}>
                    {a.note || a.label}
                  </Button>
                  {a.note && <div><Text type="secondary">{a.label}</Text></div>}
                </>
              ),
              sorter: (a, b) =>
                (a.note || a.label).localeCompare(b.note || b.label),
            },
            {
              title: "状态",
              render: (_, a) => (
                <Tag
                  color={
                    accountState(a) === "active"
                      ? "success"
                      : accountState(a) === "problem"
                        ? "error"
                        : "default"
                  }
                >
                  {accountState(a)==="problem" ? "需要检查" : a.active
                    ? "当前使用"
                    : {
                        active: "可用",
                        disabled: "已停用",
                        problem: "需要检查",
                      }[accountState(a)]}
                </Tag>
              ),
            },
            {
              title: "请求成功 / 失败",
              render: (_, a) =>
                `${count(a.successCount)} / ${count(a.failureCount)}`,
            },
            {
              title: "列表排序",
              responsive: ["xl"],
              dataIndex: "priority",
              sorter: (a, b) => a.priority - b.priority,
            },
            { title: "最近刷新", responsive: ["lg"], dataIndex: "lastRefresh", render: date },
            {
              title: "操作", width: 142, fixed: 'right',
              render: (_, a) => <Space size={4}>
                <Button type="text" size="small" disabled={locked} onClick={()=>{setEdit(a);form.setFieldsValue({note:a.note||'',priority:a.priority});}}>编辑</Button>
                <Dropdown trigger={['click']} menu={{items:[
                  {key:'use',label:'使用此账号',disabled:locked||a.disabled||a.active,onClick:()=>action(()=>api('account',{key:a.key}),'已切换账号')},
                  {key:'models',label:'查看模型',onClick:()=>action(async()=>{const ticket=modelEpoch.current.begin(a.key);setModels({account:a,loading:true});const r=await api('accounts/models',{key:a.key});if(modelEpoch.current.current(ticket,a.key))setModels({account:a,...r});})},
                  {type:'divider'},
                  {key:'toggle',label:a.disabled?'启用账号':'停用账号',disabled:locked,onClick:()=>confirmBatch([a.key],a.disabled?'enable':'disable')},
                  {key:'refresh',label:'刷新凭证',disabled:locked,onClick:()=>batchAction([a.key],'refresh')},
                  {key:'login',label:'重新授权',disabled:locked,onClick:()=>login(a.key)},
                  {key:'quota',label:'授权读取配额',disabled:locked,onClick:()=>login(a.key,'quota')},
                  {type:'divider'},
                  {key:'remove',label:'移除账号',danger:true,disabled:locked,onClick:()=>modal.confirm({title:'移除这个账号？',content:'删除引擎中保存的该账号授权，需要重新登录才能恢复。',okText:'移除账号',cancelText:'取消',onOk:()=>action(()=>api('accounts/action',{key:a.key,action:'remove'}),'账号已移除')})},
                ]}}><Button type="text" size="small" icon={<MoreOutlined/>}>更多</Button></Dropdown>
              </Space>,
            },
          ]}
        />
        <Text type="secondary">
          请求计数来自本机最近 100 条记录。重新授权时请在官方页面选择对应账号。
        </Text>
      </Card>
      <Drawer
        title="账号详情"
        open={!!detail}
        onClose={() => setDetail(null)}
        size="large"
      >
        {detail && (
          <Descriptions
            column={1}
            items={Object.entries({
              账号: detail.label,
              备注: detail.note || "—",
              列表排序: detail.priority,
              状态: detail.status,
              调用授权: healthLabel(detail.health?.inference.state),
              配额授权: healthLabel(detail.health?.quota.state),
              调用授权到期: date(detail.health?.inference.expiresAt),
              配额授权到期: date(detail.health?.quota.expiresAt),
              最近调用成功: date(detail.health?.inference.lastVerifiedAt),
              自动续期已验证: detail.health?.inference.renewalVerified ? '是' : '尚未验证', 
              错误说明: detail.statusMessage || "无",
              更新时间: date(detail.updatedAt),
              凭证刷新时间: date(detail.lastRefresh),
              下次重试: date(detail.nextRetryAt),
              成功请求: count(detail.successCount),
              失败请求: count(detail.failureCount),
            }).map(([label, children]) => ({ key: label, label, children }))}
          />
        )}
      </Drawer>
      <Drawer
        title={`${models?.account.note || models?.account.label || ""} · 支持的模型`}
        open={!!models}
        onClose={() => {modelEpoch.current.invalidate();setModels(null);}}
        size="large"
      >
        <Table
          rowKey="id"
          loading={models?.loading}
          dataSource={models?.models || []}
          columns={[
            {
              title: "模型 ID",
              dataIndex: "id",
              render: (v) => <Text copyable>{v}</Text>,
            },
            { title: "显示名称", dataIndex: "displayName" },
          ]}
        />
      </Drawer>
      <Modal
        title="编辑账号"
        open={!!edit}
        onCancel={() => setEdit(null)}
        okText="保存"
        cancelText="取消"
        confirmLoading={blocked}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (fields) => {
            const r = await action(
              () => api("accounts/update", { key: edit.key, fields }),
              "账号已更新",
            );
            if (r) setEdit(null);
          }}
        >
          <Form.Item label="备注" name="note">
            <Input maxLength={200} showCount />
          </Form.Item>
          <Form.Item
            label="列表排序"
            name="priority"
            rules={[{ required: true }]}
          >
            <InputNumber min={-1000} max={1000} />
          </Form.Item>
          <Paragraph type="secondary">
            数值越高在列表中越靠前；实际调用使用你选中的账号。
          </Paragraph>
        </Form>
      </Modal>
      <Modal title="批量操作结果" open={!!batch} onCancel={()=>{if(!batchControl.current.running)setBatch(null);}} footer={<Button disabled={batchControl.current.running} onClick={()=>setBatch(null)}>完成</Button>}>
        <BatchResults items={batch?.items||[]} onCancel={batchControl.current.running?()=>{batchControl.current.cancel=true;}:undefined} onRetryFailed={!batchControl.current.running?()=>batchAction(batch.items.filter(i=>i.state==='failed').map(i=>i.key),batch.type):undefined}/>
      </Modal>
      <Modal
        title={state.quotaLoginPending?"同一账号 · 配额授权":"Codex OAuth 模型调用授权"}
        open={state.loginPending}
        closable={false}
        footer={
          <Button
            disabled={blocked}
            onClick={() =>
              action(() => api("login/cancel", {}), "本次授权已取消")
            }
          >
            取消本次授权
          </Button>
        }
      >
        <Paragraph>
          在 OpenAI 官方页面完成登录。定向恢复时请使用原账号；两项授权分别保存，取消不会删除已经完成的授权。
        </Paragraph>
        <Space wrap>
          <Button
            type="primary"
            href={loginUrl || undefined}
            disabled={!loginUrl}
            target="_blank"
            rel="noreferrer"
          >
            打开授权页
          </Button>
          <Button
            disabled={!loginUrl}
            onClick={() =>
              action(
                () => navigator.clipboard.writeText(loginUrl),
                "授权链接已复制",
              )
            }
          >
            复制授权链接
          </Button>
        </Space>
        <Paragraph className="spaced" type="secondary">
          本次等待截止：{date(state.loginExpiresAt)}
        </Paragraph>
        <Alert
          type="info"
          title="没有自动返回时"
          description="完成官方登录后，可以将浏览器中的 localhost 回调地址粘贴到下方。只接受当前这次授权的回调。"
        />
        <Input.Password
          className="spaced"
          aria-label="OAuth 回调地址"
          placeholder="http://127.0.0.1:43821/auth/callback?..."
          value={callback}
          onChange={(e) => setCallback(e.target.value)}
          autoComplete="off"
        />
        <Button
          className="spaced"
          disabled={!callback || blocked}
          onClick={async () => {
            const r = await action(
              () => api("login/callback", { url: callback }),
              "已提交，等待引擎确认",
            );
            if (r) setCallback("");
          }}
        >
          提交回调
        </Button>
      </Modal>
    </>
  );
}


