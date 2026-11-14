# 订阅到期查询验收（0.4.1）

2026-11-14，Asia/Shanghai。基线 `c3e698e`，在原有配额流程内补齐官方订阅到期查询；不依赖CLIProxyAPI服务，不导入其他应用凭据。

## 来源与实现范围

核对了CLIProxyAPI官方管理中心固定提交 `3d893ec88938c3ceef200a15be6af8cf972564b3` 的 [data.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/quota/providers/codex/data.ts) 和 [constants.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/utils/quota/constants.ts)。

选择性转写：`GET https://chatgpt.com/backend-api/subscriptions?account_id=...`、相同账号授权请求头、`active_until`/`activeUntil`解析、8秒可选查询超时及失败隔离。来源与MIT许可见[第三方说明](../THIRD_PARTY_NOTICES.md)。没有复制管理API转发、凭据文件读取、令牌元数据回退、积分兑换或修改订阅逻辑。

ModelBridge直接使用自有配额OAuth凭据，与主配额并发读取。只保存标准化日期、安全状态和查询时间；不保存完整响应。响应限64KiB、禁止重定向、支持取消，主查询失败时终止可选请求。账号变更仍受原查询期间的保护约束。

时间支持ISO含时区、秒/毫秒时间戳，统一为UTC ISO后在页面按本机时区显示；空值、0、无时区、非法日期不推算。未从token有效期、套餐名称或额度恢复时间估算订阅到期。

## 页面行为

点击现有“刷新配额”或批量刷新即可同时查询，无需新增登录。显示到期时间、查询时间；区分尚未查询、官方未返回、超时和HTTP失败。失败时保留上次成功日期并明确标“历史记录”，当前日期字段不会冒充最新结果。5分钟过期规则沿用配额快照。

若官方返回过去时间，显示“官方返回时间已到达，不据此判断调用权限失效”。不因此停用账号或禁止模型调用，也不推断自动续费、取消或付款状态。订阅查询失败不会将成功的额度窗口标成失败，但整体刷新最多等待这次可选查询的8秒上限。

## 验证证据

- 新增10项自动测试；先观察缺失查询/状态导致失败，再实现通过。完整回归 **106/106通过**，生产构建通过。
- 覆盖秒/毫秒/ISO、缺失和非法日期、账号绑定/凭据隔离、401/异常响应不污染主配额授权、历史快照、取消后不落盘、8秒策略的缩短计时测试、主查询失败取消子请求、超大响应、界面状态与过去日期提示。
- 已有自有账号真实查询：配额及订阅接口均成功，官方确实返回了日期。该日期在查询时已过去，未改写成未来日期；私人账号具体日期仅保留在本机证据，不写入公开仓库。
- 浏览器点击“刷新配额”完成1/1，页面显示日期和过去时间说明；新构建观察期间没有浏览器错误或警告。
- 重启后先核对磁盘恢复的日期与查询时间，再重新向官方查询，两次结果一致。
- `gpt-6.1-sol`真实基础工具回归通过：2次请求、1次工具执行。说明此次返回过去日期未影响模型调用；本次未重复全部模型长会话，既有整体验收仍见[0.4.0报告](console-upgrade-verification.md)。

本机忽略文件：`.local/subscription-tests.log`、`subscription-build.log`、`subscription-acceptance.json`、`subscription-before-restart.json`、`subscription-restart.json`、`subscription-tool-regression.json`、`subscription-console.jpg`。不提交凭据、真实账号标识、订阅响应正文或私人截图。

## 边界

真实验证使用一个已有账号；其他套餐、无订阅日期、网络超时和401等以离线夹具覆盖。官方未返回日期时只显示未返回。该官方会员接口可能变化，失败会显示原因并保留历史；不会调用CLIProxyAPI或使用其他应用凭据补救。
