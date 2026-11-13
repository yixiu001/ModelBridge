import React, { useState, useEffect } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { count, date, download, trafficSummary } from "./console-utils.mjs";
const { Text, Paragraph } = Typography;
const labels = {
  timeoutSeconds: "单次请求超时（秒）",
  requestRetry: "失败重试次数",
  routingStrategy: "账号选择方式",
  loggingToFile: "写入引擎运行日志",
  maxRetryInterval: "最长重试等待（秒）",
  maxRetryCredentials: "单次最多尝试账号数",
  logsMaxTotalSizeMb: "运行日志总大小上限（MB）",
  errorLogsMaxFiles: "错误日志保留文件数",
};
const format = (key, v) =>
  key === "routingStrategy"
    ? {
        "fill-first": "优先第一个可用账号",
        "round-robin": "轮询账号",
        "weighted-round-robin": "按权重轮询",
      }[v] || v
    : typeof v === "boolean"
      ? v
        ? "开启"
        : "关闭"
      : String(v ?? "未提供");

export function OverviewMetrics({ state }) {
  const s = trafficSummary(state.traffic);
  const withCounters = state.accounts.filter(
    (a) => a.successCount !== null && a.failureCount !== null,
  );
  return (
    <>
      <Card
        title="账号请求统计"
        extra={<Text type="secondary">当前账号 · 最近 100 条本机记录</Text>}
      >
        <Row gutter={16}>
          <Col span={8}>
            <Statistic
              title="成功请求"
              value={
                withCounters.length
                  ? withCounters.reduce((n, a) => n + a.successCount, 0)
                  : "—"
              }
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="失败请求"
              value={
                withCounters.length
                  ? withCounters.reduce((n, a) => n + a.failureCount, 0)
                  : "—"
              }
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="可用账号 / 全部"
              value={`${state.accounts.filter((a) => !a.disabled && !a.unavailable && a.status === "active").length} / ${state.accounts.length}`}
            />
          </Col>
        </Row>
      </Card>
      <Card
        title="最近模型请求"
        extra={
          <Button onClick={() => (location.hash = "logs")}>查看日志</Button>
        }
      >
        <Row gutter={16}>
          {[
            ["请求数", s.total],
            ["完成转发", s.success],
            ["失败", s.failed],
            ["客户端取消", s.cancelled],
          ].map(([title, value]) => (
            <Col xs={12} md={6} key={title}>
              <Statistic title={title} value={value} />
            </Col>
          ))}
        </Row>
        <Paragraph className="spaced" type="secondary">
          按本机最近 100
          条记录中的模型请求统计，取消单独计算。完成转发不等于模型任务通过验证。
        </Paragraph>
        <Table
          rowKey="model"
          size="small"
          pagination={false}
          dataSource={s.models.slice(0, 8)}
          columns={[
            { title: "模型", dataIndex: "model" },
            { title: "请求", dataIndex: "total" },
            { title: "完成", dataIndex: "success" },
            { title: "失败", dataIndex: "failed" },
            { title: "取消", dataIndex: "cancelled" },
          ]}
        />
      </Card>
    </>
  );
}

