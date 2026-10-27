# 依赖与授权说明

主要直接依赖如下，完整依赖版本与校验以 `go.mod`、`go.sum`、`frontend/package.json` 和 `frontend/package-lock.json` 为准。

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| Wails 2 | Go 与系统 WebView 桌面框架 | MIT |
| pkg/sftp | SFTP 协议客户端 | BSD-2-Clause |
| golang.org/x/crypto | SSH 协议与认证 | BSD-3-Clause |
| golang.org/x/sys | 系统调用 | BSD-3-Clause |
| Vue 3 | 前端组件与状态 | MIT |
| Arco Design Vue | 按钮、弹窗与抽屉 | MIT |
| TanStack Vue Virtual | 文件列表虚拟滚动 | MIT |
| xterm / addon-fit | 终端渲染与尺寸适配 | MIT |
| Playwright | 界面行为与前端性能测试 | Apache-2.0 |
| Simple Icons 11.15.0 | 本地操作系统 SVG 标识 | CC0-1.0 |

本表不是所有间接依赖的完整授权清单。分发依赖代码或构建产物时，应保留所包含依赖要求的版权和授权信息。ssh-go 自身的项目许可证待选定，不通过依赖许可证推定项目授权。

界面参考 Termius 的布局与视觉层次，由 ssh-go 的 Vue 组件、Arco 图标和自定义亮色主题实现。仓库展示截图由隔离的界面测试数据生成。

操作系统标识取自 [Simple Icons 11.15.0](https://github.com/simple-icons/simple-icons/tree/11.15.0/icons)，本地文件及授权见 `frontend/src/assets/systems/`。标识用于识别服务器系统，不代表与相应品牌的关联。
