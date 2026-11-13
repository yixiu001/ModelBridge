# Third-party software

## Selective CLIProxyAPI adaptation

ModelBridge does not install, launch, link, or call the CLIProxyAPI service. The message/function-call reconstruction and long call-ID mapping in `src/vendor/chat-history.mjs` are adapted from `internal/translator/codex/openai/chat-completions/codex_openai_request.go` at v8.0.69. The port uses JavaScript and the official membership API namespace format; malformed tool histories are rejected instead of silently discarded. The OAuth endpoint, public client ID, PKCE and scope parameters in `src/quota-auth.mjs` selectively follow `internal/auth/codex/openai_auth.go` at the same tag. ModelBridge implements its own callback server, signed ID-token verification, account binding, encrypted persistence and refresh. Inference continues to use its separate direct membership grant.

Source: https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.69/internal/translator/codex/openai/chat-completions/codex_openai_request.go

OAuth reference: https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.69/internal/auth/codex/openai_auth.go

The management navigation and workflows were reviewed against the official Management Center at `3d893ec88938c3ceef200a15be6af8cf972564b3`. Other providers and plugin implementations are not included.

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

`src/vendor/codex-quota.mjs` selectively adapts duration-based window classification and credit-balance validation from `src/features/quota/providers/codex/data.ts` at `3d893ec88938c3ceef200a15be6af8cf972564b3`. It handles only Codex usage windows and safe display fields. ModelBridge requests the official usage endpoint directly with its own grant, never the Management Center API. The port omits redemption, spending controls, subscription lookups, provider/plugin code and UI dependencies; invalid or missing percentages stay unknown instead of being inferred.

Source: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/3d893ec88938c3ceef200a15be6af8cf972564b3/src/features/quota/providers/codex/data.ts

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
