# ModelBridge 管理流程整体改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户已授权实施；按任务持续记录进度，不因此自动派发其他聊天或子代理。

**Goal:** 在保留独立 Codex OAuth 网关的基础上，一次性完成八页管理界面的账号恢复、配额、模型同步、配置、诊断与验收流程。

**Architecture:** 保留现有 Node.js 网关和 DPAPI；从 `standalone-service.mjs` 按实际责任提取配置、账号状态、配额任务和运行记录模块。Chat 与 Responses 共用能力校验、错误分类和请求追踪；前端继续 React + Ant Design，所有操作依赖明确的后端契约。

**Tech Stack:** Node.js >=24、ES modules、node:test、React 19.3.1、Ant Design 6.7.0、Vite 8.3.8、Windows DPAPI。首轮不新增运行框架；新依赖必须先通过现有版本兼容检查。

**Spec:** [CLIProxyAPI 功能调查与差距报告](../../cliproxyapi-investigation-2026-11-14.md)。基线 ModelBridge 0.3.1 / `618b840`。本方案日期2026-11-14，状态：**实施中，T1已完成，T2进行中**。

## Global Constraints

- 仅 Codex；仅 OAuth；不做其他平台和上游 API 提供商。
- 无插件、插件商店或插件执行接口。
- 独立运行，不依赖 CLIProxyAPI 服务、二进制或整体软件包。
- 只移植必要代码，固定来源版本，保留 MIT 许可和变更说明。
- React + Ant Design，沿用现有八页；学习操作逻辑，不复制整套前端。
- 模型以当前账号官方目录为准；不静默换模型、删请求语义或改付费方式。
- 凭据由 ModelBridge 自己授权并以 Windows DPAPI 保存；不读取其他应用凭据。
- 本机使用；本方案不扩展为服务器部署、远程管理、安装包或开机启动。
- 首轮保持用户手动选择账号，不自动换号、不自动重试。只保留已经授权的两种 WorkBuddy 兼容转换。
- 测试只使用隔离文件和MCP夹具；不得通过真实业务工具制造副作用。

## 交付范围和阶段

“一次整体改造”指统一设计、统一契约、统一最终验收，不是一次提交所有未验证代码。每个任务保留可审查提交，所有核心任务完成后才宣布整版完成。

| 阶段 | 任务 | 交付与进入下一阶段的条件 |
| --- | --- | --- |
| I 公共基础 | T1–T2 | 配置迁移不丢数据；公共请求契约、错误来源、流式终止通过离线测试 |
| II 管理流程 | T3–T5 | 双授权、配额队列、目录与规则形成闭环；跨账号与过期数据不能串用 |
| III 后台整合 | T6–T8 | 日志统计、接入恢复、八页统一交互和设置备份实际可用 |
| IV 统一验收 | T9 | 自动测试、生产构建、真实模型矩阵和WorkBuddy原生复测通过，证据齐全 |

首轮明确不做：自动路由/权重、自动重试、WebSocket/服务端响应历史、推理恢复缓存、原始凭据导入导出、通用请求改写编辑器、自定义代理编辑、远程管理、额度券消费、付费设置修改、自动安装更新。它们不作为本轮隐藏依赖。

## Review Focus

1. **账号切换或重新授权时旧查询返回**：不得把A账号额度/目录/验证结果写到B账号；T3/T4/T5测试绑定账号与凭据版本。
2. **已有流式内容或工具调用后断网**：不得重发请求或伪造成功终止；T2/T9测试断流与重复执行计数。
3. **双窗口编辑、恢复旧配置或断电式写入失败**：不得覆盖较新配置或删除现有凭据；T1/T8测试版本冲突与原子恢复。
4. **缺失、未知或非常规配额窗口**：不得把未知当0、把过期当当前或错误标成5小时；T4测试时间与数值样本。
5. **客户端配置应用失败或新密钥尚未配置**：不得破坏其他配置，旧连接必须可恢复；T7/T9测试逐步失败与备份恢复。

## 文件责任与共同契约

