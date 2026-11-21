const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { readAuthFromApp } = require('./lib/token.cjs');
const winwatch = require('./lib/winwatch.cjs');
const { isDemo, demoData, demoDetail } = require('./lib/demo.cjs');
const { getSubscription, getUsageStats, getCreditLedger, getMessages, ApiError } = require('./lib/api.cjs');

const COLLAPSED = { width: 340, height: 78 };
const EXPANDED = { width: 432, height: 664 };

const EXE =
  process.env.CLAWSGO_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', '@clawsgodesktop', 'ClawsGO.exe');

const TARGET_EXE = 'ClawsGO.exe';
const DEMO = isDemo();

let win = null;
let tray = null;
let quitting = false;

const state = {
  bounds: null,
  collapsed: false,
  rangeDays: 30,
  pinned: false,
  follow: true,
};

const ctx = { token: null, teamId: null };

const store = { data: null, error: null, loading: false, updatedAt: 0 };
const detailCache = new Map();

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    Object.assign(state, {
      bounds: raw.bounds || null,
      collapsed: !!raw.collapsed,
      rangeDays: [7, 30, 90].includes(raw.rangeDays) ? raw.rangeDays : 30,
      pinned: raw.pinned === true,
      follow: raw.follow !== false,
    });
  } catch {
    /* first run */
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
    } catch {
      /* ignore */
    }
  }, 400);
}

/* ------------------------------------------------------------------ */
/* data                                                                */
/* ------------------------------------------------------------------ */

function buildState() {
  return {
    loading: store.loading,
    updatedAt: store.updatedAt,
    error: store.error,
    collapsed: state.collapsed,
    rangeDays: state.rangeDays,
    pinned: state.pinned,
    follow: state.follow,
    data: store.data,
  };
}

function broadcast() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', buildState());
}

function log(...args) {
  console.log('[hud]', ...args);
}

async function ensureContext(force = false) {
  if (ctx.token && !force) return ctx;
  const auth = await readAuthFromApp();
  ctx.token = auth.token;
  ctx.teamId = auth.teamId;
  log('token loaded for team', ctx.teamId);
  return ctx;
}

async function fetchData() {
  await ensureContext();
  const load = async () => {
    const [subscription, stats] = await Promise.all([
      getSubscription(ctx, ctx.teamId),
      getUsageStats(ctx, { teamId: ctx.teamId, rangeDays: state.rangeDays }),
    ]);
    return { subscription, stats, teamId: ctx.teamId, rangeDays: state.rangeDays };
  };
  try {
    return await load();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
      log('token rejected, refreshing from app storage');
      await ensureContext(true);
      return await load();
    }
    throw err;
  }
}

async function refresh(manual) {
  if (DEMO) {
    store.data = demoData();
    store.error = null;
    store.loading = false;
    store.updatedAt = Date.now();
    broadcast();
    return buildState();
  }
  if (store.loading) return buildState();
  store.loading = true;
  if (manual) store.error = null;
  broadcast();
  try {
    store.data = await fetchData();
    store.error = null;
    store.updatedAt = Date.now();
    log('refreshed', (store.data.stats.conversations || []).length, 'tasks');
  } catch (err) {
    store.error = {
      code: (err && err.code) || 'ERROR',
      message: (err && err.message) || String(err),
      at: Date.now(),
    };
    log('refresh failed:', store.error.code, store.error.message);
  } finally {
    store.loading = false;
    broadcast();
  }
  return buildState();
}

