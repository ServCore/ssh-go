# 开发与验证

## 本地环境

使用 Node.js 22.12+、Go 1.26.1 和 Wails CLI 2.12.0。macOS 安装 Xcode 命令行工具；其他平台桌面依赖按 Wails 官方说明准备，当前工程尚未完成这些平台的桌面验收。

根目录执行：

```sh
GOTOOLCHAIN=go1.26.1 go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
export PATH="$(go env GOPATH)/bin:$PATH"
npm --prefix frontend ci
make run
```

Wails 脚本通过自身路径定位项目，不依赖调用时的工作目录。使用更新的系统 Go 时，默认通过 `GOTOOLCHAIN=go1.26.1` 保持绑定生成兼容。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `make help` | 查看命令 |
| `make setup` | 安装前端依赖和 Playwright 浏览器 |
| `make run` | 启动桌面开发环境 |
| `make build` | 构建原生桌面包 |
| `make check` | 前端构建、Go vet、Go 竞态检查、界面测试 |
| `make test-go` | 单独测试后端，无需前端构建产物 |
| `make test-ui` | 单独运行界面测试 |
| `make memory` | 三轮生产前端内存采样 |

Playwright 配置位于 `frontend/tests/`，开发服务器端口 1421，内存测试预览端口 1422。测试报告位于忽略的 `frontend/.test-artifacts/`。安装浏览器或设置 `SSH_TOOLS_CHROMIUM` 后再运行界面测试。

## 修改约定

- 后端代码使用 `gofmt`，错误经 `AppError` 保留错误代码和必要详情。
- 异步操作需要明确取消、超时和资源关闭路径；前端处理过期请求和卸载后的回包。
- 前端使用 Vue 单文件组件，沿用亮色主题和 Arco Vue 基础组件，避免重新引入 React。
- 文件列表快照整体替换，保持浅层响应式和虚拟滚动；性能测试使用生产构建。
- 提交源码、锁文件、构建配置与必要文档，生成的依赖、二进制和本地运行数据保持忽略。

在修改涉及的路径上运行必要检查。协议、取消、覆盖与恢复等行为应由有实际边界意义的测试覆盖；文案和可逆样式修改不需要机械增加测试。

GitHub Actions 工作流已在本地准备，覆盖 macOS 构建、测试和打包；当前尚未上传并启用，请使用上述本地命令验证。
