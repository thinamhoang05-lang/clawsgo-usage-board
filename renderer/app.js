/* global window, document */

const ui = {
  loading: true,
  error: null,
  collapsed: false,
  pinned: false,
  follow: true,
  rangeDays: 30,
  updatedAt: 0,
  data: null,
  sort: 'cost',
  detail: null,
  expandedTurn: null,
  refreshing: false,
};

const root = document.getElementById('root');
const mainEl = document.getElementById('main');
const detailEl = document.getElementById('detail');
const ftLeftEl = document.getElementById('ft-left');
const dotEl = document.getElementById('dot');
const planEl = document.getElementById('plan');

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const num = (n, digits = 0) =>
  Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const credits = (milli) => {
  const v = Number(milli || 0) / 1000;
  if (v >= 1000) return num(v, 0);
  if (v >= 100) return num(v, 1);
  return num(v, 2);
};

const tokens = (n) => {
  const v = Number(n || 0);
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e4) {
    const w = v / 1e4;
    return num(w, w >= 100 ? 0 : 1) + ' 万';
  }
  return num(v);
};

const localDay = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const relTime = (iso) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!t) return '—';
  const diff = Date.now() - t;
  if (diff < 45 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.max(1, Math.round(diff / 60000))} 分钟前`;
  if (diff < 86400 * 1000) return `${Math.round(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400 * 1000) return `${Math.round(diff / 86400000)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

const clock = (ts, withDate = false) => {
  if (!ts) return '';
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (!withDate) return hm;
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

const modelName = (id) => {
  const map = {
    'clawsgo-1.5-titanium': 'ClawsGO 1.5 Titanium',
    'clawsgo-1.5-silicon': 'ClawsGO 1.5 Silicon',
    'clawsgo-1.5-lithium': 'ClawsGO 1.5 Lithium',
    'claude-opus-5-5': 'Opus 5.5',
    'claude-sonnet-5': 'Sonnet 5',
    'gpt-6.1-terra': 'GPT-6.1 Terra',
    'image-generation': '图像生成',
    'svg-generation': 'SVG 生成',
    'web-search': '联网搜索',
  };
  return map[id] || id || '未知模型';
};

const modelShort = (id) => modelName(id).replace('ClawsGO 1.5 ', '').replace('ClawsGO ', '');

/* ------------------------------------------------------------------ */
/* derived data                                                        */
/* ------------------------------------------------------------------ */

function derive() {
  const data = ui.data;
  if (!data?.stats) return null;
  const { stats, subscription } = data;

  const daily = new Map();
  for (const d of stats.days || []) {
    daily.set(d.day, (daily.get(d.day) || 0) + (d.amountMilli || 0));
  }

  const today = localDay();
  const last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDay(d);
    last7.push({ day: key, milli: daily.get(key) || 0 });
  }
  const daily7 = last7.reduce((sum, d) => sum + d.milli, 0) / 7;

  const balance = subscription?.balanceMilli || 0;
  const grant = subscription?.monthlyGrantMilli || 0;
  const spent = subscription?.cycleSpentMilli || stats.amountMilli || 0;
  const cycleEnd = subscription?.planEndAt ? Date.parse(subscription.planEndAt) : 0;
  const daysToEnd = cycleEnd ? Math.max(0, (cycleEnd - Date.now()) / 86400000) : 0;
  const daysLeft = daily7 > 0 ? balance / daily7 : Infinity;

  const tasks = (stats.conversations || [])
    .map((t) => ({
      ...t,
      lastTs: Date.parse(t.lastAt) || 0,
      live: Date.now() - (Date.parse(t.lastAt) || 0) < 10 * 60 * 1000,
    }))
    .sort((a, b) => (ui.sort === 'recent' ? b.lastTs - a.lastTs : (b.amountMilli || 0) - (a.amountMilli || 0)));

  return {
    daily,
    last7,
    daily7,
    balance,
    grant,
    spent,
    daysLeft,
    daysToEnd,
    tasks,
    today,
    todayMilli: daily.get(today) || 0,
  };
}

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */

function renderHeader() {
  dotEl.className = 'dot' + (ui.error ? ' bad' : ui.data ? ' live' : '');
  const plan = (ui.data?.subscription?.planId || '').replace(/^./, (c) => c.toUpperCase());
  planEl.textContent = plan || '—';
  planEl.style.display = plan ? '' : 'none';

  const followBtn = document.querySelector('[data-act="follow"]');
  const refreshBtn = document.querySelector('[data-act="refresh"]');
  if (followBtn) followBtn.classList.toggle('active', ui.follow);
  if (refreshBtn) refreshBtn.classList.toggle('spinning', !!ui.loading);
}

function renderCollapsed(d) {
  document.getElementById('cb-used').textContent = d ? credits(d.spent) : '—';
  document.getElementById('cb-sub').textContent = d ? `本月已用 / ${credits(d.grant)}` : '本月已用算力';
  document.getElementById('cb-balance').textContent = d ? credits(d.balance) : '—';
  document.getElementById('cb-left').textContent = '余额';
}

function renderSummary(d) {
  const pct = d.grant > 0 ? Math.min(100, (d.spent / d.grant) * 100) : 0;
  const over = d.grant > 0 && d.spent > d.grant;
  const warn = !over && pct >= 85;
  const pace =
    d.daysLeft === Infinity
      ? '近 7 天没有消耗'
      : d.daysLeft >= d.daysToEnd
        ? `按日均可用至本期刷新（${Math.ceil(d.daysToEnd)} 天后）`
        : `按日均约 ${Math.ceil(d.daysLeft)} 天后用尽`;

  return `
    <div class="summary">
      <div class="sum-top">
        <div>
          <div class="sum-label">本月已用 · 额度 ${credits(d.grant)}</div>
          <div class="sum-value">${credits(d.spent)}<span class="unit">算力</span></div>
        </div>
        <div class="seg range">
          ${[7, 30, 90]
            .map((n) => `<button data-act="range" data-range="${n}" class="${ui.rangeDays === n ? 'on' : ''}">${n} 天</button>`)
            .join('')}
        </div>
      </div>
      <div class="bar"><i class="${over ? 'over' : warn ? 'warn' : ''}" style="width:${pct.toFixed(2)}%"></i></div>
      <div class="sum-meta">
        <span>余额 <b>${credits(d.balance)}</b></span>
        <span>日均 <b>${credits(d.daily7)}</b></span>
        <span class="hint">${esc(pace)}</span>
      </div>
    </div>`;
}

function renderTasks(d) {
  const total = d.tasks.reduce((s, t) => s + (t.amountMilli || 0), 0);
  const rows = d.tasks
    .slice(0, 60)
    .map((t) => {
      const title = (t.title || '').trim() || (t.status === 'deleted' ? '（任务已删除）' : '未命名任务');
      const meta = [t.requestCount ? `${num(t.requestCount)} 次` : null, `${tokens(t.tokens)} tokens`, relTime(t.lastAt)]
        .filter(Boolean)
        .join(' · ');
      return `
        <div class="task" data-conv="${esc(t.conversationId)}" data-title="${esc(title)}">
          <div class="t-body">
            <div class="t-title">${t.live ? '<span class="live-dot"></span>' : ''}<span class="${t.status === 'archived' ? 'archived' : ''}">${esc(title)}</span></div>
            <div class="t-meta">${esc(meta)}</div>
          </div>
          <div class="t-cost"><b>${credits(t.amountMilli)}</b><span>${total ? Math.round(((t.amountMilli || 0) / total) * 100) : 0}% 占比</span></div>
        </div>`;
    })
    .join('');

  return `
    <div class="sec-head">
      <div class="sec-title">任务消耗 · 近 <b>${ui.rangeDays}</b> 天 · <b>${d.tasks.length}</b> 个</div>
      <div class="seg">
        <button data-sort="cost" class="${ui.sort === 'cost' ? 'on' : ''}">按消耗</button>
        <button data-sort="recent" class="${ui.sort === 'recent' ? 'on' : ''}">按最近</button>
      </div>
    </div>
    <div class="tasks">${rows || '<div class="empty">这段时间还没有任务用量</div>'}</div>`;
}

function renderMain() {
  const scrollTop = mainEl.scrollTop;
  if (ui.collapsed) {
    mainEl.innerHTML = '';
    renderCollapsed(derive());
    return;
  }

  if (ui.error && !ui.data) {
    mainEl.innerHTML = `
      <div class="error-box">
        <b>读不到用量数据</b><br />${esc(ui.error.message)}
        <div><button class="retry" data-act="refresh">重试</button></div>
      </div>`;
    renderCollapsed(null);
    return;
  }

  if (!ui.data) {
    mainEl.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:200px"></div>';
    renderCollapsed(null);
    return;
  }

  const d = derive();
  renderCollapsed(d);
  mainEl.innerHTML = `${renderSummary(d)}${renderTasks(d)}${ui.error ? `<div class="error-box">${esc(ui.error.message)}</div>` : ''}`;
  mainEl.scrollTop = scrollTop;

  ftLeftEl.textContent = `今日 ${credits(d.todayMilli)} · ${ui.updatedAt ? clock(ui.updatedAt) + ' 更新' : ''}`;
}

function sparkline(byDay) {
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDay(d);
    days.push({ key, milli: byDay[key] || 0, label: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  const max = Math.max(1, ...days.map((d) => d.milli));
  const todayKey = localDay();
  return `
    <div class="spark">
      ${days
        .map(
          (d) =>
            `<div class="col ${d.key === todayKey ? 'today' : ''}" title="${d.label} · ${credits(d.milli)} 算力"><i style="height:${Math.max(3, (d.milli / max) * 100).toFixed(1)}%"></i></div>`,
        )
        .join('')}
    </div>
    <div class="spark-axis"><span>${days[0].label}</span><span>今天</span></div>`;
}

function renderTurns(turns, d) {
  if (!turns || !turns.length) return '';
  const total = turns.reduce((s, t) => s + t.credits, 0) || 1;
  const max = Math.max(1, ...turns.map((t) => t.credits));
  const avg = total / turns.length;
  const shown = turns.slice(0, 30);

  const requestRows = (t) =>
    t.requests
      .slice(0, 12)
      .map(
        (r) => `
        <div class="turn-req">
          <span class="turn-req-time">${clock(Date.parse(r.at), true)}</span>
          <span class="turn-req-model">${esc(modelShort(r.modelId))}</span>
          <span class="turn-req-tokens">入 ${num(r.input)} · 缓存 ${tokens(r.cacheRead)} · 出 ${num(r.output)}</span>
          <span class="turn-req-cost">${credits(r.amountMilli)}</span>
        </div>`,
      )
      .join('');

  return `
    <div class="d-sec">
      <div class="d-sec-title">每轮对话 · <b>${turns.length}</b> 轮 · 平均 ${credits(avg)} 算力/轮 · 点击展开请求</div>
      <div class="turns">
        ${shown
          .map((t) => {
            const open = ui.expandedTurn === t.id;
            const time = clock(t.start, true);
            const dur =
              t.durationMs >= 120000
                ? `${Math.round(t.durationMs / 60000)} 分`
                : t.durationMs > 1000
                  ? `${Math.round(t.durationMs / 1000)} 秒`
                  : '—';
            const share = Math.round((t.credits / total) * 100);
            const usage = t.usage || {};
            const cacheRate = usage.input > 0 ? Math.round((usage.cacheRead / usage.input) * 100) : 0;
            return `
            <div class="turn${open ? ' open' : ''}" data-turn="${esc(t.id)}">
              <div class="turn-head">
                <span class="turn-idx">${t.index}</span>
                <div class="turn-main">
                  <div class="turn-title">${esc(t.prompt || (t.gapBased ? '（按时间归并的请求）' : '（这一轮没有文字输入）'))}</div>
                  <div class="turn-meta">${time} · ${t.requestCount} 次请求 · ${dur}${t.files ? ` · ${t.files} 个附件` : ''}${
                    usage.input ? ` · 命中 ${cacheRate}%` : ''
                  }</div>
                </div>
                <div class="turn-cost"><b>${credits(t.credits)}</b><span>${share}%</span></div>
              </div>
              <div class="turn-bar"><i style="width:${Math.max(2, (t.credits / max) * 100).toFixed(1)}%"></i></div>
              ${
                open
                  ? `<div class="turn-requests">
                      <div class="turn-req-sum">
                        tokens：缓存 ${num(usage.cacheRead) || 0} · 新增 ${num(Math.max(0, (usage.input || 0) - (usage.cacheRead || 0)))} · 输出 ${num(usage.output) || 0}
                      </div>
                      ${requestRows(t)}
                      ${t.requests.length > 12 ? `<div class="turn-more">… 还有 ${t.requests.length - 12} 次更早的请求</div>` : ''}
                    </div>`
                  : ''
              }
            </div>`;
          })
          .join('')}
        ${turns.length > shown.length ? `<div class="turn-more">仅显示最近 ${shown.length} 轮，更早的轮次超出统计范围</div>` : ''}
      </div>
    </div>`;
}

function renderDetail() {
  const st = ui.detail;
  if (!st) {
    detailEl.classList.add('hidden');
    detailEl.innerHTML = '';
    return;
  }
  detailEl.classList.remove('hidden');
  const keepScroll = detailEl.scrollTop;

  const head = `
    <div class="d-head">
      <button class="d-back" data-act="back">‹</button>
      <div class="d-title">${esc(st.title)}
        <div class="d-sub">${
          st.data
            ? `${num(st.data.count)} 次请求 · ${st.data.turnCount || 0} 轮 · ${credits(st.data.amountMilli)} 算力${
                st.share ? ` · 占近 ${ui.rangeDays} 天 ${st.share}%` : ''
              }`
            : '加载中…'
        }</div>
      </div>
    </div>`;

  if (st.error) {
    detailEl.innerHTML = `${head}<div class="error-box">${esc(st.error.message)}<div><button class="retry" data-act="reload-detail">重试</button></div></div>`;
    return;
  }

  if (!st.data) {
    detailEl.innerHTML = `${head}<div class="d-loading">正在拉取这个任务的算力明细和每轮对话…<br />（首次可能要几秒）</div>`;
    return;
  }

  const d = st.data;
  const avg = d.count ? d.amountMilli / d.count : 0;
  const models = Object.entries(d.byModel || {}).sort((a, b) => b[1] - a[1]);
  const modelMax = models.length ? models[0][1] : 1;
  const modes = Object.entries(d.modes || {}).sort((a, b) => b[1] - a[1]);

  detailEl.innerHTML = `
    ${head}
    <div class="d-grid">
      <div class="d-cell"><b>${credits(d.amountMilli)}</b><span>算力</span></div>
      <div class="d-cell"><b>${num(d.count)}</b><span>请求</span></div>
      <div class="d-cell"><b>${tokens(d.tokens.input + d.tokens.cacheRead + d.tokens.output)}</b><span>tokens</span></div>
      <div class="d-cell"><b>${credits(avg)}</b><span>单次均耗</span></div>
    </div>

    ${renderTurns(d.turns, d)}

    <div class="d-sec">
      <div class="d-sec-title">每日消耗（近 14 天）</div>
      ${sparkline(d.byDay)}
    </div>

    <div class="d-sec">
      <div class="d-sec-title">token 拆分</div>
      <div class="rows">
        <div class="row"><span class="r-name">输入</span><span class="r-val">${num(d.tokens.input)}</span></div>
        <div class="row"><span class="r-name">缓存输入</span><span class="r-val">${num(d.tokens.cacheRead)}</span></div>
        <div class="row"><span class="r-name">输出</span><span class="r-val">${num(d.tokens.output)}</span></div>
        <div class="row"><span class="r-name">缓存命中率</span><span class="r-val">${
          d.tokens.input + d.tokens.cacheRead > 0
            ? Math.round((d.tokens.cacheRead / (d.tokens.input + d.tokens.cacheRead)) * 100) + '%'
            : '—'
        }</span></div>
      </div>
    </div>

    <div class="d-sec">
      <div class="d-sec-title">模型构成</div>
      <div class="rows">
        ${models
          .map(
            ([id, milli]) => `
          <div class="row">
            <span class="r-name">${esc(modelName(id))}</span>
            <span class="mini-bar"><i style="width:${((milli / modelMax) * 100).toFixed(0)}%"></i></span>
            <span class="r-dim">${credits(milli)} 算力</span>
          </div>`,
          )
          .join('')}
      </div>
    </div>
    ${
      modes.length > 1
        ? `<div class="d-sec">
      <div class="d-sec-title">运行方式</div>
      <div class="rows">${modes
        .map(
          ([mode, milli]) =>
            `<div class="row"><span class="r-name">${esc(mode === 'delegate' ? '委派 / 并行子任务' : mode === 'chat' ? '普通对话' : mode)}</span><span class="r-dim">${credits(milli)} 算力</span></div>`,
        )
        .join('')}</div>
    </div>`
        : ''
    }`;

  detailEl.scrollTop = keepScroll;
}

function render() {
  root.classList.toggle('collapsed', !!ui.collapsed);
  renderHeader();
  renderMain();
  renderDetail();
}

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

async function openDetail(conversationId, title) {
  const task = (ui.data?.stats?.conversations || []).find((t) => t.conversationId === conversationId);
  const total = ui.data?.stats?.amountMilli || 0;
  const share = task && total ? Math.round(((task.amountMilli || 0) / total) * 100) : 0;
  ui.detail = { id: conversationId, title, share, data: null, error: null };
  render();
  const res = await window.hud.detail(conversationId);
  if (ui.detail?.id !== conversationId) return;
  if (res?.ok) ui.detail.data = res.detail;
  else ui.detail.error = res?.error || { message: '加载失败' };
  render();
}

document.addEventListener('click', async (e) => {
  const actEl = e.target.closest('[data-act]');
  const sortEl = e.target.closest('[data-sort]');
  const taskEl = e.target.closest('.task');

  if (sortEl) {
    ui.sort = sortEl.dataset.sort;
    render();
    return;
  }

  if (taskEl) {
    openDetail(taskEl.dataset.conv, taskEl.dataset.title);
    return;
  }

  const turnHead = e.target.closest('.turn-head');
  if (turnHead) {
    const id = turnHead.closest('.turn')?.dataset.turn;
    if (id) {
      ui.expandedTurn = ui.expandedTurn === id ? null : id;
      render();
    }
    return;
  }

  if (!actEl) return;
  const act = actEl.dataset.act;

  if (act === 'refresh') {
    ui.loading = true;
    render();
    const next = await window.hud.refresh();
    apply(next);
  } else if (act === 'collapse') {
    ui.collapsed = !ui.collapsed;
    const next = await window.hud.setCollapsed(ui.collapsed);
    apply(next);
  } else if (act === 'follow') {
    const next = await window.hud.setFollow(!ui.follow);
    apply(next);
  } else if (act === 'quit') {
    window.hud.quit();
  } else if (act === 'open') {
    window.hud.openApp();
  } else if (act === 'export') {
    const res = await window.hud.exportCsv();
    if (res?.ok) {
      ftLeftEl.textContent = '已导出 CSV';
    }
  } else if (act === 'back') {
    ui.detail = null;
    render();
  } else if (act === 'reload-detail' && ui.detail) {
    openDetail(ui.detail.id, ui.detail.title);
  } else if (act === 'range') {
    const days = Number(actEl.dataset.range);
    ui.loading = true;
    const next = await window.hud.setRange(days);
    apply(next);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (ui.detail) {
      ui.detail = null;
      render();
    }
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    window.hud.refresh().then(apply);
  }
});

function apply(next) {
  if (!next) return;
  ui.loading = next.loading;
  ui.error = next.error;
  ui.collapsed = next.collapsed;
  ui.pinned = next.pinned;
  ui.follow = next.follow !== false;
  ui.rangeDays = next.rangeDays;
  ui.updatedAt = next.updatedAt;
  ui.data = next.data;
  if (!ui.data) ui.detail = null;
  render();
}

// range selector lives in the footer area of the summary; inject a segmented control into header? keep simple: click cycles
window.hud.onState(apply);

(async () => {
  apply(await window.hud.getState());
})();
