import { AccountsPanel, QuotaPanel } from "./account-panels.jsx";
import {
  OverviewMetrics,
  RulesPanel,
  SettingsPanel,
  LogsPanel,
  ReportsPanel,
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
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import "./style.css";
const { Title, Text, Paragraph } = Typography;
const pages = [
  ["overview", "概览", "◈"],
  ["accounts", "Codex 账号", "◎"],
  ["quota", "账号配额", "◷"],
  ["models", "模型目录", "▦"],
  ["connection", "客户端接入", "⇄"],
  ["tests", "调用验证", "✓"],
  ["logs", "请求日志", "≡"],
  ["settings", "设置与系统", "⚙"],
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
function Console() {
  const { message, modal } = AntApp.useApp();
  const [state, setState] = useState(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [page, setPage] = useState(location.hash.slice(1) || "overview"),
    [dark, setDark] = useState(localStorage.getItem("mb-theme") === "dark");
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
    const hash = () =>
      setPage(
        pages.some((p) => p[0] === location.hash.slice(1))
          ? location.hash.slice(1)
          : "overview",
      );
    window.addEventListener("hashchange", hash);
    return () => {
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
  async function login() {
    const result = await action(() => api("login", { newAccount: true }));
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
  const testsColumns = [
    { title: "模型", dataIndex: "model", ellipsis: true },
    { title: "验证项目", dataIndex: "kind", render: (v) => kinds[v] || v },
    { title: "结果", dataIndex: "status", render: statusTag },
    { title: "完成时间", dataIndex: "finishedAt", render: date },
    {
      title: "",
      render: (_, r) => (
        <Button type="link" onClick={() => setDetails(r)}>
          详情
        </Button>
      ),
    },
  ];
  const logsColumns = [
    { title: "时间", dataIndex: "startedAt", render: date, width: 190 },
    {
      title: "模型",
      dataIndex: "model",
      render: (v) => v || "模型目录",
      ellipsis: true,
    },
    { title: "HTTP", dataIndex: "httpStatus", width: 75 },
    { title: "状态", dataIndex: "status", render: statusTag, width: 130 },
    {
      title: "",
      render: (_, r) => (
        <Button type="link" onClick={() => setDetails(r)}>
          查看
        </Button>
      ),
      width: 70,
    },
  ];
  const filteredLogs = [...traffic]
    .reverse()
    .filter(
      (r) =>
        (logFilter === "all" || r.status !== "forwarded") &&
        (!query ||
          JSON.stringify([r.model, r.httpStatus, r.errorCode])
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
  const busy = state?.busy && (
    <Alert
      type="info"
      showIcon
      title={`${kinds[state.busy.kind]}验证进行中 · ${state.busy.model}`}
      description="测试会消耗少量会员用量。长会话验证包含 12 轮连续工具调用，请保持服务运行。"
      action={
        <Button onClick={() => action(() => api("cancel", {}))}>
          取消验证
        </Button>
      }
    />
  );
  const content = {
    overview: (
      <>
        <section className="hero">
          <div>
            <span className="eyebrow">YOUR CODEX WORKSPACE</span>
            <Title level={2}>一个入口，连接你的模型。</Title>
            <Paragraph>
              管理 Codex 账号、查看配额，让模型在 WorkBuddy 中稳定工作。
            </Paragraph>
            <Space>
              <Button
                type="primary"
                size="large"
                onClick={() => (location.hash = "connection")}
              >
                接入 WorkBuddy
              </Button>
              <Button size="large" onClick={() => (location.hash = "accounts")}>
                管理账号
              </Button>
            </Space>
          </div>
          <div className="hero-mark" aria-hidden="true">
            M<span>↗</span>
          </div>
        </section>
        <Row gutter={[16, 16]}>
          {[
            ["引擎状态", ready ? "已连接" : "未连接"],
            ["Codex 账号", accounts.length],
            ["可用模型", models.length],
            [
              "工具验证通过",
              models.filter((m) => m.checks.tools.status === "passed").length,
            ],
          ].map(([label, value]) => (
            <Col xs={12} lg={6} key={label}>
              <Card>
                <Statistic title={label} value={value} />
              </Card>
            </Col>
          ))}
        </Row>
        <Row gutter={[20, 20]}>
          <Col xs={24} lg={15}>
            <Card
              title="接入流程"
              extra={
                <Button
                  type="link"
                  onClick={() => (location.hash = "connection")}
                >
                  查看接入信息
                </Button>
              }
            >
              <Steps
                direction="vertical"
                current={!ready ? 0 : !accounts.length ? 1 : 2}
                items={[
                  {
                    title: "启动 ModelBridge",
                    description: "本机独立运行，无需安装其他代理服务",
                  },
                  {
                    title: "登录 Codex 账号",
                    description: "通过 OpenAI 官方页面完成 OAuth 授权",
                  },
                  {
                    title: "验证模型并接入客户端",
                    description: "验证工具调用，保存 WorkBuddy 连接配置",
                  },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} lg={9}>
            <Card title="服务信息">
              <Descriptions
                column={1}
                items={[
                  { key: "v", label: "ModelBridge", children: "0.3.1" },
                  {
                    key: "e",
                    label: "请求处理",
                    children: "ModelBridge 独立实现",
                  },
                  {
                    key: "t",
                    label: "目录更新",
                    children: date(state?.catalogAt),
                  },
                  {
                    key: "a",
                    label: "进行中的请求",
                    children: state?.gatewayActive || 0,
                  },
                ]}
              />
              <Paragraph type="secondary">
                会员授权、模型请求和工具兼容均由本项目直接处理。
              </Paragraph>
            </Card>
          </Col>
        </Row>
        <Card title="最近请求">
          <Table
            size="small"
            rowKey="id"
            columns={logsColumns}
            dataSource={[...traffic].reverse().slice(0, 5)}
            pagination={false}
            locale={{
              emptyText: (
                <Empty description="暂无请求，接入客户端后会显示在这里" />
              ),
            }}
          />
        </Card>
      </>
    ),
    accounts: state ? (
      <AccountsPanel {...{ state, api, action, blocked, login, loginUrl }} />
    ) : null,
    quota: state ? <QuotaPanel {...{ state, api, action, blocked }} /> : null,
    models: (
      <Card
        title={`模型目录 · ${models.length}`}
        extra={
          <Button
            disabled={!ready || blocked}
            onClick={() =>
              action(() => api("models/refresh", {}), "目录已刷新")
            }
          >
            刷新目录
          </Button>
        }
      >
        <div className="toolbar">
          <Input.Search
            placeholder="搜索模型名称"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            allowClear
          />
          <Segmented
            value={modelType}
            onChange={setModelType}
            options={[
              { label: "全部", value: "all" },
              { label: "可用", value: "available" },
              { label: "不可选 / 已禁用", value: "hidden" },
            ]}
          />
        </div>
        <Alert
          type="info"
          title="目录声明与实测结果分别展示；不可选条目不会提供给客户端。"
        />
        <Table
          className="spaced"
          rowKey="slug"
          scroll={{ x: 1000 }}
          dataSource={models.filter(
            (m) =>
              m.slug.includes(query) &&
              (modelType === "all" ||
                (modelType === "available" && m.selectable) ||
                (modelType === "hidden" && !m.selectable)),
          )}
          columns={[
            { title: "模型名称", dataIndex: "slug", width:180, render:v=><Text copyable>{v}</Text> },
            {
              title: "可用性",
              render: (_, m) => (
                <Tag color={m.selectable ? "success" : "default"}>
                  {m.selectable ? "可用" : "不可选"}
                </Tag>
              ),
            },
            {
              title: "基础工具",
              render: (_, m) => statusTag(m.checks.tools.status),
            },
            {
              title: "文件工具",
              render: (_, m) => statusTag(m.checks.files?.status),
            },
            {
              title: "MCP 工具",
              render: (_, m) => statusTag(m.checks.mcp?.status),
            },
            {
              title: "长会话",
              render: (_, m) => statusTag(m.checks.long?.status),
            },
            {
              title: "操作",
              render: (_, m) => (
                <Space>
                  <Button
                    type="link"
                    disabled={!m.selectable || blocked || !ready}
                    onClick={() => verify(m.slug, "tools")}
                  >
                    验证工具
                  </Button>
                  <Button
                    type="link"
                    disabled={!m.selectable}
                    onClick={() => {
                      setSelected(m.slug);
                      location.hash = "tests";
                    }}
                  >
                    更多验证
                  </Button>
                </Space>
              ),
            },
          ]}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </Card>
    ),
    connection: (
      <>
        <Card title="客户端连接信息">
          <Descriptions
            bordered
            column={1}
            items={[
              {
                key: "b",
                label: "服务地址",
                children: (
                  <Space wrap>
                    <Text code>{location.origin}/workbuddy/v1</Text>
                    <Button size="small" onClick={() => copy("baseUrl")}>
                      复制地址
                    </Button>
                  </Space>
                ),
              },
              {
                key: "k",
                label: "本机连接密钥",
                children: (
                  <Space>
                    <Text>••••••••••••••••</Text>
                    <Button size="small" onClick={() => copy("apiKey")}>
                      复制密钥
                    </Button>
                  </Space>
                ),
              },
              {
                key: "p",
                label: "接口协议",
                children: "OpenAI 兼容 · Chat Completions / Responses",
              },
            ]}
          />
          <Paragraph className="spaced" type="secondary">
            WorkBuddy 使用上述专用地址：连接探测放宽 1 token
            上限，标题辅助请求的 none 映射到 low，转换会记录在日志中；普通 /v1
            接口保持严格校验。
          </Paragraph>
        </Card>
        <Card title="接入 WorkBuddy">
          <Paragraph>
            将工具验证通过的模型加入 WorkBuddy。已有 ModelBridge
            条目会更新连接地址；当前账号不再可选的旧 ModelBridge
            条目移入加密备份，其他模型配置保留。
          </Paragraph>
          <Space wrap>
            <Button
              type="primary"
              disabled={
                !ready ||
                blocked ||
                !models.some((m) => m.checks.tools.status === "passed")
              }
              onClick={() =>
                modal.confirm({
                  title: "更新 WorkBuddy 连接配置",
                  content:
                    "更新已通过工具验证的模型；将本机网关中不可用的旧 ModelBridge 条目移入加密备份，保留其他配置。更新后请刷新 WorkBuddy 窗口。",
                  okText: "保存配置",
                  cancelText: "取消",
                  onOk: () =>
                    action(
                      () => api("workbuddy/configure", {}),
                      "WorkBuddy 配置已保存",
                    ),
                })
              }
            >
              配置 WorkBuddy
            </Button>
            <Button
              disabled={!ready || blocked || !selected}
              onClick={() => verify(selected, "text")}
            >
              测试连接
            </Button>
            <Select
              aria-label="连接测试模型"
              value={selected}
              onChange={setSelected}
              options={models
                .filter((m) => m.selectable)
                .map((m) => ({ value: m.slug, label: m.slug }))}
            />
          </Space>
        </Card>
        <Alert
          showIcon
          type="info"
          title="启动顺序：ModelBridge → WorkBuddy"
          description="只需保持 ModelBridge 运行，无需启动 CLIProxyAPI。"
        />
      </>
    ),
    tests: (
      <>
        <Card title="真实调用验证">
          <Paragraph type="secondary">
            使用所选模型进行实际请求。文件测试只操作隔离测试目录；MCP
            测试使用本机测试工具，不访问业务数据。
          </Paragraph>
          <div className="test-form">
            <div>
              <Text>模型</Text>
              <Select
                aria-label="验证模型"
                value={selected}
                onChange={setSelected}
                options={models
                  .filter((m) => m.selectable)
                  .map((m) => ({ value: m.slug, label: m.slug }))}
              />
            </div>
            <div>
              <Text>验证项目</Text>
              <Select
                aria-label="验证项目"
                value={kind}
                onChange={setKind}
                options={Object.entries(kinds).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </div>
            <Button
              type="primary"
              loading={working}
              disabled={!ready || blocked || !selected}
              onClick={() => verify(selected, kind)}
            >
              开始验证
            </Button>
          </div>
          <Paragraph type="secondary" className="spaced">
            长会话测试包含约 64 KiB 测试内容、12
            轮连续工具调用、工具报错和历史内容回忆，需要数分钟。
          </Paragraph>
        </Card>
        <ReportsPanel reports={reports} columns={testsColumns} />
      </>
    ),
    logs: state ? (
      <LogsPanel {...{ state, api, action, refresh }} onDetail={setDetails} />
    ) : null,
    settings: <SettingsPanel {...{ api, action, blocked }} />,
  };
  if (state) {
    content.overview = (
      <>
        {content.overview}
        <OverviewMetrics state={state} />
      </>
    );
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
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#16836d",
          borderRadius: 10,
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
        },
        components: {
          Layout: { bodyBg: dark ? "#111a19" : "#f4f7f6" },
          Menu: { darkItemBg: "#102e29", darkItemSelectedBg: "#275146" },
        },
      }}
    >
      <Layout className="app-layout">
        <Layout.Sider
          width={230}
          breakpoint="lg"
          collapsedWidth={76}
          className="sidebar"
        >
          <a className="brand" href="#overview">
            <span className="brand-icon">M</span>
            <span className="brand-text">
              ModelBridge<small>CODEX 控制台</small>
            </span>
          </a>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[page]}
            onClick={({ key }) => {
              location.hash = key;
              setQuery("");
            }}
            items={pages.map(([key, label, icon]) => ({
              key,
              label,
              icon: <span className="nav-icon">{icon}</span>,
            }))}
          />
          <div className="sidebar-footer">
            <span className={`status-dot ${ready ? "online" : ""}`} />
            <span className="brand-text">
              {ready ? "会员通道已连接" : "等待账号授权"}
            </span>
            <small className="brand-text">独立运行 · ModelBridge</small>
          </div>
        </Layout.Sider>
        <Layout>
          <Layout.Header className="topbar">
            <Text type="secondary">
              工作台 <span className="slash">/</span>{" "}
              <Text strong>{pages.find((p) => p[0] === page)?.[1]}</Text>
            </Text>
            <Space>
              <Tag color="green">Codex OAuth</Tag>
              <Button
                type="text"
                aria-label="切换主题"
                onClick={() => setDark(!dark)}
              >
                {dark ? "☀ 浅色" : "☾ 深色"}
              </Button>
            </Space>
          </Layout.Header>
          <Layout.Content className="content">
            <div className="page-heading">
              <div>
                <Title level={2}>{pages.find((p) => p[0] === page)?.[1]}</Title>
                <Text type="secondary">你的账号，你的模型，你的工作流。</Text>
              </div>
              <Text type="secondary" className="local-label">
                本机运行 · 0.3.1
              </Text>
            </div>
            {(error || state?.lastError?.message) && (
              <Alert
                showIcon
                type="error"
                title={error || state.lastError.message}
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
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")).render(
  <AntApp>
    <Console />
  </AntApp>,
);