以下名称是待实施的设计，不代表文件已经存在。

| 文件/模块 | 责任 |
| --- | --- |
| `src/settings-store.mjs` | 配置版本、校验、差异、原子保存、非敏感备份恢复 |
| `src/request-contract.mjs` | Chat/Responses公共预检、模型能力、已授权兼容转换 |
| `src/diagnostics.mjs` | 脱敏错误结构与用户恢复建议 |
| `src/account-state.mjs` | 双授权健康投影、账号/凭据版本关联；不保存明文令牌 |
| `src/quota-jobs.mjs` | 有界查询队列、取消、重复提交合并、逐项结果 |
| `src/model-catalog.mjs` | 账号目录快照、差异、规则预览、验证有效性 |
| `src/activity-store.mjs` | 脱敏请求记录、有限历史、游标分页与统计 |
| `src/client-access.mjs` | 本项目连接密钥轮换与WorkBuddy应用协调 |
| `web/src/features/*` | 按现有八页拆分组件；业务逻辑归属明确后逐页迁出大文件 |
| `web/src/components/*` | 统一筛选栏、批量结果、状态提示、差异确认和详情抽屉 |

全局身份：`accountKey`沿用现有vault键；`credentialRevision`为授权分区提交后的单调版本，不用token本体或其哈希作为公开标识。目录版本为`catalogRevision`，规则版本为`rulesRevision`。

请求记录：`RequestRecord={id,accountKey,credentialRevision,requestedModel,effectiveModel,profile,path,startedAt,finishedAt,httpStatus,outcome,failure?,adjustments,usage}`。`usage`只取上游实际返回的数字，未知字段为`null`；不记录提示词、工具参数/结果、令牌或授权回调。`id`在接受请求时生成，发送为`X-ModelBridge-Request-Id`，错误体使用同一编号。

错误契约：`Failure={requestId,source,category,code,httpStatus,param?,message,nextAction}`。`source`为`client|gateway|upstream|network`；`category`为`validation|authentication|quota|rate_limit|capacity|timeout|cancelled|network|internal`。保持真实HTTP状态；流式响应已开始后，HTTP200不能代表完成，使用终止事件与`outcome`判断。

共同配置：`ConfigSnapshot={schemaVersion:1,revision,values}`。`values`包含现有超时/摘要开关/模型规则，新增日志保留策略与SSE心跳；不包含凭据、连接密钥或官方域名覆盖项。默认保持现有超时；日志默认保留7天、50MiB或50,000条，以先到者为界；可关闭磁盘摘要。SSE心跳默认关闭，可选0–60秒，非零最小5秒，仅输出SSE注释，不伪造内容。配置修改与导入共用一次校验和原子提交。

管理API继续沿用自有`/api`与本机鉴权，不为复用上游前端实现整套`/v8/management`。新增查询用`POST /api/<resource>/read`，写操作显式携带`revision`；敏感内容不进入URL或浏览器持久存储。下面接口全部受现有管理鉴权保护。

## T1：统一配置与安全迁移

**Files:** 新增`src/settings-store.mjs`、`test/settings-store.test.mjs`；修改`src/standalone-service.mjs`、`src/http.mjs`、`test/standalone.test.mjs`。

**Interfaces:** `loadSettings(dataDir):Promise<ConfigSnapshot>`；`previewSettings(current,values):{changes,errors}`；`saveSettings(dataDir,{revision,values}):Promise<ConfigSnapshot>`；`exportSettings(snapshot):{schemaVersion,values}`；`restoreSettings(dataDir,{revision,document}):Promise<ConfigSnapshot>`。HTTP新增`settings/preview`、`settings/export`、`settings/restore`；保留已有read/save入口并迁移调用者。

