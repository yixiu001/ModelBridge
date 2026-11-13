# CLIProxyAPI 功能调查与 ModelBridge 差距报告

调查日期：2026-11-14（Asia/Shanghai）。结论状态：**调研完成，修改方案待评审，尚未实施**。

## 1. 结论与建议

ModelBridge 已经能完成 Codex 登录、模型调用、WorkBuddy 接入、工具与长会话验证，也已能独立读取配额。但它目前更接近“可用的本机网关加验证面板”，距离 CLIProxyAPI 管理中心的日常管理体验，主要差在以下五条完整流程：

1. **账号从登录到失效恢复**：让用户知道账号能否调用、能否查额度、是否需要重新登录，以及下一步该做什么。
2. **配置从编辑到生效**：统一草稿、差异预览、并发冲突、保存回读和恢复，避免各页分别实现。
3. **错误从发现到定位**：明确是哪一环、哪个字段、哪个账号发生问题，特别是区分不同来源的 400。
4. **模型从目录到客户端**：目录变化、别名与禁用、验证状态、WorkBuddy 配置同步形成连续流程。
5. **运行状态从快照到历史**：配额的新鲜度、请求趋势、错误分类和历史记录有统一、准确的口径。

建议先按配套方案完成这五条流程，再考虑多账号自动调度或 WebSocket。不要把 CLIProxyAPI 的所有开关都放进页面，也不要以“按钮数量相同”为验收标准。

继续使用 **React + Ant Design**。借鉴官方管理中心的操作规则，按需移植纯逻辑与测试；保留自己的后端与加密存储。当前不引入 CLIProxyAPI 服务、程序或整体包。

## 2. 调查对象、版本和证据范围

| 对象 | 本次固定基线 | 作用 |
| --- | --- | --- |
| CLIProxyAPI 后端 | 最新发布 v8.0.69；本次阅读 main `1aaf56bc6a0fc6fce19049ba7ae8554c882304a6` | 请求适配、OAuth、路由、配置、管理接口 |
| 官方管理中心 | 最新发布 v1.28.0；`3d893ec88938c3ceef200a15be6af8cf972564b3` | 页面、交互、配额读取、配置编辑 |
| ModelBridge | 0.3.1；`618b84056e2f9311476562f85f3e3c6b7728b788` | 当前产品对照基线 |

