# 当前状态

2026-11-14（Asia/Shanghai），ModelBridge 0.3.0。

## 当前实现

- 唯一源码入口：E:\codex-dev\tools\model-bridge；GitHub：https://github.com/yixiu001/ModelBridge，main 分支。
- 已改为独立网关：WorkBuddy → ModelBridge 127.0.0.1:43821 → 官方会员 API。启动不读取 CLIProxyAPI 配置，不连接8317，不需要该程序/服务；既有试用安装保留。
- 只保留 Codex OAuth，React + Ant Design 八页管理界面。新增账号筛选、批量操作、当前账号切换、备注与排序、模型禁用/别名、配置冲突检测、日志筛选/暂停/导出、报告筛选/导出。
- 选择性移植上游消息/工具调用历史转换及长编号处理，其余服务由本项目实现。第三方来源和 MIT 许可已保留；未复制整个项目、其他提供商或插件。
- 继续使用 ModelBridge 自有 DPAPI 会员授权，不读取其他应用凭据。普通 /v1 严格校验；WorkBuddy 使用 /workbuddy/v1 专用兼容接口，转换明确记录。
- WorkBuddy 已接入当前8个可用模型；两个旧的不可选自建条目（gpt-6-chat-thinking、codex-auto-review）已移入加密配置备份。其他配置保留。

## 已验证

- 43项自动测试通过；生产界面构建通过。
- 官方返回11个目录条目，8个可选。8模型全部通过工具、文件、真实stdio MCP验证；GPT-6.1-Sol通过12轮长会话、约64KiB内容、工具错误及历史回忆验证。
- 最终25项成功案例合计149次模型请求、78次工具执行。第一次文件案例因测试子进程退出缺陷被取消；修复IPC退出行为后重测通过，原失败记录保留。
- WorkBuddy 5.9.3旧长会话原生复测：12次请求、11次工具调用，最大请求350,495字节；文件sum=719、随机nonce一致；完整读取603行长文件；MCP新链推进至value=103/step=3并正确解释EXPECTED_TEST_ERROR。12次请求均HTTP200，未见400。
- WorkBuddy原生连接按钮显示“连接成功”；标题辅助请求none→low真实返回HTTP200。模型未替换。
- 管理界面验证账号搜索、模型可用筛选、规则读取、设置修改180→181→180、日志暂停/读取、接入地址和八模型结果。浏览器未发现错误或警告。
- 独立审查及回归覆盖账号切换/授权/目录刷新竞争、网络502/超时504分类、前置拒绝入日志、空assistant工具消息、旧缓存退出运行路径和测试子进程生命周期。

完整场景见 [独立实现验收记录](standalone-verification-2026-11-14.md)。

## 边界

- 当前授权通道没有已核验的配额读取接口，界面明确显示不可用；不推算余额。本机统计仅最近100条请求，不是累计会员用量。
- 单账号已真实授权并刷新、调用；本轮未新建第二账号或移除真实账号。新增/重新授权、批量启停和多账号切换由离线契约测试覆盖，不能称为真实多账号全覆盖。
- 长会话实测集中GPT-6.1-Sol，不承诺其他模型无限上下文。无效参数、上游限制及未来变化仍可导致错误，不能保证永远没有400。
- Responses仅无存储完整历史，不支持store:true或previous_response_id；不提供完整付费API功能、自动换号、自动重试、其他平台和插件。
- 未配置远程监听、开机启动、安装包、服务器发布或持续监控。

## 证据

- 本机原始记录（忽略、不提交）：`.local/direct-reports.json`、`standalone-acceptance-summary.json`、`direct-traffic.json`、`independent-title-probe.json`、`native-independent-start.json`、`mcp-audit.jsonl`、隔离文件和`standalone-console.jpg`。
- `engine-migration-plan.md`和`engine-verification-2026-11-14.md`属于此前CLIProxyAPI架构历史，不代表当前实现。
