# 开发与验证

## 环境

- Python 3.10+：使用标准库打包 XPI，无需 pip 依赖。
- Node.js 22：运行单元测试，无需 npm 依赖。
- Zotero 10.0.x：本地交互验证，目前已验证 Windows / Zotero 10.0.6。

```sh
git clone https://github.com/HappyBoy-22/zotero-ChatGPT-.git
cd zotero-ChatGPT-
node scripts/test.cjs
python build.py
```

用 Zotero“工具 → 插件 → 从文件安装插件”安装生成的 XPI。在独立测试配置中验证阅读与批注功能，避免使用唯一一份正式论文数据。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | 插件标识、版本及 Zotero 兼容范围 |
| `bootstrap.js` | 生命周期、菜单和手动复制论文信息 |
| `sidebar.js` | 阅读侧栏、窗口跟踪与独立论文浏览器 |
| `bindings.js` | 论文身份、对话 URL 校验及本机持久化 |
| `autochat.js` | 自动初始化、防重复和对话链接捕获 |
| `analysis.js` | 基本信息生成、设置注册与密码管理器 |
| `ReaderChild.sys.mjs` | 官网输入框、发送及登录表单的内容进程操作 |
| `gestures.js` | PDF 缩放、拖动、批注手势与默认样式 |
| `preferences.xhtml` / `preferences.js` | 原生设置页面及保存逻辑 |
| `tests/*.cjs` | 使用 Node 内置模块的模拟测试 |
| `scripts/test.cjs` | 跨平台测试入口，任一测试失败即返回非零状态 |
| `build.py` | 显式文件清单打包，输出 XPI 与 SHA-256 校验值 |

保持 `chatgpt-reader@local.zotero` 插件 ID 稳定，以便覆盖升级后继续使用原设置。当前 manifest 的 `example.invalid` 地址是无服务的占位地址，启动时禁用自动更新。启用真正的自动更新前，需要另行建设更新清单与发布流程。

## 测试范围

运行 `node scripts/test.cjs` 会执行全部七个测试文件：

| 测试 | 主要覆盖 |
| --- | --- |
| `actor.cjs` | 官网编辑器与账号表单处理 |
| `analysis.cjs` | 基本信息、prompt、禁止全文读取及切换保护 |
| `autochat.cjs` | 初始化记录、恢复、防重复与发送中切换 |
| `bindings.cjs` | URL 校验、父论文关联、自动捕获链接 |
| `context.cjs` | 手动复制信息与批注、空选择和退出清理 |
| `gestures.cjs` | 临时工具、批注样式和输入框保护 |
| `initialize.cjs` | 自动提交、并发、草稿保护、页面变化及发送条件 |

这些测试模拟 Zotero 和网页，不访问用户账号或真实 ChatGPT 服务。开发期间另在独立的真实 Zotero 配置中验证过插件安装与重启、侧栏状态、模拟聊天页面绑定以及原生 PDF 批注；这些含本机路径或配置的诊断材料不纳入仓库。真实账号登录、官网改版后的交互、联网搜索和模型回答需要实际环境复核，不能由单元测试保证。

GitHub Actions 在 Windows 和 Linux 执行单元测试、构建，并上传 XPI 构建产物。Linux 的模拟测试通过不代表已经验证该系统中的 Zotero 界面。

## 构建和发布

`python build.py` 从 manifest 读取版本，仅打包显式清单中的运行文件及许可证。ZIP 使用固定时间和权限，便于同一环境下同一份源码重复构建得到一致校验值。`dist/SHA256SUMS` 对应本次生成的 XPI。

发布新版时：

1. 更新 manifest 版本、CHANGELOG 和 README 的版本 / 下载链接。
2. 更新 `.gitignore` 中公开安装包的版本白名单。
3. 运行测试和构建，并完成真实 Zotero 的交互回归。
4. 提交新版 XPI 与校验值。旧包保留于 Git 历史；工作目录中的其他历史包不会被自动上传。

校验文件可用 PowerShell 的 `Get-FileHash .\dist\chatgpt-reader-0.8.2.xpi -Algorithm SHA256` 或 Linux 的 `sha256sum -c SHA256SUMS`（在 `dist/` 内运行）核对。

## 贡献

请先阅读 [贡献指南](../CONTRIBUTING.md)。仓库仅包含插件源码、审查过的测试与发行文件；不要提交 Zotero 配置目录、论文库、账号信息、Cookie、会话令牌或个人聊天内容。
