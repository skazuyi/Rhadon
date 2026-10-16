/* ============================================================
 * Alt+X 后台挂起开关 —— 后台服务插件（kind: 'service'）
 *
 * 作用：按 Alt+X 在工作台的两种后台模式之间切换
 *
 *   挂起模式（默认，省电）
 *     切到别的窗口 / 被遮挡时，Chromium 会自动降低刷新与定时器频率。
 *     省资源，但切回来时可能卡顿一下才"热身"完成。
 *
 *   保持活跃模式（不卡顿）
 *     关闭后台节流，切走再回来立刻就是顺的。
 *     代价是后台仍持续占用资源。
 *
 * 实现说明（重要）：
 *   Chromium 的后台节流开关（backgroundThrottling）**只在窗口创建时生效**，
 *   运行时改不了，所以切换模式必须**重建窗口**。
 *   重建前会先调用 persistAll() 保存快照，重建后窗口布局会自动恢复。
 *
 *   注意：快照只保存窗口位置/大小与播放列表，不保存各应用内部的临时输入状态。
 *   若检测到文件传输正在进行，会拒绝重建（中断传输代价太大）。
 * ============================================================ */

definePlugin({
  kind: 'service',
  id: 'altx-keepalive',
  name: 'Alt+X 后台挂起开关',
  icon: '⚡',
  describe: 'Alt+X 切换「允许挂起 / 保持活跃」',

  start(api) {
    const MODE_TEXT = {
      true: '当前：保持活跃（切走再回来不卡顿）',
      false: '当前：允许挂起（省资源，回来可能需热身）'
    };

    let keepAlive = false;   // 实际值从主进程读，避免重建窗口后状态丢失

    // 刷新显示：后台服务列表里的状态文字 + 任务栏 ⚡ 指示器
    const showStatus = () => {
      if (typeof api.setStatus === 'function') api.setStatus(MODE_TEXT[String(keepAlive)]);
      try {
        if (typeof KeepAliveIndicator !== 'undefined' && KeepAliveIndicator.apply) {
          KeepAliveIndicator.apply(keepAlive);
        }
      } catch (e) { /* 忽略 */ }
    };

    // 初始化：从主进程读取当前设置
    (async () => {
      try {
        if (window.electronAPI && window.electronAPI.getKeepAlive) {
          const r = await window.electronAPI.getKeepAlive();
          if (r && r.ok) keepAlive = !!r.keepAlive;
        }
      } catch (e) { /* 浏览器模式或读取失败，用默认值 */ }
      showStatus();
    })();

    const onKey = async (e) => {
      // Alt+X（不带 Ctrl / Shift / Meta）
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      if (String(e.key).toLowerCase() !== 'x') return;
      e.preventDefault();

      if (!window.electronAPI || !window.electronAPI.applyKeepAlive) {
        toast('切换后台模式仅在 Electron 下可用');
        return;
      }

      // 1) 传输进行中不重建，避免中断
      try {
        if (window.electronAPI.transferGetStatus) {
          const st = await window.electronAPI.transferGetStatus();
          if (st && st.current) {
            toast('文件传输进行中，暂不切换（避免中断传输）', 3200);
            return;
          }
        }
      } catch (err) { /* 查询失败不阻断 */ }

      const next = !keepAlive;

      // 2) 先保存快照，保证重建后布局能恢复
      try { if (typeof persistAll === 'function') persistAll(false); } catch (err) {}

      // 3) 应用新设置并重建窗口（主进程负责重建）
      try {
        const r = await window.electronAPI.applyKeepAlive(next);
        // 正常情况下窗口会立刻重建、本页被销毁，下面基本执行不到。
        // 但若重建失败（或被跳过），这里要保证内存状态与主进程一致，
        // 否则再按一次会算出同样的目标值，表现为"按了没反应"。
        if (r && typeof r.keepAlive === 'boolean') keepAlive = r.keepAlive;
        showStatus();
        toast(keepAlive ? '⚡ 已切换为「保持活跃」' : '💤 已切换为「允许挂起」');
      } catch (err) {
        toast('切换失败：' + ((err && err.message) || err), 3200);
      }
    };

    document.addEventListener('keydown', onKey);

    // 关掉开关 / 重新加载时撤销按键监听
    api.onCleanup(() => document.removeEventListener('keydown', onKey));
  }
});
