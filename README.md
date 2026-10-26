<h1 align="center">
  <img src="public/Cend.svg" width="88" alt="CendLink logo" /><br />
  CendLink
</h1>

<p align="center">
  <strong>桌面端的可视化远程部署工具</strong><br />
  连接服务器 · 打包 Docker 镜像 · 一键部署上线，全流程不出窗口
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white" alt="Electron 39" />
  <img src="https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite 8" />
  <img src="https://img.shields.io/badge/Windows-x64-0078D6?logo=windows&logoColor=white" alt="Windows x64" />
</p>

---

CendLink 把「连服务器 → 打镜像 → 发上线 → 查状态」整条部署链路搬进了桌面端：服务器配置、镜像打包、远程部署、文件管理、容器日志、命令终端集中在一个应用里，部署记录与服务器凭据全部落在本地 SQLite，不上传任何第三方服务。

## 功能特性

| 模块 | 说明 |
| --- | --- |
| **服务器** | 多台服务器配置管理，支持密码 / 私钥两种认证；置顶默认服务器后启动即自动重连，双击侧边栏直接发起连接；连接成功后实时读取 CPU / 内存 / 磁盘占用 |
| **镜像打包** | 选择本地 Jar 与 Dockerfile 模板（内置 + 自定义），一键构建 `docker save` 镜像包（tar.gz），打包配置可存为服务模板复用 |
| **远程部署** | 镜像包拖进窗口即可部署：自动 SFTP 上传 → `docker load` → 创建容器 → 状态检查 → 网络验证，分阶段可视化推进；接受任意 `docker save` 产物，不限于本工具打包 |
| **前端上传** | 静态站点压缩包上传到 Nginx 站点目录，自动适配部署环境重启 Nginx，附带代理检查与目标目录模板 |
| **文件管理** | SFTP 远程文件浏览器：上传 / 下载 / 重命名 / 删除 / 新建目录，支持路径备注 |
| **容器日志** | 按容器查看运行日志，同时展示每个容器的内存占用 |
| **命令** | 一次性远程命令与持久交互终端（xterm + WebGL 渲染），命令超时可配置，避免长查询卡死 |
| **部署记录** | 镜像打包 / 远程部署 / 前端上传的历史留档，可反查每次发布的内容 |

全局能力：浅色 / 深色主题即时切换、关闭按钮最小化到系统托盘、基于色差设计系统的统一视觉与 GSAP 动效。

## 技术栈

- **Electron 39** —— 主进程承载全部系统能力：ssh2 连接、SFTP 传输、Docker 编排
- **Vue 3 `<script setup>` + Vite 8** —— 渲染层，vue-router（hash 模式）按页面拆分 `src/features`
- **xterm 6 + WebGL addon** —— 硬件加速的交互式终端
- **node:sqlite** —— Node 内置 SQLite（WAL 模式），本地存储零原生编译依赖
- **electron-builder** —— Windows x64：NSIS 安装版 + 免安装便携版

## 架构一览

```
electron/
  main/          窗口与托盘生命周期
  ipc/           按业务域拆分的 IPC handlers
  preload/       contextBridge 白名单桥（window.cendlink）
  services/      ssh / deployment / docker / files / frontend / database / credential
src/
  features/      按页面拆分的业务模块（服务器、打包、部署、文件、容器、命令…）
  components/    通用 UI（AppTooltip、终端等）
  shared/        主进程与渲染层共享的常量
```

渲染层通过 `useWorkspaceSession` 组合式函数共享跨页面状态；主进程与渲染层之间只经过 preload 暴露的白名单方法通信。

## 数据与安全

- 本地数据目录 `~/.cendLink`：`cendlink.db`（SQLite，WAL）+ `logs/`
- 渲染进程开启 `contextIsolation`、禁用 `nodeIntegration`，只能调用 preload 白名单 API
- 「记住密码」经 Electron safeStorage 加密后才入库，数据库中只存密文；私钥 passphrase 不落盘、不回填

## 快速开始

环境要求：Node.js ≥ 18、npm。

```bash
# 安装依赖
npm install

# 一键启动桌面端开发环境（Vite + Electron）
npm run dev:electron
```

只调整页面样式时，也可以用 `npm run dev` 在浏览器中预览；SSH、部署等系统能力需要在 Electron 中运行。

## 构建发布

```bash
# 生成 Windows 安装包与便携版，输出到 release/
npm run dist:win
```

应用图标由 `public/Cend.svg` 经 `npm run build:icon` 生成。

## 更多文档

- [COMMANDS.md](COMMANDS.md) —— 全部开发 / 构建 / 打包命令说明