async function loadDetail(conversationId) {
  if (DEMO) return demoDetail(conversationId);
  const key = `${conversationId}:${state.rangeDays}`;
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.at < 120000) return hit.value;

  await ensureContext();
  const since = Date.now() - state.rangeDays * 86400000;
  const entries = [];
  let scanned = 0;
  let done = false;

  const withAuth = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        await ensureContext(true);
        return await fn();
      }
      throw err;
    }
  };

  const callPage = (offset) =>
    withAuth(() => getCreditLedger(ctx, { teamId: ctx.teamId, limit: 100, offset }));

  // messages (每轮对话) can be fetched in parallel with the ledger
  const messagesPromise = (async () => {
    const all = [];
    for (let offset = 0; offset < 4000; offset += 100) {
      let page;
      try {
        page = await withAuth(() => getMessages(ctx, { conversationId, limit: 100, offset }));
      } catch (err) {
        log('messages fetch failed:', err.code, err.message);
        break;
      }
      all.push(...page);
      if (page.length < 100) break;
    }
    return all;
  })();

  // fetch pages in small parallel batches (the ledger is newest-first)
  for (let batch = 0; !done && batch < 40; batch += 1) {
    const offsets = [];
    for (let i = 0; i < 5; i += 1) offsets.push(scanned + i * 100);
    const pages = await Promise.all(offsets.map((o) => callPage(o)));
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      if (!page.length) {
        done = true;
        continue;
      }
      for (const e of page) {
        const t = Date.parse(e.createdAt) || 0;
        if (e.metadata && e.metadata.conversationId === conversationId && t >= since) entries.push(e);
      }
      const oldest = Date.parse(page[page.length - 1].createdAt) || 0;
      if (page.length < 100 || oldest < since) done = true;
    }
    scanned += pages.reduce((sum, p) => sum + p.length, 0);
  }

  const byDay = {};
  const byModel = {};
  const modes = {};
  const tokens = { input: 0, cacheRead: 0, cacheCreation: 0, output: 0 };
  let amountMilli = 0;
  for (const e of entries) {
    const m = e.metadata || {};
    const amount = Math.abs(e.amountMilli || 0);
    amountMilli += amount;
    tokens.input += m.inputTokens || 0;
    tokens.cacheRead += m.cacheReadTokens || 0;
    tokens.cacheCreation += m.cacheCreationTokens || 0;
    tokens.output += m.outputTokens || 0;
    const day = new Date(e.createdAt).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + amount;
    const model = m.modelId || 'unknown';
    byModel[model] = (byModel[model] || 0) + amount;
    const mode = (e.turn && e.turn.mode) || 'chat';
    modes[mode] = (modes[mode] || 0) + amount;
  }

  const messages = await messagesPromise;
  const turnList = buildTurns(messages, entries);

  const value = {
    conversationId,
    count: entries.length,
    amountMilli,
    tokens,
    byDay,
    byModel,
    modes,
    turns: turnList,
    turnCount: turnList.length,
    scanned,
  };
  detailCache.set(key, { at: Date.now(), value });
  return value;
}

/** Split a conversation into "小对话" (one per assistant reply), using message windows. */
function buildTurns(messages, entries) {
  const toRequest = (e) => ({
    at: e.createdAt,
    modelId: (e.metadata && e.metadata.modelId) || '',
    amountMilli: Math.abs(e.amountMilli || 0),
    input: (e.metadata && e.metadata.inputTokens) || 0,
    cacheRead: (e.metadata && e.metadata.cacheReadTokens) || 0,
    output: (e.metadata && e.metadata.outputTokens) || 0,
    mode: (e.turn && e.turn.mode) || '',
  });

  const sortedEntries = entries
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const segments = [];
  if (messages && messages.length) {
    let prompt = null;
    let files = 0;
    for (const m of messages) {
      if (m.role === 'user') {
        const parts = (m.excerpt && m.excerpt.parts) || [];
        const textPart = parts.find((p) => p.type === 'text' && p.text);
        prompt = textPart ? String(textPart.text).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        files = parts.filter((p) => p.type === 'file').length;
        continue;
      }
      if (m.role !== 'assistant') continue;
      const start = Date.parse(m.createdAt) || 0;
      const usage = (m.metadata && m.metadata.usage) || null;
      const end = m.updatedAt
        ? Date.parse(m.updatedAt) || start
        : start + ((usage && usage.durationMs) || 0);
      segments.push({
        id: m.id,
        start,
        end,
        durationMs: (usage && usage.durationMs) || Math.max(0, end - start),
        model: m.modelId || '',
        prompt: prompt || '',
        files,
        usage: usage
          ? {
              input: usage.inputTokens || 0,
              cacheRead: usage.cacheReadTokens || 0,
              output: usage.outputTokens || 0,
            }
          : null,
        credits: 0,
        requests: [],
      });
    }
  }

  // fallback: no messages available → group by > 15 min gaps
  if (!segments.length && sortedEntries.length) {
    let current = null;
    for (const e of sortedEntries) {
      const t = Date.parse(e.createdAt) || 0;
      if (!current || t - current.end > 15 * 60 * 1000) {
        current = {
          id: `gap-${current ? current.start : t}`,
          start: t,
          end: t,
          durationMs: 0,
          model: (e.metadata && e.metadata.modelId) || '',
          prompt: '',
          files: 0,
          usage: null,
          credits: 0,
          requests: [],
          gapBased: true,
        };
        segments.push(current);
      }
      current.end = t;
      current.durationMs = current.end - current.start;
      current.requests.push(toRequest(e));
    }
  } else {
    // assign every charge to the latest reply that had already started
    const starts = segments.map((s) => s.start);
    for (const e of sortedEntries) {
      const t = Date.parse(e.createdAt) || 0;
      let lo = 0;
      let hi = starts.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= t + 1500) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx < 0) idx = 0;
      segments[idx].requests.push(toRequest(e));
    }
  }

  for (const s of segments) {
    s.credits = s.requests.reduce((sum, r) => sum + r.amountMilli, 0);
    s.requestCount = s.requests.length;
    if (!s.usage && s.requests.length) {
      s.usage = {
        input: s.requests.reduce((n, r) => n + r.input, 0),
        cacheRead: s.requests.reduce((n, r) => n + r.cacheRead, 0),
        output: s.requests.reduce((n, r) => n + r.output, 0),
      };
    }
    // keep payload small; newest requests first
    s.requests = s.requests
      .slice()
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 40);
  }

  const kept = segments.filter((s) => s.requestCount > 0 || s.usage);
  kept.sort((a, b) => a.start - b.start);
  kept.forEach((s, i) => {
    s.index = i + 1;
  });
  return kept.sort((a, b) => b.start - a.start);
}

