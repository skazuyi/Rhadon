const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

let mainWindow = null;

/* ------------------------------------------------------------
 * 后台活跃模式（keepAlive）
 *   false（默认）= 允许挂起：沿用 Chromium 默认的后台节流，
 *                  窗口失焦/被遮挡时降低刷新与定时器频率，省电。
 *   true          = 保持活跃：关闭后台节流，切走再回来不会卡顿，
 *                  代价是后台仍持续消耗资源。
 * 注意：backgroundThrottling 只在窗口创建时生效，运行时改不了，
 *       所以切换必须重建窗口。切换前由渲染层先保存快照。
 * ------------------------------------------------------------ */
let keepAlive = false;

/* keepAlive 必须由主进程自己持久化：
 * 重建窗口不会重置它，但完全退出程序再启动会，所以存到用户数据目录。 */
function keepAliveStateFile() {
  try { return path.join(app.getPath('userData'), 'keep-alive.json'); } catch (e) { return null; }
}
function loadKeepAlive() {
  const f = keepAliveStateFile();
  if (!f) return false;
  try {
    const raw = fs.readFileSync(f, 'utf8');
    return !!JSON.parse(raw).keepAlive;
  } catch (e) { return false; }
}
function saveKeepAlive(v) {
  const f = keepAliveStateFile();
  if (!f) return;
  try { fs.writeFileSync(f, JSON.stringify({ keepAlive: !!v }), 'utf8'); } catch (e) { /* 忽略写入失败 */ }
}

function setKeepAlive(v) {
  keepAlive = !!v;
  saveKeepAlive(keepAlive);
  return keepAlive;
}
function getKeepAlive() { return keepAlive; }

function createWindow() {
  // 窗口/任务栏图标。
  // 打包后：由 extraResources 放到 resources/ 下（真实文件路径，asar 内的路径不能用作窗口图标）
  // 开发时：直接读项目根目录的 lambda.ico
  const iconCandidates = [
    path.join(process.resourcesPath || '', 'lambda.ico'),
    path.join(__dirname, 'lambda.ico')
  ];
  const iconPath = iconCandidates.find(p => { try { return p && fs.existsSync(p); } catch (e) { return false; } });
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Rhadon',
    autoHideMenuBar: true,
    backgroundColor: '#1e1e2e',
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 保持活跃模式下关闭后台节流；缺省（false）时沿用 Chromium 默认的省电行为
      backgroundThrottling: !keepAlive
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  mainWindow.loadFile('index.html');
  // 只清理"自己"这个引用：重建时旧窗口的 closed 不应把新窗口的引用清空
  const self = mainWindow;
  self.on('closed', () => { if (mainWindow === self) mainWindow = null; });
}

/* 用当前 keepAlive 设置重建主窗口。
 * 调用方（渲染层）必须已经先保存过快照，重建后 boot() 会自动恢复窗口布局。
 *
 * 顺序很关键：**先建新窗口，再销毁旧窗口**，全程窗口数 ≥ 1。
 * 反过来做会让窗口数短暂为 0，触发 'window-all-closed' → app.quit()，
 * 表现为"按了快捷键后窗口消失、程序也退出了"。
 */
let isRecreating = false;

async function recreateMainWindow(reason) {
  if (isRecreating) return { ok: false, msg: '正在重建中' };

  const old = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
  if (!old) {
    createWindow();
    return { ok: true, recreated: true };
  }

  isRecreating = true;
  try {
    // 1) 先创建新窗口（此时窗口数为 2，不会触发 window-all-closed）
    createWindow();
    const fresh = mainWindow;
    // 2) 新窗口内容加载完成后，再销毁旧窗口
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try { fresh.webContents.once('did-finish-load', finish); } catch (e) { finish(); }
      setTimeout(finish, 3000);   // 兜底，避免一直等
    });
    // 3) 稍等，确保旧窗口的 localStorage 写入已落盘
    await new Promise(r => setTimeout(r, 150));
    try {
      old.removeAllListeners('closed');
      old.destroy();
    } catch (e) { /* 忽略销毁异常 */ }
  } finally {
    isRecreating = false;
  }
  return { ok: true, recreated: true, reason: reason || null };
}

ipcMain.handle('app:getKeepAlive', () => ({ ok: true, keepAlive: getKeepAlive() }));

ipcMain.handle('app:setKeepAlive', async (e, v) => {
  setKeepAlive(v);
  return { ok: true, keepAlive: getKeepAlive() };
});

/* 设置并重建窗口（一步到位，避免渲染层忘记重建） */
ipcMain.handle('app:applyKeepAlive', async (e, v) => {
  setKeepAlive(v);
  const r = await recreateMainWindow('keepAlive=' + getKeepAlive());
  return Object.assign({ keepAlive: getKeepAlive() }, r);
});

ipcMain.handle('app:recreateWindow', async () => recreateMainWindow('manual'));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  keepAlive = loadKeepAlive();   // 恢复上次的"活跃/挂起"设置
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 重建窗口期间会短暂出现"窗口数为 0"，此时不能退出，否则程序会自己关掉
  if (isRecreating) return;
  if (process.platform !== 'darwin') app.quit();
});

/* ============================================================
 * 文件系统能力（Electron 专属）
 * ============================================================ */

ipcMain.handle('fs:readDir', async (event, dirPath) => {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
      if (err) return reject(err.message);
      const result = entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name)
      }));
      resolve(result);
    });
  });
});

ipcMain.handle('fs:selectDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('fs:selectFiles', async (event, filters) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: filters || []
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths;
});

ipcMain.handle('fs:readAsDataURL', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) return reject(err.message);
      const ext = path.extname(filePath).toLowerCase();
      let mime = 'application/octet-stream';
      const mimes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
        '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
        '.csv': 'text/csv', '.xml': 'text/xml',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf'
      };
      mime = mimes[ext] || mime;
      if (mime.startsWith('text/') || mime === 'application/json' || mime === 'text/csv' || mime === 'text/xml') {
        const str = data.toString('utf8');
        return resolve({ type: 'text', mime, content: str, name: path.basename(filePath) });
      }
      const base64 = data.toString('base64');
      return resolve({ type: 'dataurl', mime, dataUrl: `data:${mime};base64,${base64}`, name: path.basename(filePath) });
    });
  });
});

ipcMain.handle('fs:readText', async (event, filePath, maxBytes) => {
  return new Promise((resolve, reject) => {
    const limit = maxBytes || 2 * 1024 * 1024;
    fs.readFile(filePath, (err, data) => {
      if (err) return reject(err.message);
      const sliced = data.length > limit ? data.slice(0, limit) : data;
      resolve({ content: sliced.toString('utf8'), truncated: data.length > limit, name: path.basename(filePath) });
    });
  });
});