- [x] 写离线测试：`stale_revision_keeps_current_and_draft`断言旧revision保存返回409且磁盘字节不变；`legacy_migration_preserves_values`断言原超时、日志开关、模型规则全部保留；`backup_has_no_secrets`递归断言无access_token/refresh_token/gatewayKey；`failed_write_keeps_last_valid`断言模拟rename失败后旧配置仍可读。
- [x] 执行`node --test test/settings-store.test.mjs`，确认新增契约尚未实现而失败。
- [x] 实现版本化单文件保存与旧配置一次性读取迁移；首次成功写入前保留旧文件备份，不覆盖DPAPI凭据；未知字段和非法规则拒绝整个提交。只接受项目自己的备份格式，拒绝CPA配置与任意路径。
- [x] 执行配置测试与`npm test`；通过后提交`feat: unify console settings and safe migration`。

**验收：** 两个标签页同时修改时，后保存者能看到冲突且草稿仍在；导入先预览，失败没有半份配置。

## T2：统一请求校验、错误定位与流式结束

**Files:** 新增`src/request-contract.mjs`、`src/diagnostics.mjs`、`test/request-contract.test.mjs`、`test/diagnostics.test.mjs`；修改`src/service.mjs`、`src/standalone-service.mjs`、`src/direct-adapter.mjs`、`src/compatibility.mjs`、`src/protocol.mjs`、`src/http.mjs`。

**Interfaces:** `prepareRequest({protocol,body,catalog,profile}):{body,model,adjustments}`，`protocol=chat|responses`，`profile=strict|workbuddy-v1`；`classifyFailure(error,{requestId,stage}):Failure`，`stage=validate|authorize|connect|stream`。每次请求捕获账号、凭据和配置快照，结束时不得读取另一个当前账号来记账。HTTP把共同请求编号带到客户端及日志。

- [ ] 写反例：严格模式不支持的`none`返回validation且上游调用次数0；同一目录能力在Chat/Responses得到一致结论；已授权WorkBuddy标题请求只产生`none→low`记录且模型不变；其他请求不移除token限制；缺失/重复工具编号被拒绝且不丢历史。
- [ ] 增加流式测试：已发工具调用后断网，上游调用次数严格为1；终止状态failed；取消后定时器与连接被释放。分别断言网络502、超时504、上游明确400/401/429，以及HTTP200内的失败事件被准确记录。
- [ ] 执行`node --test test/request-contract.test.mjs test/diagnostics.test.mjs`确认反例失败，再实现共同预检与结构化错误。基于目录能力处理差异，不硬编码八套模型规则；Responses仍拒绝store:true/previous_response_id。
- [ ] 选择性转写调查报告S15的原生Responses推理档位反例：顶层和历史配置更新逐项校验；有效档位保持原值；模型最低支持档不是low时不可硬编码low。仅在协议本来支持该输入类型时处理；不支持的历史更新项明确拒绝，不以移植为由扩大协议能力。上游自动降档策略替换为本项目严格/已授权兼容策略，并登记来源。
- [ ] 增加SSE注释心跳，受T1配置控制；不得改变JSON非流式响应格式，不引入自动重试；错误正文只保留脱敏允许字段。
- [ ] 执行上述测试、`test/compatibility.test.mjs`、`test/direct-adapter.test.mjs`、`test/protocol.test.mjs`及`npm test`；通过后提交`feat: unify request validation and actionable diagnostics`。

**验收：** 用户能从一次错误看到发生位置、字段和下一步；HTTP状态与模型名称没有被“修好”成不真实的信息。

## T3：账号双授权与恢复流程

**Files:** 新增`src/account-state.mjs`、`test/account-state.test.mjs`、`web/src/features/accounts/AccountsPage.jsx`；修改`src/auth.mjs`、`src/quota-auth.mjs`、`src/standalone-service.mjs`、`src/vault.mjs`、`web/src/account-panels.jsx`、`web/src/main.jsx`。

**Interfaces:** `projectAccountState(account,evidence,now):AccountHealth`；`AccountHealth={accountKey,credentialRevision,inference,quota}`；两个分区各含`state,expiresAt,lastRefreshAt,lastVerifiedAt,nextAction`，`state=missing|ready|expired|refresh_failed|sign_in_required`。`ready`仅说明当前凭据状态，不能代替调用/续期实测。现有登录接口保持，响应增加明确`purpose`与目标账号键。