/* ------------------------------------------------------------------ */
/* window                                                              */
/* ------------------------------------------------------------------ */

function applySize(animate) {
  if (!win) return;
  const size = state.collapsed ? COLLAPSED : EXPANDED;
  const b = win.getBounds();
  if (animate) win.setBounds({ x: b.x, y: b.y, width: size.width, height: size.height }, true);
  else win.setSize(size.width, size.height, false);
}

function defaultPosition(width) {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(area.x + area.width - width - 28), y: Math.round(area.y + 78) };
}

function createWindow() {
  const size = state.collapsed ? COLLAPSED : EXPANDED;
  const bounds = state.bounds || defaultPosition(size.width);

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    hasShadow: true,
    show: false,
    title: 'ClawsGO 算力看板',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(state.pinned, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('moved', () => {
    const b = win.getBounds();
    state.bounds = { x: b.x, y: b.y };
    saveState();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function setPinned(pinned) {
  state.pinned = pinned;
  saveState();
  if (win) win.setAlwaysOnTop(pinned, 'floating');
  updateTray();
  broadcast();
}

function toggleCollapsed(value) {
  state.collapsed = typeof value === 'boolean' ? value : !state.collapsed;
  saveState();
  applySize(true);
  broadcast();
}

/* ------------------------------------------------------------------ */
/* follow ClawsGO                                                      */
/* ------------------------------------------------------------------ */

let followTimer = null;
let hideTimer = null;
let manualUntil = 0;
let announcedMissing = false;
let suppressed = false;

function ensureOnScreen() {
  if (!win) return;
  const b = win.getBounds();
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y < a.y + a.height - 40 && b.y + b.height > a.y + 20;
  });
  if (!visible) {
    const size = state.collapsed ? COLLAPSED : EXPANDED;
    const pos = defaultPosition(size.width);
    win.setBounds({ x: pos.x, y: pos.y, width: size.width, height: size.height });
  }
}

function manualShow(seconds = 300) {
  manualUntil = Date.now() + seconds * 1000;
  suppressed = false;
  clearTimeout(hideTimer);
  ensureOnScreen();
  if (!win.isVisible()) win.show();
  win.focus();
  updateTray();
}

function hidePanel() {
  if (!win) return;
  win.setAlwaysOnTop(false);
  win.hide();
  suppressed = true;
  updateTray();
}

/** Poll ClawsGO's window: only show the board while ClawsGO is the active app. */
function updateFollow() {
  if (!win || win.isDestroyed()) return;

  if (DEMO) {
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(false);
    return;
  }

  if (!state.follow) {
    clearTimeout(hideTimer);
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(state.pinned, 'floating');
    return;
  }

  let target = null;
  let fgPid = 0;
  try {
    target = winwatch.findMainWindow(TARGET_EXE);
    fgPid = winwatch.foregroundPid();
  } catch (err) {
    return;
  }

  if (!target) {
    if (!announcedMissing) {
      announcedMissing = true;
      if (tray) {
        try {
          tray.displayBalloon({
            title: 'ClawsGO 算力看板',
            content: '打开 ClawsGO 后，看板会自动出现在它上面。',
          });
        } catch {}
      }
    }
    if (win.isVisible() && Date.now() > manualUntil) hidePanel();
    return;
  }

  const active = fgPid === target.pid || fgPid === process.pid;
  if (!active) suppressed = false;
  if (active && !suppressed) {
    clearTimeout(hideTimer);
    if (!win.isVisible()) {
      ensureOnScreen();
      win.showInactive();
      log('follow: target active → show panel (pid', target.pid, ')');
      updateTray();
    }
    win.setAlwaysOnTop(true, 'floating');
  } else if (win.isVisible() && !active && Date.now() > manualUntil) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      if (Date.now() <= manualUntil) return;
      try {
        const t = winwatch.findMainWindow(TARGET_EXE);
        const f = winwatch.foregroundPid();
        if (t && (f === t.pid || f === process.pid)) return;
      } catch {}
      log('follow: target inactive → hide panel');
      hidePanel();
    }, 700);
  }
}

