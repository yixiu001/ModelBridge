# Third-party software

## Selective CLIProxyAPI adaptation

ModelBridge does not install, launch, link, or call the CLIProxyAPI service. The message/function-call reconstruction and long call-ID mapping in `src/vendor/chat-history.mjs` are adapted from `internal/translator/codex/openai/chat-completions/codex_openai_request.go` at v8.0.69. The port uses JavaScript and the official membership API namespace format; malformed tool histories are rejected instead of silently discarded. The OAuth endpoint, public client ID, PKCE and scope parameters in `src/quota-auth.mjs` selectively follow `internal/auth/codex/openai_auth.go` at the same tag. ModelBridge implements its own callback server, signed ID-token verification, account binding, encrypted persistence and refresh. Inference continues to use its separate direct membership grant.

Source: https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.69/internal/translator/codex/openai/chat-completions/codex_openai_request.go

OAuth reference: https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.69/internal/auth/codex/openai_auth.go

The management navigation and workflows were reviewed against the official Management Center at `3d893ec88938c3ceef200a15be6af8cf972564b3`. Other providers and plugin implementations are not included.

The capability checks in `src/request-contract.mjs` and regression cases in `test/request-contract.test.mjs` selectively re-express the native Responses effort validation cases from `internal/thinking/configuration_update.go` and `internal/thinking/apply_responses_effort_test.go` at `1aaf56bc6a0fc6fce19049ba7ae8554c882304a6`. Unlike upstream automatic lowering, strict ModelBridge requests reject unsupported effort; only the previously authorized WorkBuddy title helper maps none to low. No Go executor or cache is imported.

### CLIProxyAPI license (verbatim)

MIT License

Copyright (c) 2025-2005.9 Luis Pater
Copyright (c) 2025.9-present Router-For.ME

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Selective Management Center quota adaptation

`src/vendor/codex-quota.mjs` selectively adapts duration-based window classification and credit-balance validation from `src/features/quota/providers/codex/data.ts` at `3d893ec88938c3ceef200a15be6af8cf972564b3`. It handles only Codex usage windows and safe display fields. ModelBridge requests the official usage endpoint directly with its own grant, never the Management Center API. The port omits redemption, spending controls, provider/plugin code and UI dependencies; invalid or missing percentages stay unknown instead of being inferred.

Source: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/quota/providers/codex/data.ts

The subscription lookup in `src/codex-subscription.mjs` and `parseCodexSubscription` in `src/vendor/codex-quota.mjs` selectively adapt `fetchCodexSubscriptionActiveUntil`, `parseCodexSubscriptionActiveUntil`, the 8-second optional timeout, and `CODEX_SUBSCRIPTION_URL` from the same fixed Management Center revision. It directly reads the official subscription endpoint with ModelBridge-owned credentials. ModelBridge adds strict date normalization, a bounded response body, cancellation, separate safe error states, and explicitly historical fallback. It does not copy the management API transport, token-metadata fallback, credit redemption or subscription-changing operations.

Subscription source: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/quota/providers/codex/data.ts

Endpoint source: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/utils/quota/constants.ts

The console visual refresh selectively adapts the warm neutral light/dark color palette from `src/styles/themes.scss` at the same fixed revision. Sidebar proportions, restrained borders, compact spacing and responsive navigation were studied in `src/styles/variables.scss` and `src/styles/layout.scss`; ModelBridge implements its own React + Ant Design shell, theme provider and account actions. Primary button and success-text colors are adjusted for contrast. No Management Center runtime, provider pages or service dependency is included.

UI source: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/3d893ec88938c3ceef200a15be6af8cf972564b3/src/styles

The remaining-page refinement studies the structured log filters, pause/refresh controls and status feedback in `src/features/logs/LogsPage.tsx`, plus the information tiles in `src/pages/SystemPage.module.scss`, at the same fixed revision. ModelBridge implements these interactions with its own Ant Design components and existing local APIs, including stale-read guards and cursor pagination. No upstream log transport, provider settings, plugins or service code is added.

Log UI reference: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/logs/LogsPage.tsx

Information tile reference: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/pages/SystemPage.module.scss

### Management Center license (verbatim)

MIT License

Copyright (c) 2026 Router-For.ME

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## UI dependencies

React, Ant Design, Vite, and their transitive packages retain their own licenses in the installed packages. Exact dependency versions are recorded in package-lock.json.
