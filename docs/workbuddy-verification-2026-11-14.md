# WorkBuddy 接入与文件工具验证

日期：2026-11-14，Asia/Shanghai。范围为本机 WorkBuddy 5.9.3、当前授权会员账号和指定模型 gpt-6.1-sol。

## 结果

设置及任务页模型列表均可见 8 个自定义模型。任务列表有内部滚动区域，自定义模型在内置模型下方。

使用默认权限，在项目 `.local/workbuddy-qa` 专用目录读取 input.txt 中的 37，加 5 写入 result.txt，再读取该文件确认。WorkBuddy 界面最终显示 `MODELBRIDGE_WORKBUDDY_RESULT=42`，随后由独立文件读取核对磁盘内容一致。

| 步骤 | 工具执行方 | 网关可验证结果 | 完成时间（北京时间） |
| --- | --- | --- | --- |
| 读取 input.txt | WorkBuddy Read | 流式工具调用完成；下一请求带对应工具结果 | 00:41:54 |
| 写入 result.txt | WorkBuddy Write | 原始调用/推理状态恢复成功；下一请求收到第二个工具结果 | 00:45:57 |
| 读取 result.txt | WorkBuddy Read | 下一请求收到三个工具结果 | 00:46:09 |
| 最终回答 | 指定模型 gpt-6.1-sol | finish_reason=stop，界面显示计算结果 42 | 00:46:18 |

上述为一次经过联调修复和重试的完整工具链，不能当作无故障首次通过。网关没有执行文件操作；WorkBuddy 保持默认工具权限。未改动其他工作目录、服务器、模型选择或付费方式。

## 兼容修复与失败记录

- 实际任务请求附带 startsNewUserRequest、agent、conversationRequestId，以及后续的 messageId、stepSeq、model、requestModelId、requestModelName、traceId、argumentsDisplayText、usage、rawUsage。按观察到的客户端记账和展示用途验证类型，再转换标准模型消息；未知扩展继续拒绝。
- usage 中的 token 明细数组保持客户端统计性质；不作为模型输入，不代替完整工具参数与结果。
- 续接保存原始 Responses 输出及加密推理状态，通过不可猜测的工具调用编号关联，核对账号、指定模型、历史和参数。联调重启后已恢复先前的 Read 状态并继续执行 Write。
- 00:45:19 上游连接 ECONNRESET，未自动重放工具。通过客户端重试后完成写入、复读与最终回答。
- 设置页测试携带 max_tokens，辅助请求携带 reasoning_effort:none，当前不支持并明确报错。主任务请求无这两个字段，工具链成功。没有用移除上限或替换推理档位制造兼容结果。
- 额外回归发现 HTTP 请求按字节分片时可能截断中文字符，已改为完整字节解码；畸形请求不能遗留活动计数阻止切换账号。

## 可重复验证与证据

- `npm test`：23 项通过；上游为模拟响应，不消耗真实模型用量。
- `scripts/gateway-probe.mjs gpt-6.1-sol`：独立 HTTP echo 闭环已通过，不能替代本报告的 WorkBuddy 证据。
- `.local/gateway-trace.jsonl`：只记录字段名、角色、工具数量/名称、结束状态和安全错误，不记录提示词、工具参数、工具结果或凭据。
- `.local/tool-states.dpapi`：Windows DPAPI 加密的续接状态；不纳入 Git。
- `.local/workbuddy-qa/result.txt`：实际工具产物；不纳入 Git。

其余 7 个模型未逐一执行 WorkBuddy 文件任务；图片、MCP、真实并行工具、权限拒绝、长会话压缩、流式取消及产品级多账号生命周期仍未验收。
