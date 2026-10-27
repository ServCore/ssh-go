# 目录与构建入口

## 根目录保留什么

| 文件 / 目录 | 用途 |
| --- | --- |
| `README.md` | GitHub 首页、预览、快速开始与文档导航 |
| `main.go` | Wails 桌面入口和前端资源嵌入 |
| `app.go` | 桌面生命周期、RPC 桥与原生对话框 |
| `menu.go` | macOS 原生菜单，向前端发送统一应用命令 |
| `go.mod` / `go.sum` | Go 模块声明、依赖版本与校验 |
| `wails.json` | Wails 项目配置；指向 `frontend/` |
| `Makefile` | 根目录统一的开发、打包与验证命令 |
| `.gitignore` | 忽略依赖、产物、缓存与本地运行数据 |
| `.github/` | GitHub Actions 构建与测试配置，本地保留，尚未上传 |
| `frontend/` | Vue 工程、前端依赖、构建配置与界面测试 |
| `internal/core/` | SSH、SFTP、存储、转发、传输恢复和 Go 测试 |
| `build/` | 原生应用图标与平台打包配置；`bin/` 是忽略的产物 |
| `scripts/` | 桌面构建包装脚本 |
| `docs/` | 架构、数据说明、性能记录、迁移记录和简历素材 |

许可证选定后，`LICENSE` 也应放在根目录，便于 GitHub 识别。

## 前端目录

```text
frontend/
├── src/                  # Vue 页面、组件、组合式状态与桥接接口
├── public/               # 原样复制的静态资源
├── tests/
│   ├── ui/               # Playwright 行为测试与隔离 IPC fixture
│   ├── performance/      # 生产资源内存测试
│   ├── playwright.config.ts
│   └── playwright.memory.config.ts
├── index.html            # 网页入口
├── package.json          # 前端依赖与脚本
├── package-lock.json     # 可重复安装的锁文件
├── tsconfig.json         # Vue / TypeScript 类型检查配置
└── vite.config.ts        # 前端开发与构建配置
```

`index.html`、`package.json`、锁文件和 TypeScript 配置都仍然有用，移动到前端目录后继续参与构建。测试配置随测试一起收拢，不再占用根目录。

## 自动生成的内容

| 路径 | 来源 | 是否提交 |
| --- | --- | --- |
| `frontend/node_modules/` | `npm ci` | 否 |
| `frontend/dist/` | Vite 生产构建，随后由 Go 嵌入 | 否 |
| `frontend/src/wailsjs/` | Wails 生成的桥接运行时与类型 | 否 |
| `frontend/package.json.md5` | Wails 依赖安装缓存 | 否 |
| `frontend/.test-artifacts/` | 截图、测试报告和本机内存样本 | 否 |
| `build/bin/` | Wails 原生打包产物 | 否 |
| `backups/` | 本地整理备份 | 否 |

本次整理保留了本机旧截图和内存样本，移动至 `frontend/.test-artifacts/`。旧的根目录 `package.json.md5`、`tsconfig.tsbuildinfo` 与两个未引用品牌图标存入 `backups/layout-20261016/`。公开展示截图独立复制到 `docs/images/`，使用测试服务器数据。

## 调用方式

在根目录执行 `make run`、`make build`、`make check`。仅运行网页开发服务器时执行 `npm --prefix frontend run dev`。

Wails 包装脚本按脚本自身位置定位根目录；在前端目录执行 `npm run desktop` / `npm run package` 也会找到正确的 `wails.json`。首次检出没有 `frontend/dist/` 时，脚本先构建真实前端资源，再生成 Go 绑定，避免 `go:embed` 因缺少构建目录而失败。

前端重建之后，根目录可运行 `go vet ./...` 或 `go test ./...`。只运行后端测试 `go test -race ./internal/...` 不需要预先构建前端。
