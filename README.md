<div align="center">

# Rhadon

**A personal workbench — 把桌面装进一个网页里**

仿 Windows 桌面体验的个人工作台：窗口、任务栏、便签、音乐、计算器、局域网互传……
全部由 `index.html` + Electron 构成，无需构建工具，改完即生效。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Icon](https://img.shields.io/badge/icon-all%20rights%20reserved-red)](lambda.ico.LICENSE.txt)
[![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4)](https://github.com/skazuyi/Rhadon)

</div>

---

## 这是什么

Rhadon 是一个**仿桌面操作系统界面**的个人工作台。打开后你会看到一个带壁纸的桌面、可拖拽缩放的窗口、顶部任务栏和时钟——但所有内容和逻辑都写在**一个 HTML 文件**里。

它同时支持两种运行方式：

| 方式 | 特点 | 适用 |
|---|---|---|
| **浏览器直接打开** | 零安装，双击 `index.html` 即可 | 快速体验 |
| **Electron 桌面应用** | 完整功能（文件系统、剪贴板历史、局域网互传） | 日常使用 |

> 项目没有 webpack / vite / react 之类的构建链。**改一行代码刷新就生效**，这是刻意的设计选择。

---

## 功能一览

### 桌面环境
- 可拖拽 / 缩放 / 最小化 / 最大化的多窗口系统
- 顶部任务栏、实时时钟、窗口聚焦与层级管理
- 自定义壁纸、字体、字号
- 桌面图标与右键菜单

### 内置应用
| 应用 | 说明 |
|---|---|
| 📝 便签 | 桌面便签，可拖动定位 |
| 🧮 计算器 | 带历史记录，点击历史可回跳 |
| ⏰ 时钟 / 计时器 / 闹钟 | 时间类工具 |
| 🎵 音乐播放器 | 播放列表、封面、任务栏浮窗控制 |
| 📁 资料区 | 登记常用文件，快速打开 |
| 📋 剪贴板历史 | 自动记录复制的文本与图片 |
| 📤 文件传输 | 局域网与手机双向互传（见下） |
| 🖱️ 快捷操作 | 用 JSON 定义自定义按钮 |

### 📤 局域网文件互传（重点功能）

不需要数据线、不需要装 App——**手机浏览器打开一个地址，就能和电脑双向互传**。

```
电脑打开「文件传输」窗口 → 显示 http://192.168.x.x:8888
手机连同一 WiFi，浏览器访问该地址
```

**三个标签页，双向收发：**

| 标签页 | 方向 | 能力 |
|---|---|---|
| **发到电脑** | 手机 → 电脑 | 发送文字、**多选**文件上传 |
| **接收** | 电脑 → 手机 | 类 QQ 气泡，文字点击复制，文件点击下载 |
| **浏览电脑** | 电脑 → 手机 | 网格视图、**子文件夹**、**图片缩略图** |

**电脑端**是一个 **QQ 式聊天窗口**：
- 手机发来的消息显示为左侧气泡，电脑发出的显示在右侧
- 输入框支持发送文字，也可 **Ctrl+V 直接粘贴文件发送**
- **右键菜单**：复制文字 / 复制文件路径 / 打开 / 定位 / 查看大图
- 图片消息**内联预览**，点击可放大查看
- 支持**一键清除聊天记录**（不影响已接收的文件）

**其他细节：**
- 支持 **`.lnk` 文件夹快捷方式**——共享目录里的快捷方式可以直接点进去
- 共享目录支持**子文件夹**逐层浏览
- 图片缩略图**非持久化**（内存中生成，不落盘）
- 路径访问有白名单保护，无法通过 `../` 越界访问其他目录

---

## 快速开始

### 方式一：浏览器（零安装）

```bash
# 直接双击 index.html，或者：
start index.html
```

> 浏览器模式下部分功能不可用（文件系统、剪贴板历史、局域网互传）。

### 方式二：Electron（推荐）

```bash
npm install
npm start
```

### 方式三：打包成独立 EXE

```bash
npm run dist
```

产物在 `dist/` 目录，生成的 **portable exe** 双击即用，也可以拷到其他 Windows 电脑。

#### 打包常见问题

<details>
<summary><b>卡在下载 electron 二进制 / 连接超时</b></summary>

国内网络访问 GitHub 不稳定，设置镜像即可：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist
```
</details>

<details>
<summary><b>Cannot create symbolic link（winCodeSign 解压失败）</b></summary>

打包时需要解压 `winCodeSign`，其中含 macOS 符号链接文件，Windows 普通账户无权限创建。二选一：

1. **以管理员身份**运行终端（最简单）
2. 开启 Windows 开发者模式：`设置 → 隐私和安全性 → 开发者选项 → 开发人员模式`
</details>

---

## 首次使用需配置

打开应用后进入「**设置**」，填写以下路径（留空则对应功能不可用）：

| 设置项 | 用途 | 必填性 |
|---|---|---|
| 剪贴板历史缓存路径 | 存放剪贴板文本与图片 | 用剪贴板历史则必填 |
| 文件传输保存路径 | 手机上传的文件存放位置 | 用文件传输则必填 |
| 电脑共享给手机的目录 | 手机可浏览/下载的目录 | 留空则复用上面 |
| 文件传输端口 | 默认 `8888` | 可选 |
| 快捷操作 JSON 目录 | 存放自定义快捷操作 | 可选 |
| 自定义 Action JS 目录 | 存放自定义插件 | 可选 |

> 💡 每个路径旁都有「浏览…」按钮，不用手打路径。

---

## 插件系统

Rhadon 的核心扩展能力：**放一个文件进去，就能给工作台加功能**，不需要改源码。

支持两类文件：

| 类型 | 文件 | 能力 |
|---|---|---|
| **声明式** | `.json` | 一个可点击的操作（打开文件夹/网址、复制文字、串行动作） |
| **编程式** | `.js` | 注册动作类型 / 注册完整窗口应用 / 挂后台静默服务 |

### JSON 快捷操作

放到「快捷操作 JSON 目录」，点「🔄 重新加载」即生效。

```json
{
  "id": "open-project",
  "name": "打开项目",
  "icon": "📁",
  "describe": "打开我的项目文件夹",
  "actions": [
    { "type": "open-folder", "path": "D:\\projects\\workbench" }
  ]
}
```

**内置动作类型（7 种）：**

| type | 参数 | 作用 |
|---|---|---|
| `toast` | `text` | 弹出提示 |
| `delay` | `ms` | 等待毫秒数 |
| `open-folder` | `path` | 打开文件夹 |
| `open-app` | `path` | 打开程序或文档 |
| `open-url` | `url` | 用浏览器打开网址 |
| `copy-text` | `text` | 复制到剪贴板 |
| `launch-app` | `appId` | 打开工作台内的某个应用 |

**可用 `appId`：** `notes` `calc` `clock` `timer` `alarm` `music` `fileArea` `clipboard` `transfer` `settings` `actionsErrorReport`

### JS 插件

用 `definePlugin` 声明插件类型，三种 `kind`：

#### `kind: 'action'` — 提供动作类型

```js
definePlugin({
  kind: 'action',
  register(api) {
    api.registerActionType('my-beep', async (act) => {
      console.log('参数：', act.text);
    });
  }
});
```

#### `kind: 'service'` — 后台静默服务

不显示图标、不进网格，启动后自动生效。典型场景是全局快捷键。

**完整示例见 [`examples/altx-keepalive.js`](examples/altx-keepalive.js)** —— 用 `Alt+X` 切换「允许挂起 / 保持活跃」模式。

```js
definePlugin({
  kind: 'service',
  id: 'f3-music',
  name: 'F3 播放/暂停音乐',
  icon: '⏯️',
  start(api) {
    const onKey = (e) => {
      if (e.key !== 'F3' || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      MusicPlayer.toggle();
    };
    document.addEventListener('keydown', onKey);

    // ⚠️ 必须登记清理函数（见下方说明）
    api.onCleanup(() => document.removeEventListener('keydown', onKey));
  }
});
```

服务可在「快捷操作」窗口顶部的**后台服务**区块中用开关启停，默认开启。

> ⚠️ **`api.onCleanup()` 是必须的**
>
> 点「🔄 重新加载」会重新执行所有 `.js`。如果你注册了监听器/定时器却没登记清理函数，
> 旧的不会被移除，**每重载一次就多叠加一个**——表现为「按一次快捷键触发好几次」。
>
> ```js
> start(api) {
>   const timer = setInterval(tick, 1000);
>   api.onCleanup(() => clearInterval(timer));   // ✅
> }
> ```

#### `kind: 'app'` — 注册窗口应用

```js
definePlugin({
  kind: 'app',
  id: 'my-panel',
  name: '我的面板',
  icon: '🧩',
  register(api) {
    api.registerApp({
      render(body, meta) {
        body.innerHTML = '<div style="padding:16px;">你好！</div>';
      }
    });
  }
});
```

之后可以在 JSON 里用 `{"type":"launch-app","appId":"my-panel"}` 打开它。

> **兼容旧写法**：直接调用全局 `registerActionType(type, handler)` 仍然完全可用。

### 插件规则与报错

- 声明了 `kind` 就要做到对应的事，否则会**在错误列表中报错**（例如声明 `app` 却没注册应用）
- 应用 id 与内置应用冲突时会被拒绝，不会静默覆盖
- 所有错误都会显示在「快捷操作」窗口下方的列表里，包含**文件名、原因、修改建议**
- 坏文件不影响好文件，只是被跳过

---

## 项目结构

```
Rhadon/
├── index.html                  # 主程序（桌面 UI + 全部前端逻辑）
├── main_clean.js               # Electron 主进程（文件系统、剪贴板、局域网传输服务）
├── preload.js                  # 预加载脚本（IPC 桥接，contextBridge 白名单）
├── package.json                # 依赖与打包配置
├── lambda.ico                  # 应用图标（⚠️ 非 MIT 授权，见 License）
├── lambda.ico.LICENSE.txt      # 图标授权说明
├── examples/
│   └── altx-keepalive.js       # 插件示例：Alt+X 后台挂起开关
├── LICENSE
├── .gitattributes
└── .gitignore
```

### 架构说明

- **`index.html`** 是单文件应用，所有窗口都是 `registerApp({...})` 注册的插件式模块
- **`main_clean.js`** 里的 `TransferServer` 是一个内置的 HTTP 服务，同时充当手机端页面服务器
- **`preload.js`** 用 `contextBridge` 暴露能力白名单，渲染层不直接接触 Node

---

## 常见问题

<details>
<summary><b>手机打不开传输页面？</b></summary>

- 确认手机与电脑在**同一 WiFi**（不是手机热点）
- 确认电脑防火墙允许该端口（首次运行可能弹窗询问）
- 访问的地址要和窗口里显示的完全一致
</details>

<details>
<summary><b>「未知动作类型」但拼写没错？</b></summary>

该类型可能由某个 `.js` 提供，而那个文件**加载失败了**。先看错误列表里有没有那个 `.js` 的报错——而不是去改拼写。
</details>

<details>
<summary><b>看不到「后台服务」区块？</b></summary>

只有成功加载了 `kind:'service'` 的 `.js` 才会显示。一个都没有时该区块不出现。
</details>

<details>
<summary><b>剪贴板历史占空间吗？</b></summary>

不会。最多保留 **50 条**，超出会自动删除最旧的记录，图片文件也会一并从磁盘删除。
被「固定」的记录不参与淘汰。
</details>

<details>
<summary><b>快捷方式（.lnk）点不进去？</b></summary>

Rhadon 能识别指向**文件夹**的快捷方式并直接进入。如果目标路径在磁盘上已不存在（程序被移动/卸载），则无法进入。
</details>

---

## License

[MIT](LICENSE) © skazuyi

> ### ⚠️ 资源文件例外
>
> **`lambda.ico` 不在 MIT 许可范围内，不授予任何授权。**
>
> 该图标为版权所有者的个人资源，保留所有权利。它出现在仓库中仅作为构建配置的一部分。
>
> **如果你 fork 或再分发本项目，请务必移除或替换该文件**——详见 [`lambda.ico.LICENSE.txt`](lambda.ico.LICENSE.txt)。
>
> 其余源码（`index.html`、`main_clean.js`、`preload.js` 等）均适用 MIT 协议，可自由使用、修改、分发。