- [ ] 写测试：配额授权取消仍保留模型授权；错误账号补充授权不改变任何已有凭据；迟到回调不能复活已取消授权；授权刷新只更新目标分区；A账号请求完成后切换B不改变A的证据归属；旧vault无revision可无损升级。
- [ ] 执行`node --test test/account-state.test.mjs test/quota-auth.test.mjs test/auth.test.mjs`确认新行为缺失，再实现投影和提交版本；刷新失败时区别临时网络故障与必须重登。
- [ ] 用Ant Design Steps＋Drawer实现统一向导：模型授权→配额授权→目录/验证→接入；允许第二步跳过并明确缺少的能力。定向恢复保留账号备注、排序和另一分区。
- [ ] 把账号详情、批量启停/刷新结果接入统一状态；执行相关测试与构建，通过后提交`feat: complete account authorization and recovery flow`。

**验收：** 同一账号只有一个管理入口；用户能分清“可以调用”和“可以查额度”；真实第二账号缺失时只标离线验证，不能制造真实多账号通过记录。

## T4：配额快照与可恢复批量查询

**Files:** 新增`src/quota-jobs.mjs`、`test/quota-jobs.test.mjs`、`web/src/features/quota/QuotaPage.jsx`；修改`src/vendor/codex-quota.mjs`、`src/standalone-service.mjs`、`src/http.mjs`、`test/quota.test.mjs`。

**Interfaces:** `createQuotaJob({accountKeys},context):{jobId}`；`readQuotaJob(jobId):{state,items}`；`cancelQuotaJob(jobId):{cancelled}`。`items`含目标accountKey/credentialRevision、`queued|running|succeeded|failed|cancelled`及脱敏结果；`QuotaSnapshot={accountKey,credentialRevision,checkedAt,freshUntil,status,windows,creditBalance,subscriptionActiveUntil,lastError}`，`status=current|stale|unavailable`。新增`quota-jobs/start|read|cancel`接口；当前单账号查询仍可用。

- [ ] 写测试：5小时/周/月/审查/附加额度；非常规时长以实际小时命名；缺少百分比为null；只有积分仍显示已知字段；时区与秒/毫秒时间；取消后迟到结果不提交；失败不覆盖上次成功值但状态变stale；不同账号相同显示名不串数据。
- [ ] 执行`node --test test/quota.test.mjs test/quota-jobs.test.mjs`确认新增边界失败，再实现查询队列。初期并发1，重复目标合并；凭据版本变化丢弃旧结果。默认5分钟后标过期，无后台自动轮询；恢复时间到达提示重新查询，不把余额改成100%。
- [ ] UI提供刷新所选/筛选结果、进度、取消、仅重试失败项；统计结果区分成功/失败/取消。过期值排在有效值之后，低额度筛选只使用有效百分比。
- [ ] 可选订阅到期只读查询必须独立超时和失败隔离；官方未返回时显示未返回，不阻塞主配额。不得请求消费、兑换或修改付费设置的接口。
- [ ] 执行相关测试与构建，通过后提交`feat: add reliable quota snapshots and batch progress`。

**验收：** 一项失败不吞掉其余结果；关页后再打开可看到当前任务；服务重启将未完成任务明确标为中断，不自动重试查询。

## T5：模型目录、规则和验证证据的统一版本

**Files:** 新增`src/model-catalog.mjs`、`test/model-catalog.test.mjs`、`web/src/features/models/ModelsPage.jsx`；修改`src/standalone-service.mjs`、`src/probe-jobs.mjs`、`web/src/operation-panels.jsx`、`src/http.mjs`。

**Interfaces:** `diffCatalog(before,after):{added,removed,changed}`；`previewModelRules({catalog,rules}):{effectiveModels,changes,errors}`；`verificationKey({accountKey,credentialRevision,catalogRevision,rulesRevision,adapterVersion,model,scenario}):string`。规则保存沿用T1原子配置；新增`models/preview`，目录读取增加版本、账号与更新时间。

