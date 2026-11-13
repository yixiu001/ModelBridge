# Third-party software

## CLIProxyAPI

ModelBridge connects to an independently installed CLIProxyAPI service. The engine binary and OAuth credentials are not distributed in this repository.

- Project: https://github.com/router-for-me/CLIProxyAPI
- Tested release: v8.0.69 (MIT)
- Engine license: https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.69/LICENSE

## CLI Proxy API Management Center

`src/vendor/codex-quota.ts` adapts `buildCodexQuotaWindows` from `src/features/quota/providers/codex/data.ts` and numeric/string normalization from `src/utils/quota/parsers.ts`. Window classification and fallback behavior are retained; browser translation/time helpers are replaced by local server helpers. Only Codex read-only quota logic is included, without credit spending, other providers, or plugins.

Source: https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/3d893ec88938c3ceef200a15be6af8cf972564b3

The management workflow and fixed official quota endpoint also follow this project's OAuth/account/quota API implementations. ModelBridge's React/Ant Design interface is its own implementation using library components.

### License

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
