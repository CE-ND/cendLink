# CendLink 架构说明

## 1. 项目定位

CendLink 是一个基于 Electron 的桌面应用，用于远程服务器连接、巡检，以及后续的部署流程能力扩展。

当前阶段的核心目标：

- 在渲染层维护 SSH 服务器配置。
- 通过 Electron IPC 执行 SSH 连接测试。
- 基于当前服务器配置执行一次性 Linux 命令。
- 在多个页面之间共享活动日志。

这个仓库不是纯浏览器项目，也不是后端服务仓库。  
所有远程能力都必须兼容 Electron 打包后的运行方式。

## 2. 运行时分层

当前项目分成四层：

1. 渲染层
   - 负责 Vue 页面、路由、布局和用户交互。
   - 不能直接访问 Node.js 或 `ssh2`。

2. Preload 层
   - 负责在渲染层和 Electron 主进程之间建立安全桥接。
   - 对外暴露 `window.cendlink`。

3. Electron 主进程
   - 负责注册 IPC 处理器和桌面能力，比如本地文件选择器。

4. SSH 服务层
   - 负责实际的 `ssh2` 连接、远程探测和命令执行。

远程能力的数据流必须保持为：

`页面 / composable -> preload 桥接 -> IPC handler -> SSH 服务`

不要绕过这条链路。

## 3. 前端架构

### 3.1 壳层与页面

渲染层采用“壳层 + 路由页面”的结构：

- `src/layouts/AppShell.vue`
  - 持久存在的桌面布局壳层。
  - 负责渲染侧边栏、顶部标题、路由内容区和共享日志区。

- `src/components/layout/AppSidebar.vue`
  - 只负责导航展示和页面切换。
  - 不持有业务状态。

- 路由页面
  - `src/features/connections/views/ServersView.vue`
  - `src/features/commands/views/CommandsView.vue`
  - `src/features/history/views/DeployHistoryView.vue`
  - `src/features/settings/views/SettingsView.vue`

约束：

- 每一个侧边栏导航项都应该对应一个独立的 view。
- 不要再把多页面导航写回到某个大页面内部的 `activeView` 条件切换里。

### 3.2 Electron 兼容路由

当前路由入口文件位于：

- `src/router/index.js`

当前路由方案使用：

- `vue-router`
- `createWebHashHistory()`

原因：

- Electron 生产环境通过 `loadFile(...)` 加载 `dist/index.html`。
- `hash` 路由在 Electron 打包场景下更稳定，不依赖服务端 history fallback。

约束：

- 除非你同时重构 Electron 的窗口加载方式，否则不要切回 `createWebHistory()`。

### 3.3 共享渲染层状态

跨页面共享的工作区状态集中在：

- `src/features/workspace/composables/useWorkspaceSession.js`

这个 composable 负责：

- 当前 SSH 表单状态
- 最近一次连接测试结果
- 最近一次命令执行结果
- 命令输入内容
- 测试中 / 执行中的状态标记
- 活动日志
- `hasElectronBridge`、`needsRetest`、`canExecuteCommand` 等派生状态

约束：

- 只要状态需要跨页面保留，就应该放到共享 composable 或 store 中。
- 不要把跨页面共用的 SSH 状态重新塞回某一个 view 里。

## 4. 功能边界

### 连接功能

相关文件：

- `src/features/connections/components/ConnectionForm.vue`
- `src/features/connections/components/ConnectionStatus.vue`
- `src/features/connections/views/ServersView.vue`

职责：

- 编辑 SSH 服务器配置
- 触发连接测试
- 展示连接探测结果

### 命令执行功能

相关文件：

- `src/features/commands/components/CommandRunner.vue`
- `src/features/commands/views/CommandsView.vue`

职责：

- 编辑一次性命令输入
- 执行远程命令
- 展示最近一次命令结果

重要说明：

- 当前这部分不是交互式终端。
- 每执行一条命令，都会建立一次新的 SSH 连接，执行完成后立即断开。

### 共享日志界面

相关文件：

- `src/components/terminal/TerminalOutput.vue`

职责：

- 展示工作区活动日志
- 支持放大查看长日志

约束：

- 日志组件应保持通用，不耦合某一个具体页面。
- 它是日志查看器，不是交互式终端。

## 5. Electron 集成规则

渲染层访问远程能力时，只能通过：

- `window.cendlink.ssh.testConnection(...)`
- `window.cendlink.ssh.executeCommand(...)`
- `window.cendlink.ssh.selectPrivateKeyFile()`

这些能力定义在：

- `electron/preload/index.js`

IPC 处理器定义在：

- `electron/ipc/ssh.handlers.js`