ipcMain.handle('fs:openPath', async (event, filePath) => {
  if (!filePath) return { ok: false, error: 'no path' };
  try { await shell.openPath(filePath); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('fs:showInFolder', async (event, filePath) => {
  if (!filePath) return;
  shell.showItemInFolder(filePath);
});

/* ============================================================
 * 快捷操作（Actions）相关 IPC
 * ============================================================ */

// 读取目录下的 .json / .js 文件列表（不含子目录）
ipcMain.handle('actions:readFiles', async (event, dir) => {
  if (!dir) return { ok: false, msg: '目录为空' };
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && (e.name.endsWith('.json') || e.name.endsWith('.js')))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }));
    return { ok: true, files };
  } catch (e) { return { ok: false, msg: String(e) }; }
});

// 读取单个文件文本内容
ipcMain.handle('actions:readText', async (event, filePath) => {
  try { return { ok: true, content: fs.readFileSync(filePath, 'utf8') }; }
  catch (e) { return { ok: false, msg: String(e) }; }
});

// 用默认浏览器打开网址
ipcMain.handle('actions:openExternal', async (event, url) => {
  if (!url) return { ok: false, msg: 'URL 为空' };
  try { await shell.openExternal(url); return { ok: true }; }
  catch (e) { return { ok: false, msg: String(e) }; }
});

// 打开应用/文件（用系统默认方式），或通过可执行路径启动进程
ipcMain.handle('actions:launchApp', async (event, target, isExecutable) => {
  if (!target) return { ok: false, msg: '路径为空' };
  try {
    if (isExecutable && /.exe$/i.test(target) && fs.existsSync(target)) {
      // 用 child_process 启动 exe，分离进程
      const cp = spawn(target, [], { detached: true, stdio: 'ignore' });
      cp.unref();
      return { ok: true };
    }
    // 否则用 shell 打开（文件夹/文件/URL）
    const err = await shell.openPath(target);
    if (err) return { ok: false, msg: err };
    return { ok: true };
  } catch (e) { return { ok: false, msg: String(e) }; }
});

// 打开文件夹（若不存在则先创建）
ipcMain.handle('actions:openFolder', async (event, dir) => {
  if (!dir) return { ok: false, msg: '路径为空' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) return { ok: false, msg: err };
    return { ok: true };
  } catch (e) { return { ok: false, msg: String(e) }; }
});

// 确保目录存在并返回默认 actions 目录
ipcMain.handle('actions:ensureDefaultDir', async () => {
  const base = path.join(app.getPath('userData'), 'workbench-actions');
  try {
    fs.mkdirSync(base, { recursive: true });
    return { ok: true, dir: base };
  } catch (e) { return { ok: false, msg: String(e) }; }
});

/* ============================================================
 * 剪贴板历史
 * ============================================================ */
// 剪贴板历史最多保留的条数（仅统计未固定的记录）。超出部分自动删除，
// 图片会连同磁盘上的 png 一起删除。
const CLIP_MAX_ITEMS = 50;

const ClipboardHistory = {
  dir: '',
  watchTimer: null,
  lastText: null,
  lastImageKey: null,
  items: [],

  ensureDir() {
    if (!this.dir) return false;
    try { fs.mkdirSync(this.dir, { recursive: true }); return true; }
    catch (e) { return false; }
  },
  indexPath() { return path.join(this.dir, 'clipboard-index.json'); },
  textPath() { return path.join(this.dir, 'clipboard.txt'); },

  loadIndex() {
    try {
      if (fs.existsSync(this.indexPath())) this.items = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8'));
      else this.items = [];
    } catch (e) { this.items = []; }
    if (!Array.isArray(this.items)) this.items = [];
    this.trimToLimit();
  },
  /* 裁剪到上限：删除超出的未固定记录（含图片文件）。
   * 加载时也要调用一次，否则历史遗留的超量数据会一直留着。 */
  trimToLimit() {
    let changed = false;
    const removable = this.items.filter(i => !i.pinned);
    while (this.items.length > CLIP_MAX_ITEMS && removable.length) {
      const victim = removable.pop();
      const idx = this.items.indexOf(victim);
      if (idx === -1) continue;
      this.items.splice(idx, 1);
      if (victim.type === 'image' && victim.imgName) {
        try { fs.unlinkSync(path.join(this.dir, victim.imgName)); } catch (e) {}
      }
      changed = true;
    }
    if (changed) { this.saveIndex(); this.rewriteTextFile(); }
    return changed;
  },
  saveIndex() {
    try { fs.writeFileSync(this.indexPath(), JSON.stringify(this.items)); } catch (e) {}
  },
  rewriteTextFile() {
    try {
      const lines = this.items.filter(i => i.type === 'text' && i.text != null).map(i => String(i.text).replace(/[\r\n]+/g, ' '));
      fs.writeFileSync(this.textPath(), lines.join('\n'), 'utf8');
    } catch (e) {}
  },

  setDir(dir) {
    this.dir = dir || '';
    if (!this.dir) { this.stop(); return { ok: false, msg: '未设置缓存目录' }; }
    if (!this.ensureDir()) return { ok: false, msg: '无法创建缓存目录' };
    this.loadIndex();
    return { ok: true };
  },
  start() {
    if (!this.dir) return { ok: false, msg: '请先在设置里填写剪贴板缓存路径' };
    if (this.watchTimer) return { ok: true };
    this.lastText = null; this.lastImageKey = null;
    this.watchTimer = setInterval(() => this.poll(), 1500);
    return { ok: true };
  },
  stop() {
    if (this.watchTimer) { clearInterval(this.watchTimer); this.watchTimer = null; }
  },
  poll() {
    try {
      const text = clipboard.readText();
      if (text && text !== this.lastText) {
        this.lastText = text;
        this.addItem({ type: 'text', text: text });
      }
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        const key = img.toDataURL().slice(0, 200);
        if (key !== this.lastImageKey) {
          this.lastImageKey = key;
          this.addImage(img);
        }
      }
    } catch (e) {}
  },
  addImage(img) {
    const name = 'img_' + Date.now() + '.png';
    fs.writeFileSync(path.join(this.dir, name), img.toPNG());
    this.addItem({ type: 'image', imgName: name });
  },
  addItem(item) {
    const rec = Object.assign({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), time: Date.now(), pinned: false }, item);
    this.items.unshift(rec);
    // 只保留最近 CLIP_MAX_ITEMS 条；超出的（未被固定的）连图片文件一起删除，
    // 避免缓存目录无限增长。固定(pinned)的记录不参与淘汰。
    this.trimToLimit();
    this.saveIndex();
    this.rewriteTextFile();
    this.pushUpdate();
  },
  deleteItem(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return { ok: false };
    const victim = this.items[idx];
    this.items.splice(idx, 1);
    if (victim.type === 'image' && victim.imgName) {
      try { fs.unlinkSync(path.join(this.dir, victim.imgName)); } catch (e) {}
    }
    this.saveIndex();
    this.rewriteTextFile();
    this.pushUpdate();
    return { ok: true };
  },
  togglePin(id) {
    const it = this.items.find(i => i.id === id);
    if (it) it.pinned = !it.pinned;
    this.saveIndex();
    this.pushUpdate();
  },
  getItems() {
    return this.items.map(i => ({
      id: i.id, type: i.type, text: i.text, time: i.time, pinned: i.pinned,
      imgPath: i.type === 'image' ? path.join(this.dir, i.imgName) : null
    }));
  },
  pushUpdate() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clip:update', this.getItems());
    }
  }
};

