import {SettingsPage} from "./features/settings/SettingsPage.jsx";
import {VerificationPage} from "./features/verification/VerificationPage.jsx";
import {hasUnsavedDrafts} from "./console-state.mjs";
import {ClientsPage} from "./features/clients/ClientsPage.jsx";
import {OverviewPage} from "./features/overview/OverviewPage.jsx";
import {LogsPage} from "./features/logs/LogsPage.jsx";
import {ModelsPage} from "./features/models/ModelsPage.jsx";
import { AccountsPanel, QuotaPanel } from "./account-panels.jsx";
import {
  RulesPanel,
  ConnectionGuide,
} from "./operation-panels.jsx";
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ConfigProvider,
  App as AntApp,
  Layout,
  Menu,
  Button,
  Space,
  Typography,
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  Table,
  Input,
  Select,
  Form,
  Alert,
  Progress,
  Empty,
  Descriptions,
  Drawer,
  Modal,
  Switch,
  InputNumber,
  Steps,
  Segmented,
  theme,
} from "antd";
import { DashboardOutlined, UserOutlined, PieChartOutlined, AppstoreOutlined, ApiOutlined, ExperimentOutlined, FileTextOutlined, SettingOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SunOutlined, MoonOutlined } from '@ant-design/icons';
import { Grid } from 'antd';
import { consoleTheme } from './console-theme.mjs';
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import "./style.css";
const { Title, Text, Paragraph } = Typography;
const pages = [
  ["overview", "概览", DashboardOutlined],
  ["accounts", "Codex 账号", UserOutlined],
  ["quota", "账号配额", PieChartOutlined],
  ["models", "模型目录", AppstoreOutlined],
  ["connection", "客户端接入", ApiOutlined],
  ["tests", "调用验证", ExperimentOutlined],
  ["logs", "请求日志", FileTextOutlined],
  ["settings", "设置与系统", SettingOutlined],
];
const kinds = {
  text: "文本对话",
  tools: "基础工具",
  files: "文件工具",
  mcp: "MCP 工具",
  long: "长会话",
};
const date = (value) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
const statusTag = (s) => (
  <Tag
    color={
      s === "passed"
        ? "success"
        : ["failed", "upstream_error", "cancelled_or_timeout"].includes(s)
          ? "error"
          : s === "forwarded"
            ? "processing"
            : "default"
    }
  >
    {{
      passed: "通过",
      failed: "失败",
      unverified: "未验证",
      forwarded: "已转发",
      upstream_error: "上游错误",
      cancelled: "已取消",
      cancelled_or_timeout: "取消 / 超时",
      rejected: "已拒绝",
    }[s] ||
      s ||
      "未验证"}
  </Tag>
);
async function api(path, data) {
  const r = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let result;
  try {
    result = await r.json();
  } catch {
    throw new Error("服务响应无法读取，请检查 ModelBridge 是否运行");
  }
  if (!r.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : result.error?.message || "操作失败",
    );
  return result;
}
function Console({dark, setDark}) {
  const [collapsed,setCollapsed]=useState(false),[navigationOpen,setNavigationOpen]=useState(false);
  const screens=Grid.useBreakpoint();
  const mobile=screens.md===false;
  const { message, modal } = AntApp.useApp();
  const [state, setState] = useState(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [page, setPage] = useState(location.hash.slice(1) || "overview");
  const [query, setQuery] = useState(""),
    [modelType, setModelType] = useState("all"),
    [logFilter, setLogFilter] = useState("all"),
    [details, setDetails] = useState(null),
    [loginUrl, setLoginUrl] = useState(""),
    [selected, setSelected] = useState(),
    [kind, setKind] = useState("tools"),
    [settings, setSettings] = useState(null),
    [pendingSettings, setPendingSettings] = useState(null);
  const [engineForm] = Form.useForm(),
    [settingsForm] = Form.useForm();
  const polling = useRef(false);
  async function refresh() {
    if (polling.current) return;
    polling.current = true;
    try {
      setState(await api("status"));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      polling.current = false;
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    const unload = e => {if(hasUnsavedDrafts()){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    const hash = () => {
      if(hasUnsavedDrafts())message.info('未保存草稿已保留；关闭或刷新页面前请保存或导出');
      setPage(
        pages.some((p) => p[0] === location.hash.slice(1))
          ? location.hash.slice(1)
          : "overview",
      );
    };
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("beforeunload",unload);
      clearInterval(timer);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("mb-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (state && !state.loginPending) setLoginUrl("");
    if (!selected && state?.models?.length)
      setSelected(state.models.find((m) => m.selectable)?.slug);
  }, [state]);
  async function action(fn, success) {
    setWorking(true);
    try {
      const result = await fn();
      if (success) message.success(success);
      return result;
    } catch (e) {
      message.error(e.message);
      return null;
    } finally {
      setWorking(false);
      await refresh();
    }
  }
  const ready = state?.engine.reachable,
    blocked = working || !!state?.busy || !!state?.gatewayActive;
  const models = state?.models || [],
    accounts = state?.accounts || [],
    reports = state?.reports || [],
    traffic = state?.traffic || [];
  async function login(accountKey, purpose = "inference") {
    const key=typeof accountKey==='string'?accountKey:undefined;
    const result = await action(() => purpose==='quota'?api("accounts/quota/login",{key}):api("login", { newAccount: !key, accountKey:key }));
    if (result) {
      setLoginUrl(result.url);
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  }
  async function verify(model, type) {
    const result = await action(() => api("verify", { model, kind: type }));
    if (result) {
      setDetails(result);
      if (result.status === "passed") message.success("验证通过");
      else message.warning("验证未通过，请查看详情");
    }
  }
  async function copy(what) {
    await action(async () => {
      const connection = await api("connection");
      await navigator.clipboard.writeText(connection[what]);
    }, "已复制");
  }
  async function readSettings() {
    const result = await action(() => api("settings/read", {}));
    if (result) {
      setSettings(result);
      settingsForm.setFieldsValue(result);
    }
  }
  const busy = state?.busy && <Alert type="info" showIcon title={`${kinds[state.busy.kind]}验证进行中 · ${state.busy.model}`} description={`当前进度：${state.busy.progress||0}；测试使用会员用量，请保持服务运行。`} action={<Button onClick={()=>action(()=>api('cancel',{}))}>取消验证</Button>}/>;
  const content = {
    overview: state ? <OverviewPage state={state}/> : null,
    accounts: state ? (
      <AccountsPanel {...{ state, api, action, blocked, login, loginUrl }} />
    ) : null,
    quota: state ? <QuotaPanel {...{ state, api, action, blocked }} /> : null,
    models: <ModelsPage {...{state,api,action,blocked,verify}}/>,
    connection: <ClientsPage {...{state,api,action,blocked,copy}}/>,
    tests: <VerificationPage {...{state,api,action,blocked,verify}}/>,
    logs: state ? (
      <LogsPage {...{state,api,action}}/>
    ) : null,
    settings: <SettingsPage {...{ api, action, blocked }} />,
  };
  if (state) {
    content.overview = <OverviewPage state={state}/>;
    content.logs = <LogsPage {...{state,api,action}}/>;
    content.models = (
      <>
        {content.models}
        <RulesPanel {...{ api, action, blocked }} />
      </>
    );
    content.connection = (
      <>
        {content.connection}
        <ConnectionGuide models={models} />
      </>
    );
  }
  const nav = (compact=false) => <Menu mode="inline" inlineCollapsed={compact} selectedKeys={[page]}
    onClick={({key})=>{location.hash=key;setQuery('');setNavigationOpen(false);}}
    items={pages.map(([key,label,Icon])=>({key,label,icon:<Icon/>}))}/>;
  const brand = <a className="brand" href="#overview" onClick={()=>setNavigationOpen(false)} aria-label="ModelBridge 概览"><span className="brand-icon"><ApiOutlined/></span><span className="brand-text">ModelBridge<small>Codex 控制台</small></span></a>;
  const status = <div className="sidebar-footer"><div><span className={`status-dot ${ready?'online':''}`}/><span className="brand-text">{ready?'会员通道已连接':'等待账号授权'}</span></div><small className="brand-text">独立运行 · 本机管理</small></div>;
  const description = {overview:'查看请求活动、账号状态和运行情况。',accounts:'管理登录授权、账号状态与使用顺序。',quota:'查看剩余额度、重置时间与订阅状态。',models:'浏览账号可用模型，核对能力与验证结果。',connection:'配置 WorkBuddy 和其他兼容客户端。',tests:'验证文本、工具调用与长会话的实际表现。',logs:'追踪请求结果，查看错误与兼容处理记录。',settings:'管理运行设置、兼容规则与本机系统信息。'};
  return (
    <>
      <Layout className="app-layout">
        {!mobile && <Layout.Sider width={216} collapsedWidth={68} collapsed={collapsed} className="sidebar">{brand}{nav(collapsed)}{status}</Layout.Sider>}
        <Layout className="main-layout">
          <Layout.Header className="topbar">
            <Space size={12}>
              <Button type="text" className="navigation-toggle" aria-label={mobile?'打开导航':collapsed?'展开导航':'收起导航'} icon={collapsed||mobile?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>mobile?setNavigationOpen(true):setCollapsed(!collapsed)}/>
              <span className="breadcrumb"><span className="breadcrumb-root">ModelBridge <span className="slash">/</span></span>{pages.find(p=>p[0]===page)?.[1]}</span>
            </Space>
            <Space size={12}><Tag className="channel-tag">Codex OAuth</Tag><Button type="text" aria-label="切换主题" icon={dark?<SunOutlined/>:<MoonOutlined/>} onClick={()=>setDark(!dark)}/></Space>
          </Layout.Header>
          <Layout.Content className="content">
            <div className="page-heading">
              <div>
                <Title level={2}>{pages.find((p) => p[0] === page)?.[1]}</Title>
                <Text type="secondary">{description[page] || description.overview}</Text>
              </div>
              <Text type="secondary" className="local-label">
                本机运行 · {state?.engine.version || "—"}
              </Text>
            </div>
            {(error || state?.lastError?.message) && (
              <Alert
                showIcon
                type="error"
                title={`${error ? '管理连接异常' : '最近一次请求失败'}：${error || state.lastError.message}`}
                action={!error && page !== 'logs' ? <Button size="small" onClick={()=>location.hash='logs'}>查看日志</Button> : undefined}
              />
            )}{" "}
            {!state ? (
              <Card loading />
            ) : (
              <>
                {!ready && page !== "settings" && (
                  <Alert
                    showIcon
                    type="warning"
                    title="请先授权或选择可用账号"
                    action={
                      <Button onClick={() => (location.hash = "accounts")}>
                        管理账号
                      </Button>
                    }
                  />
                )}{" "}
                {busy}
                {content[page] || content.overview}
              </>
            )}
          </Layout.Content>
          <Layout.Footer className="footer">
            ModelBridge · Codex OAuth 管理与验证
          </Layout.Footer>
        </Layout>
      </Layout>
      <Drawer title="导航" placement="left" open={mobile && navigationOpen} onClose={()=>setNavigationOpen(false)} size={280} className="navigation-drawer">{brand}{nav()}{status}</Drawer>
      <Drawer
        title="记录详情"
        open={!!details}
        onClose={() => setDetails(null)}
        size="large"
      >
        {details && (
          <>
            <Descriptions
              column={1}
              bordered
              items={[
                {
                  key: "model",
                  label: "模型",
                  children: details.model || "模型目录",
                },
                {
                  key: "kind",
                  label: "项目",
                  children: kinds[details.kind] || "客户端请求",
                },
                {
                  key: "status",
                  label: "结果",
                  children: statusTag(details.status),
                },
                {
                  key: "start",
                  label: "开始时间",
                  children: date(details.startedAt),
                },
                {
                  key: "finish",
                  label: "完成时间",
                  children: date(details.finishedAt),
                },
                ...(details.requests !== undefined
                  ? [
                      {
                        key: "requests",
                        label: "模型请求次数",
                        children: details.requests,
                      },
                    ]
                  : []),
                ...(details.toolCalls !== undefined
                  ? [
                      {
                        key: "tools",
                        label: "实际工具调用",
                        children: details.toolCalls,
                      },
                    ]
                  : []),
                ...(details.httpStatus
                  ? [
                      {
                        key: "http",
                        label: "HTTP 状态",
                        children: details.httpStatus,
                      },
                    ]
                  : []),
                ...(details.maxMessages
                  ? [
                      {
                        key: "messages",
                        label: "最长历史消息数",
                        children: details.maxMessages,
                      },
                    ]
                  : []),
                ...(details.maxRequestBytes
                  ? [
                      {
                        key: "size",
                        label: "最大请求大小",
                        children:
                          (details.maxRequestBytes / 1024).toFixed(1) + " KiB",
                      },
                    ]
                  : []),
              ]}
            />
            {(details.error || details.errorCode) && (
              <Alert
                className="spaced"
                type="error"
                showIcon
                title={details.error?.message || "请求传输失败"}
                description={
                  "错误标识：" + (details.error?.code || details.errorCode)
                }
              />
            )}
            {details.status === "forwarded" && (
              <Paragraph className="spaced" type="secondary">
                请求已完成转发。任务是否达到预期，请查看客户端回答或进行调用验证。
              </Paragraph>
            )}
          </>
        )}
      </Drawer>
      <Modal
        title="确认设置改动"
        open={!!pendingSettings}
        onCancel={() => setPendingSettings(null)}
        confirmLoading={working}
        okText="保存改动"
        cancelText="取消"
        onOk={async () => {
          const result = await action(
            () => api("settings/save", pendingSettings),
            "设置已保存",
          );
          if (result) {
            setSettings(result);
            setPendingSettings(null);
          } else await readSettings();
        }}
      >
        <Descriptions
          column={1}
          items={
            pendingSettings
              ? Object.keys(pendingSettings).map((key) => ({
                  key,
                  label: {
                    timeoutSeconds: "请求超时",
                    requestRetry: "重试次数",
                    routingStrategy: "账号选择方式",
                    loggingToFile: "日志写入",
                  }[key],
                  children: `${String(settings?.[key])} → ${String(pendingSettings[key])}`,
                }))
              : []
          }
        />
      </Modal>
    </>
  );
}
function ThemedConsole() {
  const [dark,setDark]=useState(localStorage.getItem('mb-theme')==='dark');
  return <ConfigProvider locale={zhCN} theme={consoleTheme(dark,theme)}><AntApp><Console dark={dark} setDark={setDark}/></AntApp></ConfigProvider>;
}
createRoot(document.getElementById("root")).render(<ThemedConsole/>);
