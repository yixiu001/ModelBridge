import {draftCache} from "./console-state.mjs";
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

export function RulesPanel({ api, action, blocked }) {
  const { modal } = App.useApp();
  const [rules, setRules] = useState(()=>draftCache.get("rules")?.rules||null),
    [excluded, setExcluded] = useState(()=>draftCache.get("rules")?.excluded||""),
    [aliases, setAliases] = useState(()=>draftCache.get("rules")?.aliases||[]);
  useEffect(()=>{if(rules)draftCache.set("rules",{rules,excluded,aliases,dirty:excluded!==rules.excluded.join("\n")||JSON.stringify(aliases)!==JSON.stringify(rules.aliases)});},[rules,excluded,aliases]);
  const adopt = (r) => {
    setRules(r);
    setExcluded(r.excluded.join("\n"));
    setAliases(r.aliases);
  };
  async function read(force=false) {
    if(draftCache.get("rules")?.dirty&&!force){modal.confirm({title:"放弃未保存的模型规则并重载？",okText:"放弃草稿",cancelText:"保留草稿",onOk:()=>read(true)});return;}
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
        if(r){const latest=draftCache.get('rules');setRules(r);
          if(kind==='excluded')setExcluded(r.excluded.join('\n'));else setAliases(r.aliases);
          // The other tab's uncommitted draft remains intact.
          if(kind==='excluded'&&latest)setAliases(latest.aliases);
          if(kind==='aliases'&&latest)setExcluded(latest.excluded);
        }
      },
    });
  };
  return (
    <Card
      title="模型规则 · Codex"
      extra={
        <Button disabled={blocked} onClick={()=>read()}>
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
    <Collapse items={[{key:'manual',label:'手动接入与配置示例',children:<>
      <Paragraph>
        接口地址填写
        {location.origin}/workbuddy/v1，使用上方的本机连接密钥。WorkBuddy
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
    </>}]} />
  );
}