ipcMain.handle('clip:setPath', (e, dir) => ClipboardHistory.setDir(dir));
ipcMain.handle('clip:start', () => ClipboardHistory.start());
ipcMain.handle('clip:stop', () => { ClipboardHistory.stop(); return { ok: true }; });
ipcMain.handle('clip:getItems', () => ClipboardHistory.getItems());
ipcMain.handle('clip:delete', (e, id) => ClipboardHistory.deleteItem(id));
ipcMain.handle('clip:pin', (e, id) => { ClipboardHistory.togglePin(id); return { ok: true }; });
ipcMain.handle('clip:copyText', (e, text) => { clipboard.writeText(String(text)); return { ok: true }; });
ipcMain.handle('clip:copyImage', (e, filePath) => {
  try { clipboard.writeImage(nativeImage.createFromPath(filePath)); return { ok: true }; }
  catch (er) { return { ok: false, msg: String(er) }; }
});

/* ============================================================
 * 局域网文件传输（支持双向：手机↔电脑，文字消息 + 文件）
 * ============================================================ */
const TransferServer = {
  server: null,
  dir: '',
  shareDir: '',   // 电脑共享给手机的目录（手机可浏览并下载其中文件）
  port: 8888,
  busy: false,
  current: null,
  startTime: 0,
  received: [],
  _lastP: 0,

  /* ---------- 聊天消息存储 ----------
   * 消息存在程序数据目录下的独立文本文件里（chat-log.json），
   * 与接收到的文件分开，便于单独清除。
   * dir === 'pc' 表示电脑发给手机的，dir === 'phone' 表示手机发给电脑的。 */
  msgPath() {
    try { return path.join(app.getPath('userData'), 'chat-log.json'); }
    catch (e) { return null; }
  },
  loadMessages() {
    const p = this.msgPath();
    if (!p) return [];
    try {
      if (!fs.existsSync(p)) return [];
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },
  saveMessages() {
    const p = this.msgPath();
    if (!p) return;
    try { fs.writeFileSync(p, JSON.stringify(this.messages.slice(0, 500)), 'utf8'); } catch (e) {}
  },
  pushMessages() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer:messageList', this.messages.slice(0));
    }
  },
  addMessage(msg) {
    const rec = Object.assign({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      time: Date.now()
    }, msg);
    this.messages.unshift(rec);
    if (this.messages.length > 500) this.messages.length = 500;
    this.saveMessages();
    this.pushMessages();
    return rec;
  },
  /* 清空聊天记录（只删消息，不删已接收的文件） */
  clearMessages() {
    this.messages = [];
    this.saveMessages();
    this.pushMessages();
    return { ok: true };
  },
  /* 电脑主动发一条文字给手机 */
  sendText(text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) return { ok: false, msg: '内容为空' };
    this.addMessage({ dir: 'pc', kind: 'text', text: t });
    return { ok: true };
  },
  /* 电脑主动把一个文件加入"发给手机"的列表（手机端自行下载） */
  sendFile(filePath) {
    let st;
    try { st = fs.statSync(filePath); } catch (e) { return { ok: false, msg: '文件不存在' }; }
    if (st.isDirectory()) return { ok: false, msg: '暂不支持发送文件夹' };
    const name = path.basename(filePath);
    const rec = this.addMessage({ dir: 'pc', kind: 'file', name: name, size: st.size, path: filePath });
    return { ok: true, item: rec };
  },
  /* 按消息 id 找到电脑要发给手机的文件路径 */
  resolveOutgoingFile(id) {
    const m = this.messages.find(x => x.id === id && x.dir === 'pc' && x.kind === 'file');
    if (!m || !m.path) return null;
    try { if (!fs.statSync(m.path).isFile()) return null; } catch (e) { return null; }
    return { msg: m, path: m.path };
  },

  getLANIP() {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const ni of ifs[name]) {
        if (ni.family === 'IPv4' && !ni.internal) return ni.address;
      }
    }
    return '127.0.0.1';
  },
  isRunning() { return !!this.server; },
  getStatus() {
    return {
      running: this.isRunning(), ip: this.getLANIP(), port: this.port,
      dir: this.dir, shareDir: this.shareDir, current: this.current,
      received: this.received.slice(0)
    };
  },
  start(port, dir, shareDir) {
    if (this.server) return { ok: false, msg: '服务已在运行' };
    if (!dir) return { ok: false, msg: '请先填写传输保存路径' };
    this.port = port || 8888;
    this.dir = dir;
    this.shareDir = (shareDir && String(shareDir).trim()) || '';
    let mkErr = '';
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { mkErr = String(e); }
    if (mkErr) return { ok: false, msg: '无法创建保存目录: ' + mkErr };
    // 测试可写
    try { const t = path.join(dir, '.wt'); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); }
    catch (e) { return { ok: false, msg: '保存目录不可写: ' + String(e) }; }
    if (!this.messages) this.messages = this.loadMessages();
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        this.pushStatus();
        resolve({ ok: true, status: this.getStatus() });
      });
      this.server.on('error', (err) => { resolve({ ok: false, msg: '端口被占用或错误: ' + err.code }); });
    });
  },
  stop() {
    if (!this.server) return { ok: true };
    if (this.busy) return { ok: false, msg: '传输进行中，无法关闭' };
    this.server.close(() => {});
    this.server = null;
    this.pushStatus();
    return { ok: true };
  },
  pushStatus() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('transfer:status', this.getStatus());
  },
  handle(req, res) {
    let u;
    try { u = new URL(req.url, 'http://x'); } catch (e) { u = null; }
    if (req.method === 'GET') {
      if (u && u.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.mobilePage());
        return;
      }
      if (u && u.pathname === '/files') { this.handleFiles(res, u); return; }
      if (u && u.pathname === '/thumb') { this.handleThumb(req, res, u); return; }
      if (u && u.pathname === '/download') { this.handleDownload(req, res, u); return; }
      if (u && u.pathname === '/messages') { this.handleMessages(res); return; }
      if (u && u.pathname === '/outgoing') { this.handleOutgoing(req, res, u); return; }
      if (u && u.pathname === '/outgoing-thumb') { this.handleOutgoingThumb(req, res, u); return; }
      res.writeHead(404); res.end('Not Found');
      return;
    }
    if (req.method === 'POST' && u && u.pathname === '/upload') { this.handleUpload(req, res, u); return; }
    if (req.method === 'POST' && u && u.pathname === '/text') { this.handleIncomingText(req, res); return; }
    res.writeHead(404); res.end('Not Found');
  },
  /* ---------- 路径安全 ----------
   * 把手机传来的相对路径（可含子目录）解析成共享目录内的真实路径。
   * 拒绝任何越界（.. 、绝对路径、盘符）。
   *
   * 例外：通过 .lnk 快捷方式跳转到的目录（可能在共享目录之外），
   * 会被登记到 _lnkRoots 白名单，允许在其中继续浏览。
   * 这样既支持快捷方式，又不会让手机凭 ../ 访问任意路径。 */
  _lnkRoots: null,
  _allowRoots() {
    if (!this._lnkRoots) this._lnkRoots = new Set();
    return this._lnkRoots;
  },
  registerLnkRoot(dir) {
    try { this._allowRoots().add(path.resolve(dir)); } catch (e) {}
  },
  isUnderAllowed(dir) {
    const full = path.resolve(dir);
    const sd = this.shareDir ? path.resolve(this.shareDir) : null;
    if (sd && (full === sd || full.startsWith(sd + path.sep))) return true;
    for (const root of this._allowRoots()) {
      if (full === root || full.startsWith(root + path.sep)) return true;
    }
    return false;
  },
  resolveInShare(rel) {
    const sd = this.shareDir;
    if (!sd) return null;
    let raw = String(rel == null ? '' : rel);
    try { raw = decodeURIComponent(raw); } catch (e) {}
    raw = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!raw) raw = '';
    const parts = raw.split('/').filter(p => p && p !== '.');
    if (parts.some(p => p === '..')) return null;          // 拒绝向上穿越
    if (/^[a-zA-Z]:/.test(raw)) {
      // 允许绝对路径，但必须落在共享目录或已登记的快捷方式根目录内
      const abs = path.resolve(raw);
      return this.isUnderAllowed(abs) ? abs : null;
    }
    const full = path.resolve(sd, parts.join('/'));
    return this.isUnderAllowed(full) ? full : null;
  },

  /* 解析 Windows 快捷方式（.lnk），取出它指向的目标路径。
   *
   * 关键点：.lnk 里的路径段是 **ANSI 编码**（中文系统为 GBK/GB18030），
   * 不是 latin1。用 latin1 读会把中文变成乱码，导致路径判定失败
   * （例：D:\软件 会被读成 D:\Èí¼þ）。因此这里多编码尝试。
   *
   * 解析顺序：
   *   1) 结构化解析 LinkInfo 段里的 LocalBasePath（最可靠）
   *   2) 正则扫描各编码下的候选路径，逐个用 fs 验证真实存在
   *
   * wantDir=true 时只返回目录（用于"把快捷方式当成目录进入"）。 */
  decodeLnkBuffer(buf, enc) {
    try {
      if (enc === 'latin1') return buf.toString('latin1');
      return new TextDecoder(enc, { fatal: false }).decode(buf);
    } catch (e) { return null; }
  },

  /* 从 LinkInfo 段结构化提取本地路径（GBK 与 UTF-16LE 两种形态都试） */
  parseLinkInfoPath(buf) {
    const candidates = [];
    // LinkInfo 结构：HeaderSize(4) LinkInfoHeaderSize(4) LinkInfoFlags(4) VolumeIDOffset(4)
    //                LocalBasePathOffset(4) CommonNetworkRelativeLinkOffset(4) CommonPathSuffixOffset(4)
    // 它在 HeaderSize(76) + IDList 之后，但不保证位置；这里扫描常见签名 0x0000001C/0x00000024
    for (let i = 0; i + 28 <= buf.length; i++) {
      // LinkInfoHeaderSize 常见为 0x1C(28) 或 0x24(36)
      const hdrSize = buf.readUInt32LE(i + 4);
      if (hdrSize !== 0x1C && hdrSize !== 0x24) continue;
      const flags = buf.readUInt32LE(i + 8);
      if (flags !== 1) continue;                       // 1 = VolumeIDAndLocalBasePath
      const localBaseOff = buf.readUInt32LE(i + 16);
      if (localBaseOff <= 0 || localBaseOff >= buf.length) continue;
      const start = i + localBaseOff;
      if (start >= buf.length) continue;
      // 以 NUL 结尾的 ANSI 字符串
      let end = start;
      while (end < buf.length && buf[end] !== 0) end++;
      if (end - start < 3 || end - start > 1000) continue;
      const raw = buf.slice(start, end);
      ['gb18030', 'utf-8'].forEach(enc => {
        const s = this.decodeLnkBuffer(raw, enc);
        if (s && /^[A-Za-z]:\\/.test(s)) candidates.push(s);
      });
    }
    return candidates;
  },

  resolveLnk(lnkPath, wantDir) {
    if (wantDir === undefined) wantDir = true;
    let buf;
    try { buf = fs.readFileSync(lnkPath); } catch (e) { return null; }
    if (!buf || buf.length < 20) return null;

    const cands = [];

    // 1) 结构化：LinkInfo.LocalBasePath
    try { this.parseLinkInfoPath(buf).forEach(c => cands.push(c)); } catch (e) {}

    // 2) 正则扫描：多种编码 + 单字节与 UTF-16 两种形态
    const reAnsi = /[A-Za-z]:\\[^\u0000-\u001f"*?<>|]{1,240}/g;
    const reWide = /(?:[A-Za-z]:\\)(?:[\u0020-\uffff][\u0000]){1,240}/g;

    ['gb18030', 'utf-8', 'latin1'].forEach(enc => {
      const text = this.decodeLnkBuffer(buf, enc);
      if (!text) return;
      let m;
      reAnsi.lastIndex = 0;
      while ((m = reAnsi.exec(text))) cands.push(m[0]);
    });
    // UTF-16LE 形态（某些 .lnk 的 StringData 段是宽字符）
    try {
      const wide = buf.toString('utf16le');
      let m;
      reAnsi.lastIndex = 0;
      while ((m = reAnsi.exec(wide))) cands.push(m[0]);
    } catch (e) {}

    // 3) 逐个验证：必须真实存在；按 wantDir 过滤
    const seen = new Set();
    for (let c of cands) {
      if (!c) continue;
      c = String(c).replace(/\u0000+$/g, '').replace(/[\\/]+$/, '').trim();
      if (!c || seen.has(c)) continue;
      seen.add(c);
      if (!/^[A-Za-z]:\\/.test(c)) continue;
      let st;
      try { st = fs.statSync(c); } catch (e) { continue; }
      if (wantDir ? st.isDirectory() : (st.isDirectory() || st.isFile())) return c;
    }
    return null;
  },

  /* 列出共享目录内某个子目录的内容（relPath 为空表示根） */
  handleFiles(res, u) {
    const rel = (u && u.searchParams.get('path')) || '';
    let target = this.resolveInShare(rel);
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: '路径非法' }));
      return;
    }
    let st;
    try { st = fs.statSync(target); } catch (e) {
      // 容错：手机端可能传来的是快捷方式的"显示名"（去掉了 .lnk 后缀），
      // 这里补回后缀再试一次，避免因显示名/真实名不一致而报"目录不存在"。
      let retried = null;
      if (!/\.lnk$/i.test(target)) {
        const alt = target + '.lnk';
        try { if (fs.statSync(alt).isFile()) retried = alt; } catch (e2) {}
      }
      if (retried) {
        target = retried;
        st = fs.statSync(retried);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: '目录不存在' }));
        return;
      }
    }
    // 若目标本身是个 .lnk，尝试进入它指向的目录
    // （目标可能在共享目录之外，进入后登记为该次会话的可访问根）
    if (st.isFile() && /\.lnk$/i.test(target)) {
      const real = this.resolveLnk(target);
      if (real) {
        this.registerLnkRoot(real);
        const list = this.listDir(real);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: true,
          dir: real,
          rel: real.replace(/\\/g, '/'),   // 绝对路径作为 rel；后续可原样传回
          linked: true,
          linkName: path.basename(target).replace(/\.lnk$/i, ''),
          files: list.files,
          folders: list.folders,
          parent: path.posix.dirname(target.replace(/\\/g, '/'))
        }));
        return;
      }
    }
    if (!st.isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: '不是目录' }));
      return;
    }
    // rel 的表示：共享目录内用相对路径；已登记的快捷方式根用绝对路径
    const absTarget = path.resolve(target);
    const absShare = path.resolve(this.shareDir);
    let norm;
    if (absTarget === absShare || absTarget.startsWith(absShare + path.sep)) {
      norm = path.relative(absShare, absTarget).replace(/\\/g, '/');
    } else {
      norm = absTarget.replace(/\\/g, '/');   // 快捷方式跳出去的目录
    }
    const list = this.listDir(target);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      dir: target,
      rel: norm,
      linked: false,
      files: list.files,
      folders: list.folders,
      parent: this.parentOf(norm)
    }));
  },

  /* 计算"上一级"的 rel 值。
   * 共享目录内用相对路径（顶层返回 '' 表示回根）；
   * 快捷方式跳出去的目录用绝对路径，但不能越过已登记的白名单根。 */
  parentOf(norm) {
    if (!norm) return null;
    if (/^[A-Za-z]:\//.test(norm)) {
      const up = path.posix.dirname(norm.replace(/\\/g, '/'));
      if (up === norm) return null;
      // 不允许越过白名单根：若上一级已不在允许范围内，则返回 null（停在原地）
      let upFs;
      try { upFs = path.resolve(up); } catch (e) { return null; }
      return this.isUnderAllowed(upFs) ? up : null;
    }
    const up = path.posix.dirname(norm);
    return up === '.' ? '' : up;
  },

  /* 列出一个真实目录：文件与子目录分开返回。
   * .lnk 若指向文件夹，则作为"文件夹"展示（手机可直接进入）。
   *
   * 重要：每项都带回 fsName（磁盘上的真实名字）。
   * 手机端拼下一级路径时必须用 fsName，不能用显示名 name——
   * 快捷方式的显示名去掉了 .lnk 后缀，用显示名回传会找不到文件。 */
  listDir(dirPath) {
    const files = [], folders = [];
    let entries;
    try { entries = fs.readdirSync(dirPath); } catch (e) { return { files, folders }; }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const p = path.join(dirPath, name);
      let s;
      try { s = fs.lstatSync(p); } catch (e) { continue; }
      if (s.isDirectory()) {
        folders.push({ name, fsName: name, isDir: true, time: s.mtimeMs });
        continue;
      }
      if (/\.lnk$/i.test(name) && s.isFile()) {
        const real = this.resolveLnk(p);
        if (real) {
          let rs; try { rs = fs.statSync(real); } catch (e) { rs = null; }
          folders.push({
            name: name.replace(/\.lnk$/i, ''),   // 显示名（去掉后缀）
            fsName: name,                        // 真实名（用于拼路径）
            isDir: true, isLink: true,
            linkTarget: real,
            time: rs ? rs.mtimeMs : s.mtimeMs
          });
          continue;
        }
      }
      if (!s.isFile()) continue;
      files.push({ name, fsName: name, size: s.size, time: s.mtimeMs, ext: (path.extname(name) || '').toLowerCase().slice(1) });
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    files.sort((a, b) => (b.time || 0) - (a.time || 0));
    return { files, folders };
  },
  /* 手机下载电脑上的文件。两种来源：
   *   ?name=相对路径    —— 共享目录内的文件（可含子目录）
   *   ?outgoing=<msgId> —— 电脑主动"发到手机"列表里的文件（路径任选）
   * 支持 Range 断点续传。 */
  handleDownload(req, res, u) {
    let filePath = null;
    let downloadName = '';

    const outId = u.searchParams.get('outgoing');
    if (outId) {
      const r = this.resolveOutgoingFile(outId);
      if (!r) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('文件不存在或已被移除');
        return;
      }
      filePath = r.path;
      downloadName = r.msg.name || path.basename(r.path);
    } else {
      const sd = this.shareDir;
      if (!sd) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('未设置共享目录');
        return;
      }
      const rel = u.searchParams.get('name') || '';
      const full = this.resolveInShare(rel);
      if (!full) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('非法的文件名');
        return;
      }
      filePath = full;
      downloadName = path.basename(full);
    }

    let st;
    try { st = fs.statSync(filePath); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('文件不存在');
      return;
    }
    if (!st.isFile()) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('不是文件');
      return;
    }
    const total = st.size;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        let start = parseInt(m[1], 10);
        let end = m[2] ? parseInt(m[2], 10) : total - 1;
        if (isNaN(start) || start >= total || end >= total) start = 0;
        const chunk = end - start + 1;
        res.writeHead(206, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': chunk
        });
        const rs = fs.createReadStream(filePath, { start, end });
        rs.pipe(res);
        rs.on('error', () => { try { res.destroy(); } catch (e) {} });
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': total
    });
    const rs = fs.createReadStream(filePath);
    rs.pipe(res);
    rs.on('error', () => { try { res.destroy(); } catch (e) {} });
  },
  handleUpload(req, res, u) {
    if (this.busy) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('已有传输在进行，请稍候');
      return;
    }
    const name = decodeURIComponent(u.searchParams.get('name') || ('file_' + Date.now()));
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
    const contentType = req.headers['content-type'] || '';
    const size = Number(req.headers['content-length'] || 0);

    // 文字：作为"消息"记录（不再写入剪贴板历史）
    if (contentType.indexOf('text/') === 0) {
      let body = '';
      req.on('data', (c) => { body += c.toString('utf8'); });
      req.on('end', () => {
        this.addMessage({ dir: 'phone', kind: 'text', text: body });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('transfer:received', { name: safeName, path: null, isText: true, text: body });
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('OK 文字已收到');
      });
      req.on('aborted', () => {});
      return;
    }

    // 文件：流式写入，带背压控制，避免大文件 Load Failed
    const outPath = path.join(this.dir, safeName);
    this.busy = true;
    this.current = { name: safeName, size, received: 0 };
    this.startTime = Date.now();
    this._lastP = 0;
    this.pushStatus();

    const writer = fs.createWriteStream(outPath);

    req.on('data', (chunk) => {
      this.current.received += chunk.length;
      if (!writer.write(chunk)) {
        req.pause();  // 磁盘写入缓冲满，暂停接收
      }
      const now = Date.now();
      if (now - this._lastP > 500) { this._lastP = now; this.pushStatus(); }
    });

    // 磁盘写入完成，恢复接收
    writer.on('drain', () => { req.resume(); });

    req.on('end', () => {
      writer.end();
      writer.on('finish', () => {
        this.busy = false;
        this.current = null;
        this.pushStatus();
        this.received.unshift({ name: safeName, size, time: Date.now(), path: outPath });
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('transfer:receivedList', this.received.slice(0));
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('transfer:received', { name: safeName, path: outPath });
        // 作为"手机发来的文件"消息记录到聊天
        this.addMessage({ dir: 'phone', kind: 'file', name: safeName, size: size, path: outPath });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('OK 已接收: ' + safeName);
      });
      writer.on('error', () => {
        this.busy = false;
        this.pushStatus();
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('写入失败');
      });
    });

    req.on('aborted', () => {
      this.busy = false;
      this.current = null;
      this.pushStatus();
    });
  },

  /* ---------- 手机端新增端点 ---------- */

  /* 手机发来的纯文字（走独立端点，语义比 /upload 更清楚） */
  handleIncomingText(req, res) {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      const text = body || '';
      if (!text.trim()) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('内容为空');
        return;
      }
      this.addMessage({ dir: 'phone', kind: 'text', text: text });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transfer:received', { name: 'text', path: null, isText: true, text: text });
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OK 文字已收到');
    });
    req.on('error', () => {});
  },

  /* 手机端"接收"页：电脑发给手机的消息列表 */
  handleMessages(res) {
    if (!this.messages) this.messages = this.loadMessages();
    const list = this.messages
      .filter(m => m.dir === 'pc')
      .map(m => ({
        id: m.id, kind: m.kind, time: m.time,
        text: m.kind === 'text' ? m.text : undefined,
        name: m.kind === 'file' ? m.name : undefined,
        size: m.kind === 'file' ? m.size : undefined,
        isImage: m.kind === 'file' && /\.(png|jpe?g|gif|webp|bmp)$/i.test(m.name || ''),
        available: m.kind === 'file' ? !!this.resolveOutgoingFile(m.id) : true
      }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, messages: list }));
  },

  /* 手机端下载"电脑发来的文件" */
  handleOutgoing(req, res, u) {
    const id = u.searchParams.get('id') || '';
    const r = this.resolveOutgoingFile(id);
    if (!r) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('文件不存在');
      return;
    }
    let st;
    try { st = fs.statSync(r.path); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('文件不存在');
      return;
    }
    const name = r.msg.name || path.basename(r.path);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': st.size
    });
    const rs = fs.createReadStream(r.path);
    rs.pipe(res);
    rs.on('error', () => { try { res.destroy(); } catch (e) {} });
  },

  /* 手机端：电脑发来的图片的消息缩略图（省流版） */
  handleOutgoingThumb(req, res, u) {
    const id = u.searchParams.get('id') || '';
    const r = this.resolveOutgoingFile(id);
    if (!r) { res.writeHead(404); res.end('nf'); return; }
    const ext = (path.extname(r.path) || '').toLowerCase();
    if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(ext)) { res.writeHead(400); res.end('not image'); return; }
    const buf = this.makeImagePreview(r.path, u.searchParams.get('q') === 'hi' ? 'preview' : 'thumb');
    if (!buf) { res.writeHead(415); res.end('unsupported'); return; }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  },

  /* 生成图片预览（非持久化，即时生成后返回，不落盘）。
   * quality: 'thumb' = 手机网格用省流版（最长边 240px, JPEG q70）
   *          'preview' = PC 聊天窗口用清晰版（原图 0.5x，上限 800px, JPEG q85）
   * 返回 Buffer 或 null。 */
  makeImagePreview(full, quality) {
    let st;
    try { st = fs.statSync(full); } catch (e) { return null; }
    if (!st.isFile() || st.size > 40 * 1024 * 1024) return null;
    let img;
    try { img = nativeImage.createFromPath(full); } catch (e) { return null; }
    if (!img || img.isEmpty()) return null;
    const size = img.getSize();
    if (!size || !size.width) return null;

    let width;
    let q;
    if (quality === 'preview') {
      // 0.5x 分辨率，但不超过 800px（够看细节，又不至于太大）
      width = Math.round(size.width * 0.5);
      if (width > 800) width = 800;
      if (width < 1) width = size.width;
      q = 85;
    } else {
      width = size.width > 240 ? 240 : size.width;
      q = 70;
    }
    const out = width < size.width ? img.resize({ width, quality: 'good' }) : img;
    try { return out.toJPEG(q); } catch (e) { return null; }
  },

  /* HTTP 端点：手机端图片缩略图（只允许共享目录/已登记快捷方式内的图片） */
  handleThumb(req, res, u) {
    const rel = u.searchParams.get('name') || '';
    const full = this.resolveInShare(rel);
    if (!full) { res.writeHead(400); res.end('bad'); return; }
    const ext = (path.extname(full) || '').toLowerCase();
    if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(ext)) { res.writeHead(400); res.end('not image'); return; }
    let st;
    try { st = fs.statSync(full); } catch (e) { res.writeHead(404); res.end('nf'); return; }
    if (!st.isFile() || st.size > 30 * 1024 * 1024) { res.writeHead(400); res.end('too big'); return; }
    const q = u.searchParams.get('q') === 'hi' ? 'preview' : 'thumb';
    const buf = this.makeImagePreview(full, q);
    if (!buf) { res.writeHead(415); res.end('unsupported'); return; }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'      // 非持久化：不缓存
    });
    res.end(buf);
  },

  mobilePage() {
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>与电脑互传</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:12px;background:#f5f5f5;padding-bottom:20px}
h1{font-size:18px;margin:6px 0 10px}
.card{background:#fff;border-radius:12px;padding:14px;margin:10px 0;box-shadow:0 2px 8px rgba(0,0,0,.08)}
h2{font-size:14px;color:#333;margin:0 0 8px}
button{background:#3b82f6;color:#fff;border:none;padding:11px 16px;border-radius:8px;font-size:15px;width:100%;margin-top:8px}
button:disabled{background:#9cb8e6}
input,textarea{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:16px}
.tab{display:flex;gap:6px;margin:8px 0}
.tab button{background:#e5e7eb;color:#333;margin:0;padding:10px 0;flex:1;font-size:14px}
.tab button.on{background:#3b82f6;color:#fff}
.hide{display:none}
.small{font-size:12px;color:#666;margin-top:6px}
#bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:8px}
#fill{height:100%;width:0;background:#22c55e;transition:width .3s}
.empty{text-align:center;color:#999;padding:18px 0;font-size:14px}
.crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:#555;margin-bottom:8px;flex-wrap:wrap}
.crumb a{color:#3b82f6;text-decoration:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px}
.tile{background:#fafafa;border:1px solid #eee;border-radius:10px;overflow:hidden;cursor:pointer}
.tile .thumb{width:100%;height:90px;background:#eef1f5;display:flex;align-items:center;justify-content:center;font-size:30px;overflow:hidden}
.tile .thumb img{width:100%;height:100%;object-fit:cover;display:block}
.tile .cap{padding:6px;font-size:12px;word-break:break-all;line-height:1.3}
.tile .sub{font-size:11px;color:#999;margin-top:2px}
.msgWrap{display:flex;flex-direction:column;gap:8px;max-height:56vh;overflow-y:auto;padding:4px 2px}
.bub{max-width:78%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;word-break:break-word;white-space:pre-wrap}
.bub.me{align-self:flex-end;background:#95ec69;color:#111;border-bottom-right-radius:3px}
.bub.you{align-self:flex-start;background:#fff;border:1px solid #e5e5e5;color:#222;border-bottom-left-radius:3px}
.bub .t{font-size:11px;color:#888;margin-top:5px}
.bub .fn{font-weight:600;margin-bottom:3px}
.bub a{color:#1a56db}
.bub .cp{margin-top:6px;font-size:12px;color:#555;text-decoration:underline;cursor:pointer;display:inline-block}
.bub .iprev{margin-top:8px}
.bub .iprev img{max-width:100%;max-height:200px;border-radius:8px;display:block;cursor:zoom-in;background:#eef1f5}
.ovl{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:12px}
.ovl img{max-width:98vw;max-height:92vh;border-radius:8px}
#recvList{max-height:56vh;overflow-y:auto}
</style></head><body>
<h1>🔁 与电脑互传</h1>
<div class="tab">
  <button id="tabUp" onclick="tab('up')">发到电脑</button>
  <button id="tabIn" class="on" onclick="tab('in')">接收</button>
  <button id="tabDown" onclick="tab('down')">浏览电脑</button>
</div>

<!-- 发到电脑 -->
<section id="secUp" class="hide">
  <div class="card"><h2>✏️ 发送文字到电脑</h2>
  <textarea id="txt" rows="3" placeholder="输入要发送的文字"></textarea>
  <button onclick="sendText()">发送文字</button>
  <div class="small" id="msg"></div></div>
  <div class="card"><h2>📁 发送文件到电脑（可多选）</h2>
  <input type="file" id="file" multiple>
  <button onclick="sendFiles()">发送文件</button>
  <div id="bar" class="hide"><div id="fill"></div></div>
  <div class="small" id="msg2"></div></div>
</section>

<!-- 接收（电脑发来的） -->
<section id="secIn">
  <div class="card">
    <h2>📨 电脑发来的消息</h2>
    <div id="recvList" class="msgWrap"><div class="empty">加载中…</div></div>
    <button onclick="loadInbox(true)">🔄 刷新</button>
  </div>
</section>

<!-- 浏览电脑 -->
<section id="secDown" class="hide">
  <div class="card">
    <div class="crumb" id="crumb"></div>
    <div id="flist" class="grid"></div>
    <button onclick="loadFiles(true)">🔄 刷新</button>
  </div>
</section>

<script>
var curPath = '';
var busy = false;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function show(m,which){var e=document.getElementById(which||'msg');if(e)e.textContent=m;}
function tab(w){
  var ids={up:'secUp',in:'secIn',down:'secDown'};
  var tids={up:'tabUp',in:'tabIn',down:'tabDown'};
  Object.keys(ids).forEach(function(k){
    document.getElementById(ids[k]).classList.toggle('hide', k!==w);
    document.getElementById(tids[k]).classList.toggle('on', k===w);
  });
  if(w==='down') loadFiles();
  if(w==='in') loadInbox();
}
function fmt(n){n=Number(n)||0;if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB';}
function tstr(t){try{return new Date(t).toLocaleString();}catch(e){return '';}}

/* ---------- 发到电脑 ---------- */
async function sendText(){
  var t=document.getElementById('txt').value;
  if(!t.trim())return;
  try{
    var r=await fetch('/text',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:t});
    var x=await r.text();if(!x.startsWith('OK'))throw x;
    show('✓ 文字已发送到电脑');document.getElementById('txt').value='';
  }catch(e){show('发送失败: '+e);}
}
async function sendFiles(){
  var inp=document.getElementById('file');
  var fs2=inp.files;
  if(!fs2||!fs2.length)return;
  if(busy)return;
  busy=true;inp.disabled=true;
  var bar=document.getElementById('bar');bar.classList.remove('hide');
  var total=fs2.length, done=0, failed=[];
  show('⏳ 正在发送 0/'+total+' …','msg2');
  for(var i=0;i<total;i++){
    var f=fs2[i];
    document.getElementById('fill').style.width=Math.round(done/total*100)+'%';
    try{
      var resp=await fetch('/upload?name='+encodeURIComponent(f.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:f});
      var rt=await resp.text();
      if(!rt.startsWith('OK'))throw new Error(rt);
      done++;
    }catch(e){failed.push(f.name);}
    show('⏳ 正在发送 '+done+'/'+total+' …','msg2');
  }
  document.getElementById('fill').style.width='100%';
  busy=false;inp.disabled=false;
  if(failed.length) show('✓ 成功 '+done+' 个，失败: '+failed.join('、'),'msg2');
  else show('✓ 已全部发送（'+done+' 个）','msg2');
  setTimeout(function(){bar.classList.add('hide');inp.value='';},1500);
}

/* ---------- 接收（电脑 → 手机） ---------- */
var inboxCache = [];
function renderInbox(){
  var box=document.getElementById('recvList');
  if(!box)return;
  if(!inboxCache.length){box.innerHTML='<div class="empty">电脑还没有发来内容</div>';return;}
  box.innerHTML='';
  // 旧的在上：数组是从新到旧，这里倒序显示
  inboxCache.slice().reverse().forEach(function(m){
    var d=document.createElement('div');
    d.className='bub you';
    var html='';
    if(m.kind==='text'){
      html='<div>'+esc(m.text)+'</div>'+
        '<div class="cp" data-copy="'+esc(m.text)+'">📋 点击复制</div>';
    }else{
      html='<div class="fn">📄 '+esc(m.name)+'</div><div class="sub">'+fmt(m.size)+'</div>';
      // 图片：显示省流缩略图（点击可看大图）
      if(m.isImage&&m.available!==false){
        html+='<div class="iprev"><img loading="lazy" src="/outgoing-thumb?id='+encodeURIComponent(m.id)+'" alt="" data-hi="/outgoing-thumb?q=hi&id='+encodeURIComponent(m.id)+'"></div>';
      }
      if(m.available!==false){
        html+='<div><a href="/download?outgoing='+encodeURIComponent(m.id)+'">⬇️ 下载到手机</a></div>';
      }else{
        html+='<div class="sub">（电脑上该文件已不存在）</div>';
      }
    }
    html+='<div class="t">'+tstr(m.time)+'</div>';
    d.innerHTML=html;
    // 点缩略图看大图（放大层在内存里，不持久化）
    var ip=d.querySelector('.iprev img');
    if(ip){
      ip.addEventListener('click',function(){
        var ov=document.createElement('div');ov.className='ovl';
        var big=document.createElement('img');big.src=ip.getAttribute('data-hi')||ip.src;
        ov.appendChild(big);
        ov.addEventListener('click',function(){ov.remove();});
        document.body.appendChild(ov);
      });
    }
    var cp=d.querySelector('[data-copy]');
    if(cp){
      cp.addEventListener('click',function(){
        var tx=cp.getAttribute('data-copy');
        if(navigator.clipboard&&navigator.clipboard.writeText){
          navigator.clipboard.writeText(tx).then(function(){show('已复制','msg');cp.textContent='✓ 已复制';})
            .catch(function(){});
        }else{
          var ta=document.createElement('textarea');ta.value=tx;document.body.appendChild(ta);ta.select();
          try{document.execCommand('copy');cp.textContent='✓ 已复制';}catch(e){}
          ta.remove();
        }
      });
    }
    box.appendChild(d);
  });
}
async function loadInbox(manual){
  var box=document.getElementById('recvList');
  if(box&&!inboxCache.length)box.innerHTML='<div class="empty">加载中…</div>';
  try{
    var r=await fetch('/messages');var j=await r.json();
    inboxCache=(j&&j.messages)||[];
    renderInbox();
    if(manual)show('已刷新','msg');
  }catch(e){
    if(box)box.innerHTML='<div class="empty">加载失败: '+esc(e)+'</div>';
  }
}

/* ---------- 浏览电脑（网格 + 子目录 + 缩略图） ---------- */
var IMG_EXT={png:1,jpg:1,jpeg:1,gif:1,webp:1,bmp:1};
function iconFor(ext){
  if(IMG_EXT[ext])return '🖼️';
  if(ext==='mp3'||ext==='wav'||ext==='flac'||ext==='m4a'||ext==='ogg')return '🎵';
  if(ext==='mp4'||ext==='mkv'||ext==='avi'||ext==='mov'||ext==='webm')return '🎬';
  if(ext==='pdf')return '📕';
  if(ext==='zip'||ext==='rar'||ext==='7z')return '🗜️';
  if(ext==='txt'||ext==='md'||ext==='log')return '📄';
  if(ext==='js'||ext==='ts'||ext==='json'||ext==='html'||ext==='css'||ext==='py')return '💻';
  if(ext==='exe'||ext==='msi'||ext==='bat')return '⚙️';
  if(ext==='doc'||ext==='docx')return '📘';
  if(ext==='xls'||ext==='xlsx'||ext==='csv')return '📗';
  return '📄';
}
async function loadFiles(manual){
  var box=document.getElementById('flist');if(!box)return;
  box.innerHTML='<div class="empty">加载中…</div>';
  try{
    var r=await fetch('/files?path='+encodeURIComponent(curPath));
    var j=await r.json();
    if(!j.ok){box.innerHTML='<div class="empty">'+(j.msg||'读取失败')+'</div>';return;}
    var folders=j.folders||[], files=j.files||[];
    curPath=j.rel||'';
    // 面包屑
    var cb=document.getElementById('crumb');
    var parts=curPath?curPath.split('/'):[];
    var h='<span>📂</span><a href="#" data-p="">根目录</a>';
    var acc='';
    parts.forEach(function(p){
      acc=acc?acc+'/'+p:p;
      h+='<span>/</span><a href="#" data-p="'+esc(acc)+'">'+esc(p)+'</a>';
    });
    if(j.linked)h+='<span style="color:#888">（快捷方式）</span>';
    cb.innerHTML=h;
    cb.querySelectorAll('a[data-p]').forEach(function(a){
      a.addEventListener('click',function(ev){ev.preventDefault();curPath=a.getAttribute('data-p');loadFiles();});
    });

    box.innerHTML='';
    if(!folders.length&&!files.length){box.innerHTML='<div class="empty">（这个文件夹是空的）</div>';return;}

    folders.forEach(function(fo){
      var t=document.createElement('div');t.className='tile';
      // 显示用 name（快捷方式已去掉 .lnk）；拼路径必须用 fsName（磁盘真实名）
      var fsn=fo.fsName||fo.name;
      t.innerHTML='<div class="thumb">'+(fo.isLink?'🔗':'📁')+'</div><div class="cap">'+esc(fo.name)+
        '<div class="sub">'+(fo.isLink?'快捷方式':'文件夹')+'</div></div>';
      t.addEventListener('click',function(){curPath=(curPath?curPath+'/':'')+fsn;loadFiles();});
      box.appendChild(t);
    });
    files.forEach(function(f){
      var t=document.createElement('div');t.className='tile';
      var fsn=f.fsName||f.name;
      var thumb;
      if(IMG_EXT[f.ext]){
        thumb='<img loading="lazy" src="/thumb?name='+encodeURIComponent((curPath?curPath+'/':'')+fsn)+'" alt="">';
      }else{
        thumb=iconFor(f.ext);
      }
      t.innerHTML='<div class="thumb">'+thumb+'</div><div class="cap">'+esc(f.name)+
        '<div class="sub">'+fmt(f.size)+'</div></div>';
      t.addEventListener('click',function(){
        location.href='/download?name='+encodeURIComponent((curPath?curPath+'/':'')+fsn);
      });
      box.appendChild(t);
    });
    if(manual)show('已刷新','msg');
  }catch(e){
    box.innerHTML='<div class="empty">加载失败: '+esc(e)+'</div>';
  }
}

loadInbox();
</script></body></html>`;
  }
};

ipcMain.handle('transfer:start', (e, port, dir, shareDir) => TransferServer.start(port, dir, shareDir));
ipcMain.handle('transfer:stop', () => TransferServer.stop());
ipcMain.handle('transfer:getStatus', () => TransferServer.getStatus());
ipcMain.handle('transfer:getReceived', () => TransferServer.received.slice(0));

// 聊天消息（手机 ↔ 电脑）
ipcMain.handle('transfer:getMessages', () => {
  if (!TransferServer.messages) TransferServer.messages = TransferServer.loadMessages();
  return TransferServer.messages.slice(0);
});
/* 把任意本地图片转成预览 data URL（PC 聊天窗口用）。
 * 支持 'preview'（0.5x 清晰版）与 'thumb'（省流版）。 */
ipcMain.handle('transfer:imagePreview', (e, filePath, quality) => {
  try {
    if (!filePath) return { ok: false, msg: '路径为空' };
    const ext = (path.extname(String(filePath)) || '').toLowerCase();
    if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(ext)) return { ok: false, msg: '不是图片' };
    const buf = TransferServer.makeImagePreview(String(filePath), quality === 'thumb' ? 'thumb' : 'preview');
    if (!buf) return { ok: false, msg: '无法生成预览' };
    return { ok: true, dataUrl: 'data:image/jpeg;base64,' + buf.toString('base64') };
  } catch (er) {
    return { ok: false, msg: String(er && er.message || er) };
  }
});
ipcMain.handle('transfer:clearMessages', () => TransferServer.clearMessages());
ipcMain.handle('transfer:sendText', (e, text) => TransferServer.sendText(text));
ipcMain.handle('transfer:sendFiles', (e, paths) => {
  const list = Array.isArray(paths) ? paths : [paths];
  const ok = [], failed = [];
  list.forEach(p => {
    if (!p) return;
    const r = TransferServer.sendFile(p);
    if (r.ok) ok.push(r.item.name); else failed.push(path.basename(String(p)) + '（' + r.msg + '）');
  });
  return { ok: true, sent: ok, failed: failed };
});
