# 模型桥 ModelBridge

连接 AI 账号与工作软件的本地模型网关。独立实现，不复制 WorkBuddyProxy 代码。

当前阶段是 **ChatGPT 会员本地网关与 WorkBuddy 联调版**。兼容接口已实现，WorkBuddy 真实工具验收状态见当前状态文档。

## 已实现

- 官方 Sign in with ChatGPT 动态客户端注册、PKCE、state/nonce、RS256 ID token 校验。
- 验证会员用量授权；Windows DPAPI 加密保存凭据，序列化刷新，不借用其他应用登录信息。
- 从账号实际目录读取全部条目，按服务端可见性展示可选模型；没有固定模型名单或自动模型回退。
- 每个模型分别记录能力元数据、发现状态和文本/工具验证结果；不把目录发现标记为全能力支持。
- Responses 流式请求与本地 echo 函数闭环，保留调用标识、输出项和加密推理状态。
- 本机监听、管理接口鉴权、同源检查、取消与有限轮次/时长限制。
- OpenAI 兼容 `/v1/models` 与 `/v1/chat/completions`，独立推理密钥，结构化工具与流式参数转换。
- 使用不可猜测的调用编号关联原始工具/推理项，校验账号、模型与历史；关联缺失或矛盾时拒绝续接。

## 当前验证

2026-11-13 的授权账号目录返回 11 个条目，其中 8 个 `visibility:list`。8 个可选模型均完成两次 Responses 请求、一次本地 echo 调用和最终回答确认。

2026-11-14，WorkBuddy 5.9.3 的全部 8 个可选模型均已完成真实文件读取、写入、复读和最终回答确认，磁盘结果独立核对一致。剩余 7 个模型的标题辅助请求也全部完成。专用兼容模式的设置页连接测试已显示成功，另 7 个模型通过同格式 HTTP 探测；29 项自动测试通过。联调中的失败与针对性重试保留在验收记录中。

这不是通用模型清单，其他账号或后续刷新可能不同。图片、全部推理档位、生产级多工具场景及 MCP 尚未验收。

见 [当前状态](docs/current-state.md)、[首次接入验证](docs/verification-2026-11-13.md)、[WorkBuddy 首个模型验证](docs/workbuddy-verification-2026-11-14.md) 和 [兼容模式与其余七个模型验收](docs/workbuddy-compatibility-2026-11-14.md)。

## WorkBuddy 联调

严格接口为 `http://127.0.0.1:43821/v1/chat/completions`。WorkBuddy 专用兼容接口为 `http://127.0.0.1:43821/workbuddy/v1/chat/completions`；两者均使用同一独立推理密钥和确切模型名。开启 WorkBuddy 自定义协议以使用完整地址，不要填会员 OAuth 令牌或管理密钥。

本机 WorkBuddy 5.9.3 的配置在 `%USERPROFILE%\.workbuddy\models.json`。`scripts/configure-workbuddy.mjs` 会在加密备份后导入已通过基础工具测试的模型，并拒绝覆盖同名的其他服务模型。执行前须明确授权，不能对其他版本盲目使用。

```powershell
node scripts/configure-workbuddy.mjs "$env:USERPROFILE\.workbuddy\models.json" --workbuddy-compat
```

在任务页模型下拉列表内向下滚动，可找到自定义模型。保留默认工具权限，选择专用工作目录后再发送任务。配置文件内只有模型桥推理密钥，没有会员 OAuth 凭据；WorkBuddy 按自身格式保存该密钥，请勿分享其配置文件。

专用兼容模式需明确接受以下差异（本机用户已同意）。省略 `--workbuddy-compat` 使用严格接口，仍拒绝不支持的参数。

- 仅对已识别的连接探测（单条 `Reply with OK.`、流式、`max_tokens:1`）移除上游不支持的输出上限。仍调用指定的真实模型，**不保证上游仅生成 1 token**；等待完整成功再发回 SSE，防止客户端收到首段内容就误判成功。
- 仅对已识别的标题辅助请求，把 `reasoning_effort:none` 转为该模型目录支持的 `low`。这并非关闭推理，可能增加延迟和会员用量。其他请求不使用此规则。
- 响应头 `X-ModelBridge-Compatibility: workbuddy-v1` 标明专用模式；首个 SSE 块/完整 JSON 中的 `modelbridge.adjustments` 以及本机日志记录实际转换。失败不伪装成功，模型不回退。

配置脚本依据实际目录填写推理能力、默认档位及客户端支持的档位集合；对不能关闭推理的模型，使用 `onlyReasoning` 和 `canDisableThinking:false`，避免 WorkBuddy 在普通工具任务中发送 `none`。保留 `max` 等档位的同名映射；WorkBuddy 不支持的 `ultra` 不出现在客户端选择项中。更新后可重新选择模型以应用能力配置。

兼容已观察到的 WorkBuddy 回合标记、请求/消息编号、工具展示文字和用量统计，校验类型后作为客户端元数据处理；模型输入、工具参数和结果保持完整。未知字段继续拒绝，不能据此认为所有客户端扩展均已兼容。

## 运行

环境：Windows、Node.js 24 或更新版本、Windows PowerShell。当前没有第三方 npm 运行依赖。

在仓库目录运行：

```powershell
.\scripts\start.ps1
```

打开 <http://127.0.0.1:43821>，点击 **Continue with ChatGPT**，在官方页面完成登录和会员用量授权。回到验证台后刷新目录，再选择确切模型测试。调用消耗账号会员用量。

启动脚本在后台隐藏运行，保护 `.local` 目录；程序使用环境中已有的 HTTP 代理配置，不修改系统代理。`MODELBRIDGE_PORT` 可在启动前指定其他本机端口。

停止：

```powershell
.\scripts\stop.ps1
```

停止不会注销账号或删除加密凭据；正在进行的请求可能中断。正常情况下应先在验证台取消测试。断线后不自动重放工具。

命令行查询及测试：

```powershell
npm run status
node scripts/control.mjs refresh
node scripts/control.mjs verify <目录中的确切模型名> tools
node scripts/control.mjs verify <目录中的确切模型名> text
node scripts/control.mjs cancel
```

命令行调用通过本地管理密钥连接已有服务；不会打印会员令牌。`npm start` 可前台调试，首次运行推荐先使用启动脚本建立受保护的数据目录。

## 测试

```powershell
npm test
```

离线测试包含真实 Windows DPAPI、临时本机 HTTP 服务和模拟的上游边界；不会调用真实模型。真实验证可从验证台、明确的 `verify` 命令、`scripts/gateway-probe.mjs <模型名>` 或已配置的客户端发起。

## 本地数据与边界

`.local/` 全部排除在 Git 之外：加密账号凭据、本机控制密钥、主机标识、目录快照、验证记录和运行日志。不要将它们作为普通附件上传。未提供安装包、开机启动或远程监听。

现阶段使用官方公开 `https://api.openai.com/v1/responses`，不访问 ChatGPT backend-api，不切换到付费 API。会员可用模型、输入、工具和参数仍受账号与该通道规则限制。

## 官方接入依据

- [注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [账号模型目录与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [会员通道限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [函数调用](https://developers.openai.com/api/docs/guides/function-calling)
