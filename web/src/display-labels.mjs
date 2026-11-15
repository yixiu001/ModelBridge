export const failureLabels = {
  validation: '请求参数', network: '网络连接', timeout: '请求超时',
  authorization: '账号授权', authentication: '身份验证', quota: '额度限制',
  rate_limit: '请求限流', capacity: '模型繁忙', upstream: '上游响应', internal: '服务异常',
  cancelled: '请求取消', unsupported: '能力不支持',
};
export const sourceLabels = {client:'客户端参数', upstream:'官方上游', network:'网络', gateway:'本机服务'};
export const verificationKinds = {text:'文本对话', tools:'基础工具', files:'文件工具', mcp:'MCP 工具', long:'长会话'};
export const resultLabels = {passed:'通过', failed:'失败', cancelled:'已取消', cancelled_or_timeout:'取消 / 超时', running:'验证中'};