SSH 实现定义在：

- `electron/services/ssh/sshClient.js`

本地数据存储定义在：

- `electron/services/database/index.js`
- `electron/services/database/migrations/*.sql`
- `electron/services/database/repositories/*Repository.js`

运行时数据目录固定为：

- `~/.cendLink`

当前会在 `~/.cendLink/cendlink.db` 中保存：

- 服务器配置
- 命令执行记录
- 部署记录基础表和部署步骤表
- 应用设置

密码记忆是用户显式勾选行为：

- 未勾选 `记住密码` 时，不保存密码，下次启动密码为空。
- 勾选 `记住密码` 时，通过 Electron `safeStorage` 加密后保存到 `servers.password_secret`。
- 数据库不保存私钥文件内容，也不保存 PEM passphrase。

约束：

- 不要在 Vue 页面或 composable 里直接导入 Electron API 或 `ssh2`。
- 任何新的远程能力都要按下面顺序增加：
  1. SSH 服务层
  2. IPC handler
  3. preload 桥接
  4. 渲染层 composable
  5. 页面 / 组件

## 6. 当前导航模型

### 已实现页面

- `服务器`
  - 已可用，负责 SSH 配置和连接测试

- `命令`
  - 已可用，负责一次性命令执行

### 占位页面

- `部署记录`
- `设置`

约束：

- 即使只是占位，也应该以真实 route view 的形式进入壳层。
- 不要回退到“看起来像导航，但其实只是禁用按钮”的假页面结构。

## 7. 样式约定

全局样式文件：

- `src/style.css`

当前样式策略：

- 壳层布局类名为全局类
- 功能组件样式也是全局类
- 当前没有使用 CSS Modules

约束：

- 壳层类名保持通用，比如 `sidebar`、`workspace`、`panel`、`placeholder`。
- 功能类名尽量按职责命名，比如 `command-*`、`terminal-*`、`status-*`。
- 优先复用现有面板结构，不要每个页面重新发明容器模式。

## 8. 后续开发规则

1. 新增侧边栏页面时，先建 route view，再补 UI。
2. 跨页面共享的 SSH 状态必须放在 view 之上。
3. 渲染层尽量保持薄，只负责组织状态和界面，远程能力交给 Electron。
4. 不要把布局、导航和业务编排重新塞进同一个大文件。
5. 组件职责尽量单一：
   - 表单输入
   - 状态展示
   - 日志展示
   - 壳层布局
   - 页面级编排
6. 模板残留或无业务价值的示例文件要及时清理。

## 9. 如何新增一个远程能力

例子：新增远程文件上传

1. 在 `electron/services/ssh/sshClient.js` 中实现上传逻辑。
2. 在 `electron/ipc/ssh.handlers.js` 中注册 `ssh:upload-file`。
3. 在 `electron/preload/index.js` 中暴露 `uploadFile()`。
4. 在 `useWorkspaceSession.js` 或新的 composable 中补共享状态和调用逻辑。
5. 在对应的 route view 和 UI 组件中接入。
6. 为日志区增加必要的活动记录，确保用户能追踪过程。

## 10. 下次继续开发可直接使用的提示词

下面这段可以直接作为下次继续开发时的项目理解提示词：

```text
你正在维护 CendLink，一个基于 Electron + Vue 的桌面端远程运维应用。

架构约束如下：
- 渲染层使用 vue-router，并且必须使用 createWebHashHistory，因为 Electron 生产环境通过 loadFile 加载 dist/index.html。
- AppShell 位于 src/layouts/AppShell.vue，是持久布局壳层；侧边栏每个导航项都必须对应一个独立 route view。
- 跨页面共享的 SSH 状态统一放在 src/features/workspace/composables/useWorkspaceSession.js。
- 渲染层不能直接导入 ssh2 或 Electron API。
- 所有远程能力都必须走：SSH 服务层 -> IPC handler -> preload 桥接 -> 渲染层 composable -> 页面/组件。
- TerminalOutput 是共享日志查看器，不是交互式终端。
- CommandsView 当前只支持一次性命令执行，除非显式升级架构，否则不要按持久 shell 会话来实现。

在修改代码前，优先保持这些分层边界，不要再把多个页面和多种职责重新压回一个大页面组件里。
```

## 11. 下一步建议清理项

- 增加 ESLint 和 Prettier，用工具约束结构和风格。
- 随着接口增多，可以考虑引入 TypeScript。
- 如果命令执行、部署记录或设置页继续变复杂，再把它们拆成更细的 composable。
- 如果共享状态规模明显扩大，再考虑正式的 store 方案，而不是过早引入。