- [ ] 写测试：目录刷新失败保留旧快照但标过期；别名冲突/循环或指向不可选模型保存失败；规则调整使相关旧报告失效但不删除历史；切换账号不继承另一账号的通过标记；新增可用模型进入待验证集合。
- [ ] 执行`node --test test/model-catalog.test.mjs`确认失败，再实现差异/预览/有效性判定。精准标明“当前可选”“官方声明”“本版本实测”，不把静态公共目录当权限。
- [ ] 模型页实现详情、规则草稿、影响预览和保存回读；为客户端页提供新增/移除/已失效模型清单；工作区草稿不因后台刷新覆盖。
- [ ] 执行模型、账号切换和规则相关测试及构建，通过后提交`feat: connect model catalog rules and verification evidence`。

**验收：** 用户能看到改规则会影响哪些客户端条目；历史通过不再冒充新账号、新规则或新适配器已经通过。

## T6：日志、错误诊断与有期限的本机统计

**Files:** 新增`src/activity-store.mjs`、`test/activity-store.test.mjs`、`web/src/features/logs/LogsPage.jsx`、`web/src/features/overview/OverviewPage.jsx`；修改`src/service.mjs`、`src/standalone-service.mjs`、`src/http.mjs`、`web/src/console-utils.mjs`。

**Interfaces:** `appendActivity(record):Promise<void>`按请求ID去重；`queryActivity({cursor,limit,filters}):{items,nextCursor}`，limit上限200；`summarizeActivity({from,to,filters}):{requests,successes,failures,cancelled,knownUsage,unknownUsageCount}`；`exportDiagnostics({from,to,filters}):object`。新增`activity/read|summary|export`接口。

- [ ] 写测试：重复完成事件只计一次；未知token保持null且不算0；日志关闭后新记录不落盘；达到容量/期限后按旧记录淘汰；损坏末行可隔离而非清空全部；导出中不出现测试注入的token/回调/用户正文；分页无重复无漏项。
- [ ] 执行`node --test test/activity-store.test.mjs`确认失败，再实现按日JSONL追加、串行写入、游标分页与容量清理；重启重建索引。旧100条记录可以迁入，但注明统计起点，不能倒推更早用量。
- [ ] 概览显示时间范围、成功/失败/取消、主要错误类别；日志详情显示T2错误来源和转换记录。系统事件与模型请求分标签，暂停只暂停显示不阻止记录。使用Ant Design统计/表格，趋势采用简单可访问图形，不额外引入完整BI库。
- [ ] 执行相关测试与构建，通过后提交`feat: add bounded request history and useful diagnostics`。

**验收：** “今日统计”不再只是最近100条的别名；保留上限截断时显示覆盖范围；官方会员配额不由本机统计推算。

## T7：客户端接入预览与可恢复连接密钥轮换

**Files:** 新增`src/client-access.mjs`、`test/client-access.test.mjs`、`web/src/features/clients/ClientsPage.jsx`；修改`src/client-config.mjs`、`src/workbuddy-config.mjs`、`src/vault.mjs`、`src/http.mjs`、`src/server.mjs`。

**Interfaces:** `previewClientUpdate({catalog,evidence,existingConfig}):{changes,warnings}`；`beginKeyRotation():{rotationId}`；`applyKeyRotation({rotationId,expectedClientRevision}):{state,backupId}`；`rollbackKeyRotation(rotationId):{state}`。密钥仍在DPAPI，接口和日志只返回标识；显式复制密钥复用现有受鉴权复制操作。

- [ ] 写测试：其他WorkBuddy模型/配置原样保留；不再可选的自有条目先进入备份；配置并发变动返回409；写入失败不撤销旧密钥；重启可恢复轮换状态；备份文件不能解密时禁止覆盖现有配置。
- [ ] 执行`node --test test/client-access.test.mjs test/client-config.test.mjs test/workbuddy-config.test.mjs`确认新契约缺失，再实现两阶段轮换：生成新密钥→预览/应用自有客户端配置→连接验证→显式完成轮换撤销旧密钥；未完成可回滚。轮换期间旧/新密钥并存必须在界面清楚标识，不能悄悄留下永久旧密钥。
- [ ] 页面提供普通接口/WorkBuddy接口区别、目标模型、配置差异、连接结果和恢复入口。只更新本项目条目，不安装或重置WorkBuddy。
- [ ] 执行接入相关测试与构建，通过后提交`feat: make client setup and key rotation recoverable`。

