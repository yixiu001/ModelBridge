# 模型桥 ModelBridge

独立运行的 Codex OAuth 本机网关，使用 React + Ant Design 管理界面。**无需安装、启动或连接 CLIProxyAPI。** 仅选择性移植必要的消息/工具历史转换、配额窗口解析和 OAuth 参数，来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 运行

需要 Windows、Node.js 24+ 和 Windows PowerShell。

```powershell
npm ci
npm run build
.\scripts\start.ps1
```

打开 http://127.0.0.1:43821 ，按「Codex 账号 → 添加账号 → 官方 OAuth 授权 → 模型目录 → 调用验证 → 客户端接入」操作。关闭服务使用 `.\scripts\stop.ps1`。

启动脚本沿用已有环境代理，不修改系统代理。浏览器界面、推理接口只监听本机。OAuth 凭据与客户端密钥均由本项目以 Windows DPAPI 加密保存于 `.local`；不读取其他应用凭据。原 ModelBridge 自有授权可继续使用；不从 CLIProxyAPI 导入授权。

## 功能

后续整体改造见[CLIProxyAPI功能调查报告](docs/cliproxyapi-investigation-2026-11-14.md)与[修改方案](docs/superpowers/plans/2026-11-14-modelbridge-console-upgrade.md)。方案待评审，下列为当前已实现功能。

- 概览：账号、模型、验证结果、最近请求与按模型统计。
- Codex 账号：添加/取消授权、手动提交本次回调、切换当前账号、备注与列表排序、启停、移除、批量刷新授权及批量结果。固定使用用户选中的账号，不自动换号。
- 配额：直接读取官方 Codex 额度，显示套餐、5小时／每周／每月窗口、代码审查和附加额度、恢复时间与额外积分；支持单账号／筛选账号刷新、剩余排序和低额度筛选。未知数据不推算，本机请求数不等于会员余额。
- 模型：官方目录、可用性与验证结果分开显示；搜索、禁用精确模型名称、显式别名映射。模型规则变更使当前验证结果失效，保存会检测过期表单。
- 客户端：复制本机地址/密钥，向 WorkBuddy 写入已通过工具验证的模型，创建加密备份并保留其他配置；当前账号不可选的旧 ModelBridge 自建条目移入备份，避免继续误选。
- 验证：文本、工具闭环、隔离文件读写、真实 stdio MCP、12轮长会话；支持取消、筛选和导出报告。
- 日志：最近100条脱敏摘要，按状态/时间/模型筛选、暂停显示、详情和导出。网络错误502、超时504、上游明确状态保留；参数/历史不合法才按输入错误处理。
- 设置：30–600秒请求超时、请求摘要持久化开关、保存前改动确认和版本冲突检测。失败不自动重试。

不提供 API 供应商接入、其他平台、插件、计费、多账号自动调度或无依据的额度估算。

### 首次读取配额

在「账号配额」点击「授权读取配额」，打开官方授权页面，选择与会员登录相同的 ChatGPT 账号；完成后点击「刷新配额」。登录临时使用本机 `127.0.0.1:1455` 回调端口，授权完成、取消或10分钟过期后关闭；端口被其他登录流程占用时会明确提示。

模型调用授权与配额授权是两份独立的 OAuth 凭据，均由 ModelBridge 自己取得、刷新并加密保存。现有 direct 会员令牌请求 `chatgpt.com/backend-api/wham/usage` 实测返回401，所以首次需要补充 Codex 登录。不会读取 CLIProxyAPI、Codex 或 WorkBuddy 的凭据，不新增付费 API 接入。配额是查询时快照；授权失效时提示重新授权，查询失败不会继续把旧数据标为可用。

## 接口与兼容

```text
WorkBuddy → ModelBridge 127.0.0.1:43821 → 官方会员 API
浏览器 → ModelBridge 自有管理接口
```

- 普通接口：`/v1/models`、`/v1/chat/completions`、`/v1/responses`。
- WorkBuddy 专用：`/workbuddy/v1/chat/completions`，完整地址从接入页复制。仅已识别的连接探测不传递1 token限制、标题辅助请求的none映射到目录声明的low；明确记录转换，不改变模型。
- Chat Completions 根据客户端当前完整历史重建工具调用，不依赖本地历史指纹/加密推理缓存；历史压缩和重启不会仅因缓存不匹配被拒绝。缺失/重复工具编号、缺少结果等仍拒绝，不静默丢消息。
- Responses 只支持无存储完整历史请求，不支持`store:true`或`previous_response_id`。保留官方能力限制；不是完整付费API的替代品。
- 模型以登录账号实际返回的目录为准；不把静态模型清单当成账号可用权限。指定模型不会自动降级或替换。

## 验证与维护

```powershell
npm test
npm run build
node scripts/verify-standalone.mjs
node scripts/configure-workbuddy.mjs
```

真实测试消耗会员用量，只操作项目隔离测试数据。详细当前证据及未验证边界见 [当前状态](docs/current-state.md)。此前依赖 CLIProxyAPI 的验收文件保留为历史，不作为当前独立实现通过的依据。