export function RulesPanel({ api, action, blocked }) {
  const { modal } = App.useApp();
  const [rules, setRules] = useState(null),
    [excluded, setExcluded] = useState(""),
    [aliases, setAliases] = useState([]);
  const adopt = (r) => {
    setRules(r);
    setExcluded(r.excluded.join("\n"));
    setAliases(r.aliases);
  };
  async function read() {
    const r = await action(() => api("models/rules", {}));
    if (r) adopt(r);
  }
  const save = async (kind) => {
    const values =
      kind === "excluded"
        ? excluded
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : aliases;
    const preview=await action(()=>api('models/preview',{rules:{excluded:rules.excluded,aliases:rules.aliases,[kind]:values}}));
    if(!preview)return;
    if(preview.errors.length){modal.error({title:'规则无法保存',content:preview.errors.join('；')});return;}
    modal.confirm({
      title:
        kind === "excluded"
          ? "保存 Codex 模型禁用规则？"
          : "保存 Codex 模型别名？",
      width: 700,
      content: (
        <>
          <Paragraph>
            仅修改
            Codex。目录会重新读取，规则改变后原验证结果需要重跑；已有客户端模型名称不会自动更新。
          </Paragraph>
          <pre className="config-preview">
            {JSON.stringify({ 原值: rules[kind], 新值: values, 客户端新增:preview.changes.added,客户端移除:preview.changes.removed,变化:preview.changes.changed }, null, 2)}
          </pre>
        </>
      ),
      okText: "保存规则",
      cancelText: "取消",
      onOk: async () => {
        const r = await action(
          () =>
            api("models/rules/save", {
              kind,
              values,
              revision: rules.revision,
            }),
          "模型规则已保存",
        );
        if (r) adopt(r);
      },
    });
  };
  return (
    <Card
      title="模型规则 · Codex"
      extra={
        <Button disabled={blocked} onClick={read}>
          读取模型规则
        </Button>
      }
    >
      {!rules ? (
        <Empty description="读取本机的 Codex 禁用与别名规则" />
      ) : (
        <Tabs
          items={[
            {
              key: "excluded",
              label: `模型禁用（${rules.excluded.length}）`,
              children: (
                <>
                  <Paragraph>
                    每行一个模型 ID，使用精确名称，不支持通配符。命中的模型将从
                    Codex 可用目录中排除。
                  </Paragraph>
                  <Input.TextArea
                    aria-label="禁用模型规则"
                    rows={5}
                    value={excluded}
                    onChange={(e) => setExcluded(e.target.value)}
                  />
                  <Button
                    className="spaced"
                    disabled={blocked}
                    onClick={() => save("excluded")}
                  >
                    查看改动并保存禁用规则
                  </Button>
                </>
              ),
            },
            {
              key: "aliases",
              label: `模型别名（${rules.aliases.length}）`,
              children: (
                <>
                  <Alert
                    type="info"
                    title="别名会明确指向指定原模型"
                    description="默认保留原模型名称。不要把别名设为其他真实模型的名称；应用到 WorkBuddy 前请重新验证。"
                  />
                  <Table
                    className="spaced"
                    rowKey={(_, i) => String(i)}
                    pagination={false}
                    dataSource={aliases}
                    scroll={{ x: 650 }}
                    columns={[
                      {
                        title: "原模型 ID",
                        render: (v, r, i) => (
                          <Input
                            aria-label={`原模型 ${i + 1}`}
                            value={r.name}
                            onChange={(e) =>
                              setAliases((a) =>
                                a.map((v, j) =>
                                  i === j ? { ...v, name: e.target.value } : v,
                                ),
                              )
                            }
                          />
                        ),
                      },
                      {
                        title: "别名",
                        render: (v, r, i) => (
                          <Input
                            aria-label={`别名 ${i + 1}`}
                            value={r.alias}
                            onChange={(e) =>
                              setAliases((a) =>
                                a.map((v, j) =>
                                  i === j ? { ...v, alias: e.target.value } : v,
                                ),
                              )
                            }
                          />
                        ),
                      },
                      {
                        title: "保留原名",
                        render: (v, r, i) => (
                          <Switch
                            aria-label={`保留原名 ${i + 1}`}
                            checked={!!r.fork}
                            onChange={(fork) =>
                              setAliases((a) =>
                                a.map((v, j) => (i === j ? { ...v, fork } : v)),
                              )
                            }
                          />
                        ),
                      },
                      {
                        title: "",
                        render: (v, r, i) => (
                          <Button
                            danger
                            onClick={() =>
                              setAliases((a) => a.filter((_, j) => i !== j))
                            }
                          >
                            移除规则
                          </Button>
                        ),
                      },
                    ]}
                  />
                  <Space className="spaced">
                    <Button
                      onClick={() =>
                        setAliases((a) => [
                          ...a,
                          { name: "", alias: "", fork: true },
                        ])
                      }
                    >
                      添加别名
                    </Button>
                    <Button disabled={blocked} onClick={() => save("aliases")}>
                      查看改动并保存别名
                    </Button>
                  </Space>
                </>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

export function SettingsPanel({ api, action, blocked }) {
  const { modal } = App.useApp();
  const [settings, setSettings] = useState(null);
  const [form] = Form.useForm();
  const read = async () => {
    const r = await action(() => api("settings/read", {}));
    if (r) {
      setSettings(r);
      form.setFieldsValue(r);
    }
  };
  const save = (values) => {
    if (!Object.keys(values).some((k) => values[k] !== settings[k]))
      return modal.info({
        title: "没有待保存的改动",
        content: "当前设置与已读取的值一致。",
        okText: "知道了",
      });
    return modal.confirm({
      title: "确认设置改动",
      content: (
        <Descriptions
          column={1}
          items={Object.keys(values)
            .filter((k) => values[k] !== settings[k])
            .map((k) => ({
              key: k,
              label: k === "timeoutSeconds" ? "单次超时（秒）" : "保存请求摘要",
              children: `${settings[k]} → ${values[k]}`,
            }))}
        />
      ),
      okText: "保存",
      cancelText: "取消",
      onOk: async () => {
        const r = await action(
          () =>
            api("settings/save", { ...values, revision: settings.revision }),
          "设置已保存",
        );
        if (r) {
          setSettings(r);
          form.setFieldsValue(r);
        } else await read();
      },
    });
  };
  return (
    <Card
      title="运行设置"
      extra={
        <Button disabled={blocked} onClick={read}>
          读取当前设置
        </Button>
      }
    >
      {!settings ? (
        <Empty description="读取配置后编辑" />
      ) : (
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            label="单次请求超时（秒）"
            name="timeoutSeconds"
            rules={[{ required: true }]}
          >
            <InputNumber min={30} max={600} />
          </Form.Item>
          <Form.Item
            label="保存最近 100 条请求摘要"
            name="loggingToFile"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Alert
            type="info"
            title="固定使用当前选中的账号；失败不自动重试或换模型。关闭摘要保存后仅在内存中保留新记录。"
          />
          <Button
            className="spaced"
            type="primary"
            htmlType="submit"
            disabled={blocked}
          >
            查看改动并保存
          </Button>
        </Form>
      )}
      <Paragraph className="spaced">
        ModelBridge 0.3.1 · React + Ant Design · Codex OAuth · 独立运行
      </Paragraph>
    </Card>
  );
}

export function LogsPanel({ state, api, action, refresh, onDetail }) {
  const [tab, setTab] = useState("gateway"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [minutes, setMinutes] = useState(0),
    [paused, setPaused] = useState(false),
    [snapshot, setSnapshot] = useState(state.traffic),
    [engine, setEngine] = useState(null),
    [level, setLevel] = useState("all");
  useEffect(() => {
    if (!paused) setSnapshot(state.traffic);
  }, [state.traffic, paused]);
  const rows = [...snapshot]
    .reverse()
    .filter(
      (r) =>
        (status === "all" ||
          (status === "errors" &&
            ["failed", "upstream_error", "rejected"].includes(r.status)) ||
          r.status === status) &&
        (!minutes || Date.parse(r.startedAt) > Date.now() - minutes * 60000) &&
        JSON.stringify([
          r.model,
          r.httpStatus,
          r.path,
          r.error?.message,
          r.errorCode,
        ])
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  const lines = (engine?.lines || []).filter(
    (l) =>
      l.toLowerCase().includes(search.toLowerCase()) &&
      (level === "all" || l.toLowerCase().includes(level)),
  );
  return (
    <Card title="日志查看">
      <Tabs
        activeKey={tab}
        onChange={(v) => {
          setTab(v);
          setSearch("");
        }}
        items={[
          {
            key: "gateway",
            label: "网关请求",
            children: (
              <>
                <Space wrap className="spaced">
                  <Input.Search
                    aria-label="搜索请求日志"
                    placeholder="模型、状态码、错误或路径"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    allowClear
                  />
                  <Select
                    aria-label="请求状态筛选"
                    value={status}
                    onChange={setStatus}
                    options={[
                      { value: "all", label: "全部状态" },
                      { value: "errors", label: "仅失败" },
                      { value: "forwarded", label: "完成转发" },
                      { value: "cancelled", label: "客户端取消" },
                    ]}
                  />
                  <Select
                    aria-label="日志时间范围"
                    value={minutes}
                    onChange={setMinutes}
                    options={[
                      { value: 0, label: "全部已保留记录" },
                      { value: 15, label: "最近 15 分钟" },
                      { value: 60, label: "最近 1 小时" },
                    ]}
                  />
                  <Button onClick={() => setPaused(!paused)}>
                    {paused ? "继续刷新" : "暂停显示更新"}
                  </Button>
                  <Button
                    onClick={async () => {
                      await refresh();
                      setSnapshot(state.traffic);
                    }}
                  >
                    刷新
                  </Button>
                  <Button
                    disabled={!rows.length}
                    onClick={() => download("modelbridge-requests.json", rows)}
                  >
                    导出筛选结果
                  </Button>
                </Space>
                <Paragraph type="secondary" className="spaced">
                  缓存 {snapshot.length} 条，匹配 {rows.length} 条。只保留最近
                  100 条摘要；客户端连接探测主动结束会记为取消，不计作上游错误。
                  {paused ? "当前显示已暂停。" : ""}
                </Paragraph>
                <Table
                  rowKey="id"
                  dataSource={rows}
                  scroll={{ x: 950 }}
                  pagination={{ defaultPageSize: 15, showSizeChanger: true }}
                  columns={[
                    { title: "时间", dataIndex: "startedAt", render: date },
                    {
                      title: "模型",
                      dataIndex: "model",
                      render: (v) => v || "目录读取",
                    },
                    { title: "HTTP", dataIndex: "httpStatus" },
                    {
                      title: "状态",
                      dataIndex: "status",
                      render: (v) => (
                        <Tag
                          color={
                            ["failed", "upstream_error", "rejected"].includes(v)
                              ? "error"
                              : v === "forwarded"
                                ? "success"
                                : "default"
                          }
                        >
                          {{
                            forwarded: "完成转发",
                            cancelled: "客户端取消",
                            failed: "传输失败",
                            upstream_error: "上游错误",
                            rejected: "拒绝",
                          }[v] || v}
                        </Tag>
                      ),
                    },
                    {
                      title: "耗时",
                      render: (_, r) =>
                        r.finishedAt
                          ? `${((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000).toFixed(2)} 秒`
                          : "进行中",
                    },
                    {
                      title: "请求大小",
                      render: (_, r) =>
                        `${((r.requestBytes || 0) / 1024).toFixed(1)} KiB`,
                    },
                    {
                      title: "",
                      render: (_, r) => (
                        <Button type="link" onClick={() => onDetail(r)}>
                          详情
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "engine",
            label: "引擎运行日志",
            children: (
              <>
                <Space wrap>
                  <Button
                    onClick={async () => {
                      const r = await action(() => api("logs/engine", {}));
                      if (r) setEngine(r);
                    }}
                  >
                    读取引擎日志
                  </Button>
                  <Input.Search
                    aria-label="搜索引擎日志"
                    placeholder="搜索已读取的日志"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Select
                    aria-label="日志等级"
                    value={level}
                    onChange={setLevel}
                    options={["all", "info", "warn", "error", "debug"].map(
                      (value) => ({
                        value,
                        label:
                          value === "all" ? "全部等级" : value.toUpperCase(),
                      }),
                    )}
                  />
                  <Button
                    disabled={!lines.length}
                    onClick={() =>
                      download("modelbridge-engine-log.json", {
                        checkedAt: engine?.checkedAt,
                        lines,
                      })
                    }
                  >
                    导出脱敏日志
                  </Button>
                </Space>
                <Alert
                  className="spaced"
                  type={engine?.unavailable ? "warning" : "info"}
                  title={
                    engine?.unavailable
                      ? "引擎日志不可读取"
                      : "运行日志来自 ModelBridge"
                  }
                  description="只显示最近 100 条请求摘要，不记录完整请求正文或凭据。"
                />
                <pre className="log-content">
                  {lines.length ? lines.join("\n") : "暂无已读取日志"}
                </pre>
                <Text type="secondary">
                  读取时间：{date(engine?.checkedAt)}
                </Text>
                <Table
                  className="spaced"
                  rowKey="name"
                  dataSource={engine?.errors || []}
                  columns={[
                    { title: "错误日志文件", dataIndex: "name" },
                    {
                      title: "大小",
                      dataIndex: "size",
                      render: (v) => (v === null ? "—" : `${v} 字节`),
                    },
                    { title: "修改时间", dataIndex: "modified", render: date },
                  ]}
                  locale={{ emptyText: "暂无错误文件" }}
                />
                <Text type="secondary">
                  错误文件可能包含请求正文，这里只展示目录，不导出原始内容。
                </Text>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

export function ReportsPanel({ reports, columns }) {
  const [model, setModel] = useState("all"),
    [kind, setKind] = useState("all"),
    [status, setStatus] = useState("all");
  const rows = [...reports]
    .reverse()
    .filter(
      (r) =>
        (model === "all" || r.model === model) &&
        (kind === "all" || r.kind === kind) &&
        (status === "all" || r.status === status),
    );
  return (
    <Card
      title="验证记录"
      extra={
        <Button
          disabled={!rows.length}
          onClick={() => download("modelbridge-verification.json", rows)}
        >
          导出筛选报告
        </Button>
      }
    >
      <Space wrap>
        <Select
          aria-label="报告模型"
          value={model}
          onChange={setModel}
          options={[
            { value: "all", label: "全部模型" },
            ...Array.from(new Set(reports.map((r) => r.model))).map(
              (value) => ({ value, label: value }),
            ),
          ]}
        />
        <Select
          aria-label="报告项目"
          value={kind}
          onChange={setKind}
          options={Object.entries({
            all: "全部项目",
            text: "文本",
            tools: "基础工具",
            files: "文件",
            mcp: "MCP",
            long: "长会话",
          }).map(([value, label]) => ({ value, label }))}
        />
        <Select
          aria-label="报告结果"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "全部结果" },
            { value: "passed", label: "通过" },
            { value: "failed", label: "失败" },
            { value: "cancelled_or_timeout", label: "取消 / 超时" },
          ]}
        />
      </Space>
      <Paragraph className="spaced" type="secondary">
        只显示当前引擎与账号/模型规则上下文中的记录。更换配置后，旧结果不会当作新配置已经通过。
      </Paragraph>
      <Table
        rowKey={(r) => r.startedAt + r.model + r.kind}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 650 }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      />
    </Card>
  );
}

export function ConnectionGuide({ models }) {
  const [model, setModel] = useState(
    models.find((m) => m.selectable)?.slug || "",
  );
  const sample = JSON.stringify(
    { model, messages: [{ role: "user", content: "你好" }], stream: true },
    null,
    2,
  );
  return (
    <Card title="手动接入与配置示例">
      <Paragraph>
        接口地址填写
        http://127.0.0.1:43821/workbuddy/v1，使用上方的本机连接密钥。WorkBuddy
        若要求完整请求地址，填写 /workbuddy/v1/chat/completions。
      </Paragraph>
      <Select
        aria-label="示例模型"
        value={model}
        onChange={setModel}
        options={models
          .filter((m) => m.selectable)
          .map((m) => ({ value: m.slug, label: m.slug }))}
      />
      <Paragraph className="spaced">
        <Text copyable={{ text: sample }}>复制请求示例</Text>
      </Paragraph>
      <pre className="config-preview">{sample}</pre>
      <Collapse
        items={[
          {
            key: "help",
            label: "连接不成功时如何检查",
            children: (
              <ol>
                <li>确认 ModelBridge 正在运行。</li>
                <li>
                  确认账号可用、模型在当前目录中；在调用验证页先做文本测试。
                </li>
                <li>
                  确认使用本机推理密钥，路径是否需要包含 /chat/completions。
                </li>
                <li>
                  到日志页按失败筛选，查看 HTTP
                  状态和错误摘要；保留原模型定位问题。
                </li>
              </ol>
            ),
          },
        ]}
      />
    </Card>
  );
}