**验收：** 接入失败可以恢复原配置；测试通过不等于用户已经完成撤销旧密钥，状态必须如实显示。

## T8：八页交互统一、设置与系统收尾

**Files:** 新增`web/src/components/{PageStatus,BatchResults,ChangeReview}.jsx`、`web/src/features/settings/SettingsPage.jsx`、`web/src/features/verification/VerificationPage.jsx`、`test/console-state.test.mjs`；修改`web/src/main.jsx`、`web/src/style.css`、`web/src/console-utils.mjs`、`src/http.mjs`。

**Interfaces:** `PageStatus({state,error,onRetry})`，`state=loading|ready|empty|partial|stale|failed`；`BatchResults({items,onRetryFailed,onCancel})`使用T4相同项目状态；`ChangeReview({changes,revision,onConfirm,onCancel})`使用T1差异与版本。页面异步响应必须核对目标账号与操作版本，过期响应不得覆盖新页面。

- [ ] 给纯状态逻辑写测试：保存冲突保留草稿；切页后的迟到响应被丢弃；批量失败只重试失败项；取消不触发重复保存。执行`node --test test/console-state.test.mjs`确认失败，再实现共享状态与组件。
- [ ] 设置页分为运行、日志、模型规则摘要、备份恢复、系统信息；表单与受限JSON文本共用T1校验，先差异预览再保存。输入格式错误不破坏可视化草稿，离开未保存页面有提醒。
- [ ] 系统信息显示本项目版本/commit、Node版本、本机地址、运行时间、脱敏网络模式、已支持/未支持能力。手动检查仅查询ModelBridge公开发布元数据，若无发布则如实显示；不下载执行文件，不访问账户信息接口。
- [ ] 验证页增加按“模型×场景”的当前有效结果矩阵、预计操作内容、取消与错误详情；显示测试会使用会员用量。普通管理刷新不得隐式触发推理测试。
- [ ] 使用真实浏览器走完八页；检查加载/空态/错误/部分成功/过期、键盘焦点、窄屏横向表格、控制台错误；执行`npm test`与`npm run build`。通过后提交`feat: unify console workflows and system settings`。

**验收：** 任何启用按钮都有实际后端能力；每一页的刷新、编辑、保存、失败恢复规则一致；无需增加第九个空页面。

## T9：整体验收、文档与发布提交

**Files:** 修改`scripts/verify-standalone.mjs`及必要的现有隔离夹具；新增`docs/console-upgrade-verification.md`；更新`README.md`、`docs/current-state.md`、`THIRD_PARTY_NOTICES.md`和本方案勾选状态。

- [ ] 在T1–T8全部通过后执行`npm test`、`npm run build`；记录真实测试数量和版本，不预写“全通过”。
- [ ] 执行下表真实验证；每项记录模型、账号匿名标识、版本、请求/工具次数、最终状态和证据路径。用当前官方可选目录生成矩阵；基线8模型若发生变化必须注明，不能固定填8个通过。
- [ ] 验证服务未连接8317、未读取CPA配置/凭据，项目依赖中无CPA整体包；采用进程/连接观测和受控网络测试，不擅自停止用户其他程序。
- [ ] 对实际移植代码补齐来源、固定版本、删减范围与许可；所有公开报告剔除账号个人信息、token、完整回调与原始对话。
- [ ] 自查差异、数据迁移、秘密扫描和文档链接；验证工作树只包含本轮目标改动。按有效的提交推送授权推送，并核验远端提交与本地一致。

### 最终验收矩阵