GitHub 查询快照中，后端为 **58,495 stars**，管理中心为 **4,793 stars**。这说明关注度较高，不能据此证明所有功能都稳定或适合本项目。[后端仓库](https://github.com/router-for-me/CLIProxyAPI)、[管理中心仓库](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)

本次检查了官方 README、配置模板、v8 管理接口、前端全部主路由，以及账号、OAuth、配额、配置、路由、仪表盘、日志、系统页面的相关源码；对 Codex 参数处理、重试分类、推理历史恢复和相关回归测试进行了重点检查，并查阅了公开问题记录。下文的 S 编号对应文末固定版本来源。

这是**公开功能面与关键实现的源码调查**，不是逐行安全审计，也不是上游所有功能的真实运行验收。本轮没有重新登录、调用模型、修改 WorkBuddy、安装依赖或改业务代码。ModelBridge 已通过的测试引用现有验收记录，不能当成本轮新跑的结果。

## 3. 已确定的产品边界

- 仅 Codex；仅 OAuth；不做其他平台和上游 API 提供商。
- 无插件、插件商店或插件执行接口。
- 独立运行，不依赖 CLIProxyAPI 服务、二进制或整体软件包。
- 只移植必要代码，固定来源版本，保留 MIT 许可和变更说明。
- React + Ant Design，沿用现有八页；学习操作逻辑，不复制整套前端。
- 模型以当前账号官方目录为准；不静默换模型、删请求语义或改付费方式。
- 凭据由 ModelBridge 自己授权并以 Windows DPAPI 保存；不读取其他应用凭据。
- 本机使用；本方案不扩展为服务器部署、远程管理、安装包或开机启动。

**客户端连接密钥与上游 API 提供商密钥不同**：前者保护 WorkBuddy 到 ModelBridge 的连接，仍属于本项目；后者涉及另一条模型服务接入路径，明确排除。

## 4. 功能全景与取舍

标记：**已有**＝本地代码有实现；**部分**＝已有基础但流程不完整；**缺少**＝本地尚无；**排除**＝产品主动不做；**后续**＝记录完整方案，但不进入首轮改造。源码有实现不等于已实测所有组合。

### 4.1 后台页面与操作

| 编号 | 上游能力 | ModelBridge 现状 | 建议 | 证据 |
| --- | --- | --- | --- | --- |
| A01 | 仪表盘汇总连接、版本、模型、凭据健康与近期流量 | 部分：基本数字与最近请求；统计只有最近100条 | 补账号健康摘要、明确时间范围、失败趋势和快捷处理入口 | S1、S4 |
| A02 | OAuth 发起、等待、取消、回调、定向恢复 | 已有基础；模型和配额授权分散在两页 | 统一账号向导，分别显示两项授权结果，失败可续做 | S2、S5 |
| A03 | 凭据搜索、筛选、启停、删除、详情、批量处理 | 已有大部分；真实多账号未完整验收 | 统一批量进度、逐项结果、失败重试与取消；不改变选中账号 | S2、S5 |
| A04 | 令牌过期、刷新计划、必须重登、推理验证和续期验证状态 | 部分：刷新与错误基础能力，缺少完整状态面板 | 区分“已保存”“调用成功”“自动续期成功”，避免一个绿色标签代表全部 | S2 |
| A05 | 凭据上传、下载、字段编辑 | 缺少原始导入导出 | 不复制明文凭据下载；首轮只备份非敏感配置 | S2 |
| A06 | 多种卡片布局、筛选、详情侧栏 | 当前以表格为主 | 优先统一表格筛选、批量栏和详情抽屉；不照搬多套布局 | S3、S5 |
| A07 | 模型排除、别名、账号模型查看与目录同步反馈 | 已有精确禁用/别名/验证失效；目录变化反馈弱 | 增加目录前后差异、账号范围、规则冲突和接入影响预览 | S3、S5、S11 |
| A08 | 配额按账号/提供商查看、刷新、额度窗口与恢复时间 | 已有 Codex 主要读取和筛选 | 补新鲜度、刷新队列、失败保留历史但标过期、恢复倒计时 | S6 |
| A09 | Codex 订阅到期时间与附加额度信息 | 已有窗口/积分；未读取订阅到期时间 | 到期时间列为可选补充；字段缺失或权限不足不使主配额失败 | S6 |
| A10 | Codex 额度重置券、消费重置券、积分超额消费设置 | 未实现 | 排除消费与设置修改；不因“配额功能”引入额外消费操作 | S6 |
| A11 | 配额时间线、分组与布局 | 缺少聚合展示 | 在有真实窗口时增加恢复时间列表；不编造未返回的5小时窗口 | S6 |
| A12 | 可视化设置与源码编辑、搜索、差异预览 | 部分：仅超时和摘要保存，已有差异确认 | 建立本项目统一配置模型，表单＋受限JSON编辑共用校验 | S7 |
| A13 | 配置冲突检测、草稿恢复、保存回读 | 已有版本冲突基础；失败后重新读取可能覆盖草稿 | 保留草稿；明确重载/重新应用，保存成功后以服务端回读为准 | S7 |
| A14 | 路由策略、优先级分层、权重及预览 | 固定账号；“priority”仅列表排序 | 首轮明确固定账号语义；自动调度列为后续，不能把排序伪装成路由 | S8 |
| A15 | 日志刷新、搜索、滚动、隐藏管理流量、错误文件下载 | 部分：最近100条摘要、筛选/暂停/导出 | 增加游标分页、错误类别、请求编号和脱敏诊断包 | S9 |
| A16 | 系统版本、构建信息、模型目录刷新、检查更新 | 只有版本文字和分散入口 | 补运行信息、版本来源、手动检查本项目发布信息；不自动安装 | S11 |
| A17 | 多语言、响应式、统一加载与错误状态 | 简体中文、Ant Design 基础 | 首轮完善窄屏、键盘、空态/错误态；其他语言后续 | S1、S3 |
| A18 | 管理登录与客户端鉴权分离 | 已有本机管理会话和推理密钥隔离 | 保持；不复制浏览器可逆混淆保存管理密钥的做法 | S1、S2 |
| A19 | API 提供商工作台、赞助快捷接入、插件页面 | 无 | 排除，不保留空导航或假开关 | S1、S3 |

### 4.2 网关与运行能力

| 编号 | 上游能力 | ModelBridge 现状 | 建议 | 证据 |
| --- | --- | --- | --- | --- |
| B01 | 多种客户端协议与流式/非流式转换 | Chat Completions 与无存储 Responses | 保留现有协议范围，统一共同参数与错误契约 | S12、S13 |
| B02 | 工具消息转换、编号处理、完整历史重建 | 已选择性移植并验证 | 保留共用适配器；扩展反例，避免按模型复制整套规则 | S12、本地验收 |
| B03 | 按模型能力处理推理档位等参数 | Chat 有校验；Responses 主要转发，路径不完全统一 | 建立“协议→公共规则→目录能力→授权兼容项”的统一流程 | S13、S15、本地源码 |
| B04 | 小输出上限自动调整、请求字段过滤/覆盖 | 仅 WorkBuddy 特定探测/标题转换 | 只保留已授权转换，其他变化显式拒绝或作为独立待决策项 | S13 |
| B05 | 按条件匹配的默认值/覆盖/过滤规则 | 无通用规则编辑器 | 首轮只显示现有兼容规则与触发记录；不开放任意删除字段脚本 | S10 |
| B06 | 多账号轮询、加权轮询、优先填充 | 无自动调度 | 后续：优先做固定账号和可解释候选预览，再考虑同模型切号 | S8、S10 |
| B07 | 会话保持、父子会话关联、故障迁移 | 无自动调度，也无会话缓存 | 后续；需要可靠会话标识与账户隔离，不能靠猜测串接会话 | S8、S10 |
| B08 | 重试次数、候选账号限制、冷却与重置 | 不自动重试 | 首轮补错误分类；后续才加有边界的重试，禁止重放已交付工具调用 | S10、S14 |
| B09 | 区分账号额度耗尽、模型容量、短期限流 | 保留上游错误，缺少统一用户状态 | 首轮明确分类与恢复建议，不能见到429就认定余额为零 | S14 |
| B10 | SSE 心跳、首字节前重试、连接与超时控制 | 有流式、取消、总超时；无独立心跳策略 | 加入受控心跳与故障可观测性；重试仍默认关闭 | S10 |
| B11 | WebSocket、响应链、推理历史恢复、压缩相关处理 | 不支持 previous_response_id/store:true；无推理恢复缓存 | 后续专项；不能只复制一个路由或缓存函数就宣称支持 | S12、S16 |
| B12 | Codex 原生与 SIWC 两类授权及绑定 | 自有模型授权＋补充配额授权 | 借鉴分区状态和身份绑定；不在本轮改模型调用通道 | S2、S13 |
| B13 | 模型目录来源、刷新、保留最后有效版本 | 官方账号目录；缺少可见的新旧差异 | 展示来源/账号/更新时间；失败保留标记过期的快照，不称实时可用 | S10、S11 |
| B14 | 客户端访问密钥管理 | 单个自有密钥，可复制 | 增加显式轮换和 WorkBuddy 更新预览；多密钥权限系统后续 | S2、S10 |
| B15 | 使用量事件、近期流量、持久化基础设施 | 仅最近100条请求摘要；未持久统计实际token | 增加有期限的本机统计，未知token不填0，不等同会员剩余额度 | S2、S4、S10 |
| B16 | 全局/凭据/登录代理、网络调优 | 启动沿用环境代理，无界面配置 | 首轮显示脱敏网络模式并诊断；自定义代理配置后续 | S10、S17 |
| B17 | 请求日志、应用日志、错误记录及容量限制 | 脱敏摘要；缺少容量策略和系统事件 | 补保留期限/大小限制；不复制记录完整对话的默认方案 | S9、S10 |
| B18 | TLS、远程管理、发现服务、容器与多平台发布 | 仅本机 Windows | 排除本轮，不改变监听范围 | S10 |
| B19 | Home/Redis/并发协调、SDK、自定义执行器 | 无 | 排除；不是个人本机产品的必要底座 | S2、S10、S12 |
| B20 | 图像/实时等扩展、多提供商协议及插件扩展 | 非本轮目标 | 不把“Codex账号可登录”解释为这些能力全部可用 | S10、S12 |

### 4.3 ModelBridge 应继续保留的专属能力

| 能力 | 保留原因 |
| --- | --- |
| WorkBuddy 原生接入、修改预览、加密备份 | 官方通用管理中心不等同于本机 WorkBuddy 配置向导 |
| 隔离文件、stdio MCP、长会话验证与报告 | 连接成功不能证明工具能执行并把结果带回模型 |
| 官方声明与实际验证分别展示 | 单个模型跑通不能证明所有模型、参数和长会话都通过 |
| 严格接口与已授权 WorkBuddy 兼容接口区分 | 保留对请求语义的可解释性 |
| 自有 DPAPI 凭据存储 | 不为了前端功能对齐而改成明文凭据下载和浏览器存储 |

## 5. 400 问题：上游能借鉴，但不能照搬结论

### 5.1 “公共规则”是正确方向，但不是“一次通过永远全通”

应公用的是协议解析、工具历史配对、错误分类和兼容策略；不同模型支持哪些档位、参数及上下文范围，仍须从能力目录读取。建议结构是：**一套处理流程＋模型能力数据＋少量明确命名的客户端兼容项**，而不是每个模型一套分支。

当前需优先检查 Chat 与 Responses 的校验一致性：本地源码显示两个入口不是完全相同的预检路径。这是明确的结构差距，但本次没有新执行请求，不能据此断言它已经造成某一次真实报错。

### 5.2 CLIProxyAPI 自己也有同类问题记录

公开问题 [#7478](https://github.com/router-for-me/CLIProxyAPI/issues/7478) 报告了 v8.0.67 中 GPT-6 系列的 Responses 请求携带 `reasoning.effort=none` 被透传，随后上游返回400。查询时该问题已关闭。继续追踪固定版本源码，确认已经加入`normalizeNativeResponsesEffortDoc`，在原生Responses分支之前按模型能力校验顶层及历史配置更新中的推理档位；专门回归测试覆盖了`none→low`、有效档位不变以及使用模型实际最低档而非硬编码low等情况。**因此这里有可借鉴的现成修复，不应把旧问题报告当作当前版本仍然有同一缺陷的证据。** 本次确认的是源码与测试内容，未运行上游测试或所有真实账号组合。[S15]

适合借鉴的是“每条协议路径都按同一能力契约校验”及其反例；ModelBridge普通接口仍应按自己的严格策略拒绝不支持档位，只有已授权兼容请求才转换。不能把上游的自动降档行为直接扩大到所有请求。

### 5.3 某些“解决400”的办法会改变请求含义

上游 Codex 原生请求处理中，会把1至15的正整数输出上限提高到16；SIWC路径还有部分字段删除和配置项转换。这些处理有其通道背景，但可能改变用户期望的长度、采样方式或缓存行为。它们不是可以给全部模型直接套用的通用修复。[S13]

尤其不能把“原生 Codex 最小16”的规则直接应用到 ModelBridge 当前会员通道。不同授权、不同上游路径的约束必须分别验证；继续保留已授权的 WorkBuddy 特定兼容行为，任何新增转换都列出输入、实际变化、原因与影响。

### 5.4 改造后的错误必须让用户看懂

例如：“请求中的关闭推理选项不受当前模型支持；错误发生在发送前；普通接口没有修改它。”或“上游拒绝了工具结果：找不到对应调用编号；请检查客户端保留的历史。”同时提供请求编号、来源、字段路径和可操作建议。

参数不合法、缺少工具结果、模型不可用、授权失败、额度耗尽、网络中断是不同问题，不能都显示成“连接失败”或通过换模型掩盖。

## 6. 账号与配额应该如何整理

上游把原生 Codex 凭据与 SIWC 作为同一账号下的授权分区处理；ModelBridge 当前从模型调用授权开始，再补配额授权。这个次序差异不需要通过重写整个网关消除。[S2]

推荐界面统一为“添加 Codex 账号”流程：

1. 完成模型调用授权，立即保存并显示调用授权状态。
2. 引导补充配额授权，明确这是同一账号的第二项能力；取消不撤销第一步。
3. 两项分别验证身份和状态；配额授权失败不等于模型调用失效。
4. 查看目录、主动进行一次工具验证、按需写入 WorkBuddy。

配额页显示“查询时刻的快照”，不是实时余额。查询失败时可以显示上次成功值，但必须同时标为过期，不能继续作为可用额度参与排序或自动决策。官方未返回的窗口和到期时间显示“未返回”，不补算。恢复时间到达只表示可以再查询，不能直接把百分比改为100%。

现有解析器已支持常见窗口、审查额度和附加额度；下一阶段应补充非常规窗口时长、只有积分没有百分比、未知百分比等契约样本，确认界面不会错误命名或把未知当零。以上是待验证边界，不冒充已复现的线上缺陷。

## 7. 界面与组件方案

保留八个导航：**概览、Codex账号、账号配额、模型目录、客户端接入、调用验证、运行日志、设置与系统**。

| 页面 | 主要操作与改造结果 |
| --- | --- |
| 概览 | 当前账号与授权健康、配额更新时间、今日请求与失败趋势；直接跳到具体问题 |
| Codex账号 | 搜索/筛选→选择→批量操作；详情抽屉包含两项授权状态、验证记录和恢复入口 |
| 账号配额 | 筛选→刷新所选/筛选结果→逐项结果；窗口、恢复时间、过期提示与低额度排序 |
| 模型目录 | 官方目录→能力与实测结果→规则草稿→影响预览→保存→客户端同步 |
| 客户端接入 | 地址/连接密钥→连接检查→WorkBuddy配置差异→应用/恢复；不覆盖其他配置 |
| 调用验证 | 选择模型与场景→查看用量提示→执行/取消→结果矩阵；失败关联诊断 |
| 运行日志 | 时间/模型/账号/来源筛选→请求详情→脱敏导出；应用事件与推理请求分标签 |
| 设置与系统 | 分组表单→查看改动→保存回读；配置备份/恢复、运行版本、限制和手动检查更新 |

统一操作规则：刷新不覆盖未保存草稿；批量操作明确作用范围；异步失败保留已成功项目；危险操作确认具体对象；切换页面和重试不重复提交；“未授权、加载中、空数据、部分成功、过期、失败”分别呈现。借鉴的是这些成熟规则，不要求逐像素一致。

组件继续使用现有 Ant Design 6.7.0：Table、Form、Drawer、Descriptions、Steps、Tabs、Alert、Progress、Timeline、Result、Modal 等足以覆盖首轮。官方还提供 ProTable、ProForm、ProLayout 等高级组件入口；可以在单页兼容验证通过后按需采用，不为换框架重建全部页面。[Ant Design 组件目录](https://ant.design/components/overview/)、[ProComponents](https://procomponents.ant.design/)

首轮不强制引入 Umi、整套 Ant Design Pro、第二套状态库或图表库。现有 React/Ant Design 组合已经满足“组件丰富”的要求，主要问题是完整流程与数据契约不足。

## 8. 选择性复用清单

| 候选 | 复用方式 | 明确不搬的部分 |
| --- | --- | --- |
| Codex 配额窗口分类、时间归一化 | 保留现有移植，补充来源测试样本；保留未知值语义 | 其他提供商、积分消费、额度券兑换 |
| OAuth 生命周期与定向账号恢复 | 借鉴状态/提交边界，适配本项目双授权与DPAPI | 上游完整凭据目录、其他应用凭据、Home集成 |
| 工具历史与长调用编号处理 | 保留已移植函数与测试，按缺口增加最小补丁 | 整套Go执行器和跨提供商转换注册表 |
| Responses推理档位校验修复 | 借鉴`normalizeNativeResponsesEffortDoc`的逐项能力校验及反例，统一两种协议入口 | 对全部请求自动降档的策略；不改变本项目严格接口约定 |
| 配置草稿、差异和冲突处理 | 选择性移植纯数据比较思想/测试，改为自有配置结构 | 全量v8 YAML、上游接口地址、提供商和插件字段 |
| 日志游标/有界缓冲 | 借鉴边界和测试，自己实现摘要存储与分页 | 原始请求/响应正文默认记录 |
| 路由优先级与错误分类 | 首轮仅借鉴分类；自动调度留后续 | 权重补偿、父子会话、分布式Home调度整套实现 |
| 页面交互 | Ant Design重组；只移植可分离纯逻辑 | 整套SCSS、登录存储、后端探测与管理客户端 |

两仓库均提供 MIT 许可。每次实际移植必须记录仓库、固定commit、原文件/函数、目标文件、保留与删除范围、对应测试，并更新 `THIRD_PARTY_NOTICES.md`。本报告不构成“已经复制所有候选”的声明。[S18]

## 9. 主要风险与取舍

| 风险 | 用户可能遇到什么 | 处理原则 |
| --- | --- | --- |
| 上游更新快、协议不是稳定承诺 | 同样配置之后可能出现新400或授权失效 | 固定参考版本、维护反例集、小范围升级验证 |
| 自动改参数 | 请求成功但行为/用量与预期不同 | 普通接口严格校验；兼容项明确记录，不追加万能降级 |
| 双授权状态混淆 | 可调用却提示“账号失败”，或配额成功被当成模型可用 | 两项独立状态，统一恢复入口 |
| 自动重试或切账号 | 延迟/用量增加，工具可能重复执行 | 首轮关闭；后续限定错误、阶段、次数和账号，不重放已输出内容 |
| 统计与额度混为一谈 | 把本机调用数当剩余额度，误判可用量 | 官方配额与本机统计分别标注来源、时间和缺失值 |
| 复制前端但后端没实现 | 出现“看起来可用”的无效开关 | 每个可操作控件必须有后端契约和验收用例 |
| 全量迁移上游工程 | 引入不需要的Go服务、插件、版本耦合 | 只迁移可审查的小模块，保留独立启动验证 |
| 只测试一个模型 | 其他模型能力不同，工具或长会话仍失败 | 公共规则离线覆盖＋实际可选模型矩阵实测 |

## 10. 交付与实施建议

建议下一版作为一个完整改造目标交付，内部按依赖分阶段验证：

1. **统一底层契约**：配置、错误、请求跟踪、账号身份和能力校验。
2. **完成账号/配额/模型三条管理流程**。
3. **完成概览/日志/接入/验证/设置的操作闭环**。
4. **一次整体验收**：现有8模型工具/文件/MCP、全部模型长会话基础覆盖、WorkBuddy原生连接/标题/旧会话、重启与配置恢复。

多账号自动路由、WebSocket/服务端会话、代理编辑、远程部署不混入这一轮。它们分别有成本和安全边界，需要独立验收，不能作为当前核心流程的隐式依赖。

详细任务、接口、顺序与通过条件见 [整体修改方案](superpowers/plans/2026-11-14-modelbridge-console-upgrade.md)。未实施任务不能写成已完成；未运行的测试不能写成已通过。

## 11. 固定版本来源索引

- **S1 管理中心说明**：[README_CN.md](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/README_CN.md)。含功能列表、前后端边界、浏览器存储提示。
- **S2 管理API与OAuth分区**：[management-api-v8.md](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/docs/management-api-v8.md)。
- **S3 全部主路由**：[MainRoutes.tsx](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/router/MainRoutes.tsx)。
- **S4 仪表盘口径**：[useDashboardOverview.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/dashboard/hooks/useDashboardOverview.ts)。
- **S5 账号与OAuth结构**：[authFiles](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/authFiles)、[oauth](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/oauth)。目录证据用于定位组件；具体行为由S2及读取的逻辑文件交叉确认。
- **S6 Codex配额**：[data.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/quota/providers/codex/data.ts)、[批量查询](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/quota/hooks/useQuotaBatchLoader.ts)。
- **S7 配置草稿与冲突**：[useConfigDocument.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/config/hooks/useConfigDocument.ts)、[configPatch.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/services/api/configPatch.ts)、[后端ETag测试](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/api/handlers/management/config_v8_etag_test.go)。
- **S8 路由模型**：[routing/logic.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/routing/logic.ts)。
- **S9 日志缓冲**：[logBuffer.ts](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/logs/model/logBuffer.ts)。
- **S10 后端配置全景**：[config.example.yaml](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/config.example.yaml)。
- **S11 系统与目录刷新**：[SystemPage.tsx](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/pages/SystemPage.tsx)。
- **S12 后端功能与生态边界**：[README_CN.md](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/README_CN.md)。外部用量项目不能算作官方面板原生能力。
- **S13 参数处理**：[codex_executor_request.go](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/runtime/executor/codex_executor_request.go)、[输出上限回归测试](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/runtime/executor/codex_executor_output_budget_issue7304_test.go)。
- **S14 额度与重试分类**：[codex_executor_retry_test.go](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/runtime/executor/codex_executor_retry_test.go)。
- **S15 推理档位问题与当前修复**：[#7478](https://github.com/router-for-me/CLIProxyAPI/issues/7478)、[apply.go](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/thinking/apply.go)、[configuration_update.go](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/thinking/configuration_update.go)、[apply_responses_effort_test.go](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/thinking/apply_responses_effort_test.go)。问题报告是用户提交证据；当前修复经源码核对，未运行上游测试。
- **S16 推理历史恢复**：[codex_executor_reasoning.go](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/internal/runtime/executor/codex_executor_reasoning.go)。WebSocket范围参考仓库executor与handlers对应文件组，本轮未运行该能力。
- **S17 最新发布快照**：[后端v8.0.69](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.69)、[管理中心v1.28.0](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases/tag/v1.28.0)。
- **S18 许可**：[后端LICENSE](https://github.com/router-for-me/CLIProxyAPI/blob/1aaf56bc6a0fc6fce19049ba7ae8554c882304a6/LICENSE)、[管理中心LICENSE](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/LICENSE)。

本地对照：[当前状态](current-state.md)、[独立网关验收](standalone-verification-2026-11-14.md)、[配额验收](quota-verification-2026-11-14.md)、`src/standalone-service.mjs`、`src/http.mjs`、`src/direct-adapter.mjs`、`src/compatibility.mjs`、`web/src/main.jsx`、`web/src/account-panels.jsx`、`web/src/operation-panels.jsx`。
