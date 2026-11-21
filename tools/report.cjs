#!/usr/bin/env node
/* ClawsGO 算力报告（命令行版）
 * 用法：
 *   node tools/report.cjs                 # 近 30 天
 *   node tools/report.cjs --days 7
 *   node tools/report.cjs --top 20
 *   node tools/report.cjs --json
 */
const { readAuthFromApp } = require('../lib/token.cjs');
const { getSubscription, getUsageStats, ApiError } = require('../lib/api.cjs');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const days = Number(arg('days', 30)) || 30;
const top = Number(arg('top', 25)) || 25;
const asJson = !!arg('json', false);

const fmt = (milli) => (Number(milli || 0) / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const tokens = (n) => {
  const v = Number(n || 0);
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return String(v);
};
const pad = (s, n) => {
  const str = String(s);
  let width = 0;
  for (const ch of str) width += ch.charCodeAt(0) > 255 ? 2 : 1;
  return str + ' '.repeat(Math.max(0, n - width));
};
const rel = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

(async () => {
  const auth = await readAuthFromApp();
  const ctx = { token: auth.token, teamId: auth.teamId };
  const [sub, stats] = await Promise.all([
    getSubscription(ctx, ctx.teamId),
    getUsageStats(ctx, { teamId: ctx.teamId, rangeDays: days }),
  ]);

  const tasks = (stats.conversations || [])
    .slice()
    .sort((a, b) => b.amountMilli - a.amountMilli);
  const total = stats.amountMilli || 0;

  if (asJson) {
    console.log(JSON.stringify({ subscription: sub, stats }, null, 2));
    return;
  }

  const balance = sub.balanceMilli || 0;
  const grant = sub.monthlyGrantMilli || 0;
  const spent = sub.cycleSpentMilli || 0;

  console.log('');
  console.log(`ClawsGO 算力报告 · 近 ${days} 天 · 团队 ${ctx.teamId}`);
  console.log(`本月已用 ${fmt(spent)} / ${fmt(grant)} 算力    余额 ${fmt(balance)} 算力`);
  console.log(
    `统计期内：${fmt(total)} 算力 · ${stats.requestCount} 次请求 · ${tokens(
      stats.inputTokens + stats.cacheReadTokens + stats.outputTokens,
    )} tokens`,
  );
  console.log('');
  console.log(pad('任务', 34) + pad('算力', 12) + pad('占比', 8) + pad('请求', 8) + pad('tokens', 10) + '最近活动');
  console.log('-'.repeat(96));
  for (const t of tasks.slice(0, top)) {
    const title = (t.title || '未命名任务').slice(0, 15);
    console.log(
      pad(title, 34) +
        pad(fmt(t.amountMilli), 12) +
        pad(total ? Math.round((t.amountMilli / total) * 100) + '%' : '-', 8) +
        pad(t.requestCount, 8) +
        pad(tokens(t.tokens), 10) +
        rel(t.lastAt),
    );
  }
  if (tasks.length > top) console.log(`… 另有 ${tasks.length - top} 个任务（--top 调整）`);
  console.log('');
})().catch((err) => {
  if (err instanceof ApiError) {
    console.error(`请求失败（${err.code}）：${err.message}`);
    if (err.code === 'UNAUTHORIZED') console.error('提示：先在 ClawsGO 里登录，再重跑本命令。');
  } else {
    console.error(err && err.message ? err.message : err);
  }
  process.exit(1);
});