| 范围 | 必测条件 | 通过标准 |
| --- | --- | --- |
| 全部当前可选模型 | 文本、工具、文件、真实stdio MCP，每模型各一项 | 工具真实执行且结果返回模型；不换模型，不伪造成功 |
| 全部当前可选模型长会话 | 每模型12轮，夹具内容约64KiB，穿插工具与回忆检查 | 内容与工具结果正确；无新增适配导致的400 |
| 代表模型更长压力 | 既有代表模型24轮；请求规模达到至少350,495字节 | 无丢历史/重复工具；若官方上下文限制触发，准确归因，不宣称通过该压力档 |
| WorkBuddy原生 | 连接按钮、标题辅助、全新任务、保留的旧长会话 | UI显示连接成功；文件与MCP闭环正确；请求记录能关联 |
| 双授权/配额 | 现有真实账号查询、重启再查；取消/过期/账号不匹配用隔离测试 | 两分区不互相破坏；真实与模拟证据分开 |
| 多账号边界 | 至少两个模拟账号的查询/切换/迟到响应；有第二个自有授权账号才真实复测 | 无串号；没有真实第二账号时明确标未实测 |
| 错误反例 | none、token上限、非法schema/历史、401/429/5xx、断流/取消 | 应拒绝的请求被准确拒绝；不要求这些用例返回200 |
| 配置与恢复 | 双标签页冲突、导入非法配置、写入失败、重启 | 不丢凭据、不覆盖新值、失败草稿可恢复 |
| 客户端轮换 | 新密钥失败、配置修改冲突、回滚、完成撤销 | 原配置可恢复，其他条目不变，旧密钥最终状态明确 |
| 页面 | 八页主要动作与所有数据状态，桌面/窄屏 | 无无效按钮、草稿丢失、重复提交和浏览器错误 |
| 日志与统计 | 未知usage、重复事件、过期清理、秘密注入扫描 | 口径真实、有容量边界、无凭据/正文泄漏 |

不能保证所有未来请求永远没有400。验收承诺是：支持范围内的固定场景通过；无效或不支持的请求有准确归因；不通过改变模型和隐瞒语义变化“消除报错”。

## 延后能力及重新启动条件

| 能力 | 何时值得做 | 独立验收重点 |
| --- | --- | --- |
| 多账号自动调度 | 确有多个自有账号和明确切换需求 | 会话与账号隔离、同模型可用性、冷却与可解释选择；默认仍固定账号 |
| 有限重试 | 错误统计证明主要问题来自可恢复连接故障 | 首次输出前、安全错误类别、总时限/次数、无重复工具执行 |
| WebSocket/响应历史 | 目标客户端确实需要previous_response_id等能力 | 断线、取消、账号切换、缓存隔离、服务重启与内存界限 |
| 自定义代理编辑 | 现有环境代理不能满足实际连接需求 | 登录与推理代理一致性、秘密脱敏、配置回退 |
| ProComponents/图表库 | 现有Ant Design造成明确重复代码或展示限制 | 与React19/AntD6兼容、构建体积、键盘与窄屏验证 |
| 其他语言/远程管理/安装包 | 用户明确扩大产品范围 | 单独规格，不挤入本轮收尾 |

## 覆盖核对与回退

- A01→T6/T8；A02–A04→T3；A06→T8；A07→T5；A08–A11中的只读部分→T4；A12–A13→T1/T8；A15→T2/T6；A16–A18→T7/T8。
- B01–B05范围内的公共兼容→T2/T5；B09–B10→T2；B12→T3；B13→T5；B14→T7；B15/B17→T6；B16首轮只读诊断→T8。
- 报告明确排除或后续的行不生成空控件；A14/B06–B08/B11等仅保留后续条件。
- 新配置迁移前保存旧本项目配置，凭据结构采取增量字段，不删除原授权；恢复旧代码前先检查vault格式兼容。不可直接用旧二进制覆盖新数据来冒充回退成功。
- 最终报告必须同时列已完成、未验证和不在本轮范围，不把“自动测试通过”当作所有真实账号/套餐都验证过。

本轮已获整体实施授权。从T1开始，顺序推进并维护本文件的任务状态，不再按临时出现的页面按钮零散扩展范围。
