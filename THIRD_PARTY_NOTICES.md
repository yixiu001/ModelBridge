# Third-party software

## Selective CLIProxyAPI adaptation

ModelBridge does not install, launch, link, or call the CLIProxyAPI service. Only the message/function-call reconstruction and long call-ID mapping in `src/vendor/chat-history.mjs` are adapted from `internal/translator/codex/openai/chat-completions/codex_openai_request.go` at v8.0.69. The port uses JavaScript and the official membership API namespace format; malformed tool histories are rejected instead of silently discarded. OAuth, HTTP serving, response streaming, management, and the React/Ant Design UI are implemented within ModelBridge.

Source: https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.69/internal/translator/codex/openai/chat-completions/codex_openai_request.go

The management navigation and workflows were reviewed against the official Management Center at `3d893ec88938c3ceef200a15be6af8cf972564b3`. Its previously ported quota parser was removed because this authorization channel has no verified quota endpoint. Other providers and plugin implementations are not included.

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

## UI dependencies

React, Ant Design, Vite, and their transitive packages retain their own licenses in the installed packages. Exact dependency versions are recorded in package-lock.json.
