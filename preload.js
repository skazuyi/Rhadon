const { contextBridge, ipcRenderer } = require('electron');

// 提供给渲染进程的 Electron 专属 API
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  selectDir: () => ipcRenderer.invoke('fs:selectDir'),
  selectFiles: (filters) => ipcRenderer.invoke('fs:selectFiles', filters),
  readAsDataURL: (filePath) => ipcRenderer.invoke('fs:readAsDataURL', filePath),
  readText: (filePath, maxBytes) => ipcRenderer.invoke('fs:readText', filePath, maxBytes),
  openPath: (filePath) => ipcRenderer.invoke('fs:openPath', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('fs:showInFolder', filePath),

  // 剪贴板历史
  clipSetPath: (dir) => ipcRenderer.invoke('clip:setPath', dir),
  clipStart: () => ipcRenderer.invoke('clip:start'),
  clipStop: () => ipcRenderer.invoke('clip:stop'),
  clipGetItems: () => ipcRenderer.invoke('clip:getItems'),
  clipDelete: (id) => ipcRenderer.invoke('clip:delete', id),
  clipPin: (id) => ipcRenderer.invoke('clip:pin', id),
  clipCopyText: (text) => ipcRenderer.invoke('clip:copyText', text),
  clipCopyImage: (filePath) => ipcRenderer.invoke('clip:copyImage', filePath),
  onClipUpdate: (cb) => ipcRenderer.on('clip:update', (e, items) => cb(items)),

  // 局域网传输
  transferStart: (port, dir, shareDir) => ipcRenderer.invoke('transfer:start', port, dir, shareDir),
  transferStop: () => ipcRenderer.invoke('transfer:stop'),
  transferGetStatus: () => ipcRenderer.invoke('transfer:getStatus'),
  onTransferStatus: (cb) => ipcRenderer.on('transfer:status', (e, status) => cb(status)),
  onTransferReceived: (cb) => ipcRenderer.on('transfer:received', (e, info) => cb(info)),
  transferGetReceived: () => ipcRenderer.invoke('transfer:getReceived'),
  onTransferReceivedList: (cb) => ipcRenderer.on('transfer:receivedList', (e, list) => cb(list)),

  // 聊天消息（手机 ↔ 电脑 双向）
  transferGetMessages: () => ipcRenderer.invoke('transfer:getMessages'),
  transferClearMessages: () => ipcRenderer.invoke('transfer:clearMessages'),
  transferSendText: (text) => ipcRenderer.invoke('transfer:sendText', text),
  transferSendFiles: (paths) => ipcRenderer.invoke('transfer:sendFiles', paths),
  onTransferMessageList: (cb) => ipcRenderer.on('transfer:messageList', (e, list) => cb(list)),
  transferImagePreview: (filePath, quality) => ipcRenderer.invoke('transfer:imagePreview', filePath, quality),

  // 快捷操作 Actions
  actionsReadFiles: (dir) => ipcRenderer.invoke('actions:readFiles', dir),
  actionsReadText: (filePath) => ipcRenderer.invoke('actions:readText', filePath),
  actionsOpenExternal: (url) => ipcRenderer.invoke('actions:openExternal', url),
  actionsLaunchApp: (target, isExe) => ipcRenderer.invoke('actions:launchApp', target, isExe),
  actionsOpenFolder: (dir) => ipcRenderer.invoke('actions:openFolder', dir),
  actionsEnsureDefaultDir: () => ipcRenderer.invoke('actions:ensureDefaultDir'),

  // 后台活跃模式（挂起/保持活跃切换）
  getKeepAlive: () => ipcRenderer.invoke('app:getKeepAlive'),
  setKeepAlive: (v) => ipcRenderer.invoke('app:setKeepAlive', v),
  applyKeepAlive: (v) => ipcRenderer.invoke('app:applyKeepAlive', v),
  recreateWindow: () => ipcRenderer.invoke('app:recreateWindow')
});
