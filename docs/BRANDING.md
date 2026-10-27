# 应用标识

ssh-go 使用扁平圆角方块和白色终端提示符，去除原应用图标的立体装饰。提示符与短光标保持足够的笔画宽度，小尺寸也能辨认。

- 矢量源：`frontend/src/assets/brand/app-mark.svg`。
- 顶栏：`AppLogo.vue` 引用同一矢量源，底色跟随 `--accent-solid`，不会改变其他终端功能图标。
- 桌面：`build/appicon.png`，1024 × 1024 RGBA，保留原生应用图标所需的透明边距，品牌色固定为 `#7552d6`。
- 浏览器：`frontend/public/favicon.svg` 和 32 × 32 的 `favicon.png`，采用紧凑画布，避免缩小后图形过小。

修改矢量源后，运行 `node scripts/generate-icons.mjs` 同步生成桌面和浏览器资产。该开发脚本复用前端现有的 Playwright 依赖；使用本机 Chrome 时，可设置环境变量 `SSH_TOOLS_CHROMIUM` 为可执行文件路径。

随后运行 `npm --prefix frontend run build` 检查前端，并通过 `node scripts/wails.mjs build` 打包桌面应用。已运行的旧进程可能继续显示之前加载的 Dock 图标；新应用在下次启动时读取新图标。

macOS 打包完成后，构建脚本同时刷新 `.app` 目录的修改时间，以便 Finder/Dock 重新读取图标，避免仅替换包内资源后继续沿用旧缓存。
