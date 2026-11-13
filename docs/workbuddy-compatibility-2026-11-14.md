# WorkBuddy 专用兼容模式与七模型验收

日期：2026-11-14（Asia/Shanghai）。环境：本机 WorkBuddy 5.9.3、当前授权会员账号、模型桥专用兼容接口。此记录是指定范围的验收快照，不代表持续可用性或全部能力支持。

## 兼容策略与授权

用户明确选择“采用专用兼容模式”，接受以下差异：

- 仅对已识别的连接探测（流式、单条用户消息 `Reply with OK.`、`max_tokens:1`）移除上游不支持的输出上限，仍调用指定真实模型，不能保证上游只生成 1 token。
- 仅对已识别的标题辅助请求，将 `reasoning_effort:none` 改为目录声明支持的 `low`。仍有推理，可能增加延迟和会员用量。
- 普通 `/v1` 接口保持严格校验。专用 `/workbuddy/v1` 接口也不会对其他请求套用这两条规则，不换模型或切换付费方式。

响应头 `X-ModelBridge-Compatibility`、首个 SSE 块或完整 JSON 的 `modelbridge` 元数据、本机去凭据日志均记录兼容模式和实际调整。连接探测会等到上游完整成功再发出 SSE；模拟上游先返回部分文字再失败的回归用例确认不会提前输出成功内容。

能力配置根据实际目录生成：不能关闭推理的模型声明 `onlyReasoning`、`canDisableThinking:false`；保留默认档位及客户端支持的同名档位映射，不将 max 改成其他档位。客户端不支持的 ultra 不展示。未逐档进行真实模型验证。

依据：[会员通道限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[WorkBuddy 模型配置说明](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model-Configuration)，以及本机该版本实际请求。当前账号 8 个可选模型均未声明 none 档位。

## 真实文件工具闭环

在 `.local/workbuddy-qa` 内为每个模型创建独立输入，包含数字 101～107 和随机标记。通过 WorkBuddy 原生界面逐个选择确切模型并发起独立任务：Read 读取输入，Write 写入数字加 5 及原样标记，再 Read 结果确认。任务提示没有提供预期标记或结果。工具由 WorkBuddy 执行，模型桥仅转发调用与关联回传结果，保持默认工具权限。

验收同时核对界面最终回答、网关工具名称与结果回传、磁盘文件内容。下列七项全部满足；标题辅助请求也各自成功。

| 模型 | 工具序列 | 文件结果 | 最终回答完成（北京时间） | 标题辅助 |
| --- | --- | --- | --- | --- |
| gpt-6-astra | Read → Write → Read | 随机标记一致，106 | 01:00:57 | 通过 |
| gpt-6.1-terra | Read → Write → Read | 随机标记一致，107 | 01:02:47 | 通过 |
| gpt-6-sol | Read → Read → Write → Read | 随机标记一致，108 | 01:07:50 | 通过 |
| gpt-6-luna | Read → Write → Read | 随机标记一致，109 | 01:11:18 | 通过 |
| gpt-5.6-sol | Read → Write → Read | 随机标记一致，110 | 01:15:48 | 通过 |
| gpt-5.6-terra | Read → Write → Read | 随机标记一致，111 | 01:17:49 | 通过 |
| gpt-5.6-luna | Read → Read → Write → Read | 随机标记一致，112 | 01:19:19 | 通过 |

有的模型额外读取目录规则；核心输入读取、结果写入、结果复读均已执行。结合[此前 gpt-6.1-sol 的验收](workbuddy-verification-2026-11-14.md)，当前全部 8 个可选模型已覆盖该文件工具场景。3 个隐藏目录条目没有调用。

## 连接测试与失败记录

- gpt-6.1-sol：WorkBuddy 原生设置页实际点击测试，观察到“连接成功”。早期客户端收到首段内容就关闭连接，导致上游取消；加入完整响应缓冲后复测成功。
- 其余七个模型：通过专用 HTTP 接口发送与 WorkBuddy 相同的探测正文，检查完整 SSE 和文本 OK。六个首次通过；gpt-6-sol 首次已完成响应，但未满足严格的 OK 文本断言，记录 `unexpected_probe_text`。其针对性复测返回 OK，耗时 4607 ms。没有逐个点击这七个模型的设置页按钮，HTTP 探测不能描述为七次原生界面测试。
- gpt-6-sol 首次文件任务发现测试目录规则只允许旧的 input.txt/result.txt，因此未执行。将隔离目录规则修正为允许本轮指定文件后，同一任务继续读取规则、执行文件工具并完成。
- gpt-5.6-sol 首次主任务因旧配置将模型标为“不支持推理”，客户端发出 none，被严格拒绝。修正目录驱动的能力配置、重新选择同一模型并重试后完成；主任务没有使用标题请求的 none→low 转换。
- 联调前段出现目录刷新连接重置，后续重试恢复。保留原始失败，不把修复后的通过描述为全程无错误。

## 自动测试与本机证据

`npm test`：29 项通过。新增覆盖专用接口鉴权与严格接口隔离、精准请求识别、调整披露、上游失败不伪装成功、活动计数释放，以及推理配置档位保持。离线测试不调用真实模型；上文桌面任务和 HTTP 探测使用真实会员通道。

本机证据不纳入 Git：

- `.local/gateway-trace.jsonl`：模型、字段名、角色、工具名称/数量、兼容调整、完成或失败状态；不记录提示词、工具内容或凭据。
- `.local/workbuddy-model-results.json`：七模型工具序列、最终完成时间、随机标记及磁盘匹配结果。
- `.local/workbuddy-connection-results.json` 与 `workbuddy-connection-recheck.json`：初次连接探测及针对性复测，保留失败。
- `.local/workbuddy-qa/input-<model>.txt`、`result-<model>.txt`：独立测试输入和实际工具产物。
- 加密配置备份与工具续接状态继续只保存在 `.local`。

未验收：图片、MCP、全部推理档位、真实并行工具、权限拒绝、长会话、取消恢复及产品级多账号生命周期。此次通过不能扩展为这些能力的通过结论。