function setFollow(follow) {
  state.follow = !!follow;
  saveState();
  if (state.follow) {
    manualUntil = 0;
    if (win && win.isVisible()) hidePanel();
  } else if (win && !win.isVisible()) {
    manualShow(0);
    manualUntil = 0;
  }
  updateTray();
  broadcast();
  updateFollow();
}

function startFollowLoop() {
  updateFollow();
  followTimer = setInterval(updateFollow, 1200);
}


/* ------------------------------------------------------------------ */
/* tray                                                                */
/* ------------------------------------------------------------------ */

function trayIcon() {
  const file = path.join(__dirname, 'assets', 'tray.png');
  if (fs.existsSync(file)) return nativeImage.createFromPath(file).resize({ width: 16, height: 16 });
  return nativeImage.createEmpty();
}

function openClawsGO() {
  if (!fs.existsSync(EXE)) {
    dialog.showMessageBox({ message: '没有找到 ClawsGO 安装位置', detail: EXE });
    return;
  }
  spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) hidePanel();
  else manualShow();
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: win && win.isVisible() ? '隐藏看板' : '显示看板', click: toggleWindow },
      { label: '刷新数据', click: () => refresh(true) },
      { type: 'separator' },
      {
        label: '跟随 ClawsGO（只在它活跃时显示）',
        type: 'checkbox',
        checked: state.follow,
        click: (item) => setFollow(item.checked),
      },
      {
        label: '窗口置顶（关闭跟随时生效）',
        type: 'checkbox',
        checked: state.pinned,
        enabled: !state.follow,
        click: (item) => setPinned(item.checked),
      },
      {
        label: '开机自动启动',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) =>
          app.setLoginItemSettings({
            openAtLogin: item.checked,
            path: process.execPath,
            args: [app.getAppPath()],
          }),
      },
      { type: 'separator' },
      { label: '打开 ClawsGO', click: openClawsGO },
      {
        label: '退出',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('ClawsGO 算力看板');
    tray.on('click', toggleWindow);
    updateTray();
  } catch (err) {
    log('tray failed', err);
  }
}

/* ------------------------------------------------------------------ */
/* ipc                                                                 */
/* ------------------------------------------------------------------ */

ipcMain.handle('app:state', () => buildState());
ipcMain.handle('app:refresh', () => refresh(true));
ipcMain.handle('app:range', async (_e, days) => {
  if ([7, 30, 90].includes(days) && days !== state.rangeDays) {
    state.rangeDays = days;
    detailCache.clear();
    saveState();
    return await refresh(true);
  }
  return buildState();
});
ipcMain.handle('app:collapse', (_e, value) => {
  toggleCollapsed(value);
  return buildState();
});
ipcMain.handle('app:pin', (_e, value) => {
  setPinned(!!value);
  return buildState();
});
ipcMain.handle('app:follow', (_e, value) => {
  setFollow(!!value);
  return buildState();
});
ipcMain.handle('app:detail', async (_e, id) => {
  try {
    return { ok: true, detail: await loadDetail(id) };
  } catch (err) {
    return {
      ok: false,
      error: { code: (err && err.code) || 'ERROR', message: (err && err.message) || String(err) },
    };
  }
});
ipcMain.handle('app:open', () => {
  openClawsGO();
  return true;
});
ipcMain.handle('app:quit', () => {
  quitting = true;
  app.quit();
  return true;
});
ipcMain.handle('app:export', async () => {
  const tasks = (store.data && store.data.stats && store.data.stats.conversations) || [];
  if (!tasks.length) return { ok: false, error: '暂无数据' };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出任务用量',
    defaultPath: `ClawsGO-任务用量-近${state.rangeDays}天.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const header = ['任务', '状态', '请求数', 'tokens', '算力', '最近活动', '模型'];
  const lines = [header.join(',')];
  for (const t of tasks) {
    lines.push(
      [
        t.title || '未命名任务',
        t.status || '',
        t.requestCount || 0,
        t.tokens || 0,
        ((t.amountMilli || 0) / 1000).toFixed(2),
        t.lastAt || '',
        (t.modelIds || []).join('|'),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
  }
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\r\n'), 'utf8');
  return { ok: true, filePath };
});

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

app.setName('ClawsGO 算力看板');

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    loadState();
    createWindow();
    createTray();
    startFollowLoop();
    refresh(false);
    setInterval(() => refresh(false), 60000);

  });

  app.on('window-all-closed', () => {
    /* keep running in tray */
  });

  app.on('before-quit', () => {
    quitting = true;
  });
}

