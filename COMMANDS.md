# CendLink 命令文档

## 环境要求

- Node.js（建议 18+）
- npm

## 安装依赖

```bash
npm install
```

## 常用命令

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `npm run dev` | 启动前端开发服务 | 仅启动 Vite，浏览器访问 http://127.0.0.1:4001 |
| `npm run dev:electron` | 一键启动桌面端开发 | 自动启动 Vite + Electron 窗口，日常开发用这个 |
| `npm run electron:dev` | 单独启动 Electron | 需要先运行 `npm run dev`（依赖 4001 端口的服务） |
| `npm test` | 运行测试 | 执行 `tests/` 下的 Node 测试 |
| `npm run build:icon` | 生成应用图标 | 由 `public/Cend.svg` 生成 `build/icon.png` 和 `build/icon.ico` |
| `npm run build` | 打包前端 | 产物输出到 `dist/` |
| `npm run pack` | 生成免安装目录版 | 图标 + 前端构建 + 打包到 `release/`（不生成安装包） |
| `npm run dist` | 生成当前平台安装包 | 输出到 `release/` |
| `npm run dist:win` | 生成 Windows 安装包 | NSIS 安装程序 + 免安装 portable 版，x64，输出到 `release/` |
| `npm run preview` | 本地预览打包结果 | 预览 `dist/` 构建产物 |

## 典型流程

### 日常开发

```bash
npm run dev:electron
```

关闭 Electron 窗口时，脚本会一并停掉 Vite。

### 只改前端页面（浏览器调试）

```bash
npm run dev
```

### 跑测试

```bash
npm test
```

### 发布 Windows 安装包

```bash
npm run dist:win
```

完成后在 `release/` 目录找 `.exe` 安装包。

## 产物目录

| 目录 | 内容 |
| --- | --- |
| `dist/` | 前端构建产物 |
| `release/` | Electron 打包产物（安装包 / 免安装目录） |
| `build/` | 应用图标（icon.png / icon.ico） |
