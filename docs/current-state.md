# 当前状态

更新：2026-11-14（Asia/Shanghai）。

## 目标与归属

- 名称：模型桥 ModelBridge。
- 独立源码目录：E:\codex-dev\tools\model-bridge。
- Git 远端：https://github.com/yixiu001/ModelBridge.git，分支 main。
- 当前交付目标：WorkBuddy 接入、工具联调、提交并推送 GitHub。

## 已完成

- 用户亲自在官方登录流程完成授权；账号身份校验通过，会员用量 scope 已授予。
- 实际读取 11 个目录条目；8 个可选择、3 个隐藏。未尝试调用隐藏条目。
- 8 个可选模型分别通过真实基础工具闭环：2 轮 Responses 请求、1 次无副作用 echo 执行、调用结果关联回传、最终 MODELBRIDGE_OK。
- gpt-6-sol 首次出现连接/格式错误，保留失败记录；一次有针对性的复测通过。首次错误细分原因没有足够证据确定。
- 兼容实际响应缺少 Content-Type 的情况；仍严格检查 SSE 结构和 response.completed，不将中断或普通 JSON 当作成功。
- 模型目录仅提取能力元数据，不把上游提示词模板作为本项目指令或展示内容。
- 已增加 Chat Completions → Responses 适配、独立推理密钥、流式工具参数转换，以及通过随机调用编号恢复的加密推理状态。
- 23 项本地自动测试通过，凭据与运行数据均被 Git 忽略。
- gpt-6.1-sol 经兼容 HTTP 接口的真实回显闭环通过。
- WorkBuddy 5.9.3 已载入 8 个模型桥配置；当前配置文件此前是空数组，已做加密备份。
- 任务页模型列表向下滚动可见全部 8 个自定义模型。
- WorkBuddy 使用 gpt-6.1-sol，在专用测试目录中执行 Read → Write → Read，结果回传后回答 MODELBRIDGE_WORKBUDDY_RESULT=42，磁盘文件独立复核一致。使用默认工具权限。
- 修复 WorkBuddy 客户端元数据适配、中文请求跨分段解码，以及畸形请求遗留活动计数的问题。

## 未完成与验收边界

- WorkBuddy 文件工具验收仅覆盖 gpt-6.1-sol；其余 7 个可选模型仅完成基础 echo 闭环。
- WorkBuddy 设置页“测试连接”发送 max_tokens，辅助请求发送 reasoning_effort:none，均明确报错；实际文件任务不带这些参数并已通过。
- 初次联调经历客户端字段不兼容和一次 ECONNRESET；修复、重试后完成，不称为首次无错误通过。没有切换模型。
- 基础测试由模型桥执行 echo；本次文件工具由 WorkBuddy 执行。MCP 未验收。
- 未全量验证图片输入、推理档位、原生托管工具、并行执行、错误工具结果、长会话、断线恢复与取消在真实模型上的行为。
- 通过基础工具测试只记为部分能力已验证；不宣称全部模型功能已支持。
- 多账号基础注册与选择已有实现，但切换、注销、终止刷新失败等生命周期尚未完成产品级验收。
- 未打包、发布、安装或配置后台自启；本轮已获 GitHub 提交推送授权。

## 证据

- [首次接入验证](verification-2026-11-13.md)：去凭据的逐模型结果。
- [WorkBuddy 文件工具验证](workbuddy-verification-2026-11-14.md)：真实执行、失败与重试边界。
- 本机 `.local/catalog.json`：能力目录快照。
- 本机 `.local/verification.json`：真实基础工具测试记录，含一次失败和后续复测。
- `test/`：可重复运行的离线与本机接口测试。

## 下一步

后续可单独安排其余模型的客户端工具验收、权限拒绝/取消场景及长会话验证。max_tokens 与 reasoning_effort:none 兼容须保持请求语义，不能静默丢弃参数。
