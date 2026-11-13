# 模型桥 ModelBridge

使用 Codex OAuth 账号连接 WorkBuddy 的本机管理台。**React + Ant Design 界面，CLIProxyAPI 作为唯一推理底层。**

当前范围：Codex OAuth 登录、多账号启停和移除、账号配额、模型目录、WorkBuddy 接入、文本/工具/文件/MCP/长会话验证、请求日志和必要设置。不提供 API 提供商、其他账号平台、插件或计费功能。

## 架构

```text
WorkBuddy → ModelBridge 127.0.0.1:43821 → CLIProxyAPI 127.0.0.1:8317 → Codex OAuth
浏览器 → ModelBridge 管理界面 → 受限管理接口 → CLIProxyAPI
```

CLIProxyAPI 负责会员授权、令牌刷新、协议适配、工具调用格式和流式响应。ModelBridge 原样转发推理请求及响应，不重新拼接工具历史、不更换模型，也不自动重放请求。参数兼容、账号调度和引擎内部重试遵循 CLIProxyAPI 配置。

`/v1/models`、`/v1/chat/completions`、`/v1/responses` 使用独立本机推理密钥；旧 `/workbuddy/v1/...` 地址保留为透明别名，两者现在采用相同的引擎策略。旧的严格/WorkBuddy 专用转换器不再用于运行服务，历史测试仍保留。

## 运行

需要 Windows、Node.js 24+、Windows PowerShell，以及独立运行的 CLIProxyAPI。已验证引擎版本为 **v8.0.69**；不会自动升级或修改系统代理。

```powershell
npm ci
npm run build
.\scripts\start.ps1
```

打开 [管理界面](http://127.0.0.1:43821)。

1. 启动本机 CLIProxyAPI，在「设置与系统」填写引擎地址、客户端密钥和管理密钥，验证后保存。
2. 在「Codex 账号」点击「添加 Codex 账号」，在 OpenAI 官方页面完成 OAuth 登录。已有引擎账号会自动显示。
3. 在「模型目录」读取全部条目；图像模型仅展示，不标记为已验证。
4. 选择文本模型完成基础工具验证，再到「客户端接入」配置 WorkBuddy。
5. 刷新 WorkBuddy 窗口，选择 `ModelBridge · 模型名`。

已独立安装本机 CLIProxyAPI、且明确授权复用其连接配置时，也可运行：

```powershell
node scripts/connect-engine.mjs <CLIProxyAPI的access.json路径>
```

此脚本只读取指定安装的本机连接密钥，不读取账号 OAuth 文件，也不借用 Codex/WorkBuddy 等应用的登录凭据。

停止 ModelBridge：

```powershell
.\scripts\stop.ps1
```

请先取消进行中的测试。停止 ModelBridge 不会停止独立的 CLIProxyAPI，也不会删除账号。未配置开机启动或远程监听。

## 后台功能

- **概览**：连接、目录、账号与最近请求。
- **Codex 账号**：OAuth 登录、重新授权、启停、移除。重新授权时在官方页面选择对应账号；不通过手工导入令牌添加账号。
- **账号配额**：复用官方管理中心的 Codex 窗口分类逻辑，通过引擎读取官方额度；显示实际窗口和恢复时间，缺失时明确提示。不会购买额度或启用超额付费。
- **模型目录**：动态目录和各项真实验证状态。旧适配器的历史结果不会当作新引擎验证结果。
- **客户端接入**：复制地址及本机密钥、测试连接、配置 WorkBuddy。只配置基础工具验证通过的模型，保留已有能力标记和其他模型；同名外部配置冲突时拒绝覆盖，修改前保存 DPAPI 备份。
- **调用验证**：文本、echo 工具、隔离文件读写、真实 stdio MCP、12 轮长会话。提供取消和结果详情。
- **请求日志**：最近 100 次请求摘要和脱敏错误信息。HTTP 状态和原始错误响应继续发给客户端，不将所有故障归为 400。HTTP 200 本身不等于任务完成。
- **设置**：本机引擎绑定、请求超时、有限重试、账号选择、引擎日志；保存前查看改动。

## 验证

```powershell
npm test
npm run build
node scripts/control.mjs status
node scripts/control.mjs verify <模型名> tools
node scripts/control.mjs verify <模型名> files
node scripts/control.mjs verify <模型名> mcp
node scripts/control.mjs verify <模型名> long
node scripts/control.mjs cancel
```

自动测试使用模拟上游和临时本机服务，包含 Windows DPAPI。后台验证与 `verify` 命令则调用真实模型，会消耗会员用量。长会话使用约 64 KiB 测试数据、12 轮连续工具调用、预期工具错误和历史回忆；不能代表无限上下文或所有生产场景。

完整逐模型验收：`node scripts/verify-engine.mjs`。结果保存在 `.local/engine-acceptance.json`。原生 WorkBuddy 验收单独记录，不能用脚本测试替代。

## 凭据、数据与复用

- ModelBridge 引擎连接密钥和本机推理密钥使用 Windows DPAPI 加密，保存在被 Git 忽略的 `.local/`。
- Codex 会员令牌由 CLIProxyAPI 自身保存，其存储格式与目录权限由引擎管理，不宣称它使用 ModelBridge 的 DPAPI。
- 管理接口不会向页面返回会员令牌、认证文件正文或上游管理密钥。账号通过匿名稳定标识区分。
- WorkBuddy 按自己的配置格式保存本机推理密钥；该密钥不是会员令牌，请勿分享客户端配置文件。
- `.local/control.json` 是仅供本机命令使用的管理凭据，启动脚本限制数据目录权限。不要上传 `.local`。
- 不复制引擎本体；配额代码及来源说明见 [第三方许可](THIRD_PARTY_NOTICES.md)。界面由现成 Ant Design 组件组成，操作流程参考官方管理中心。

实际验收状态见 [当前状态](docs/current-state.md)。历史验证文档保留原日期与范围，不能视为当前版本的持续保证。
