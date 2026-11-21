/* Demo mode: fake usage data so the panel can be previewed without a ClawsGO account.
 * Enable with `--demo` or HUD_DEMO=1. */

const isDemo = (argv = process.argv) => process.argv.includes('--demo') || process.env.HUD_DEMO === '1';

const iso = (ms) => new Date(ms).toISOString();
const dayKey = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function demoConversations() {
  const now = Date.now();
  return [
    {
      conversationId: 'demo-literature',
      title: '示例 · 文献综述整理',
      status: 'active',
      userId: 'demo-user',
      modelIds: ['clawsgo-1.5-titanium', 'web-search'],
      requestCount: 812,
      tokens: 98400000,
      amountMilli: 18650000,
      lastAt: iso(now - 3 * 60 * 1000),
    },
    {
      conversationId: 'demo-charts',
      title: '示例 · 实验数据可视化',
      status: 'active',
      userId: 'demo-user',
      modelIds: ['clawsgo-1.5-titanium'],
      requestCount: 143,
      tokens: 15200000,
      amountMilli: 4210000,
      lastAt: iso(now - 2 * 3600 * 1000),
    },
    {
      conversationId: 'demo-figures',
      title: '示例 · 论文图表重绘',
      status: 'active',
      userId: 'demo-user',
      modelIds: ['clawsgo-1.5-titanium', 'svg-generation'],
      requestCount: 96,
      tokens: 8400000,
      amountMilli: 2380000,
      lastAt: iso(now - 26 * 3600 * 1000),
    },
    {
      conversationId: 'demo-code',
      title: '示例 · 代码重构与测试',
      status: 'active',
      userId: 'demo-user',
      modelIds: ['clawsgo-1.5-titanium', 'gpt-6.1-terra'],
      requestCount: 77,
      tokens: 5100000,
      amountMilli: 1450000,
      lastAt: iso(now - 3 * 86400 * 1000),
    },
    {
      conversationId: 'demo-notes',
      title: '示例 · 会议纪要整理',
      status: 'active',
      userId: 'demo-user',
      modelIds: ['clawsgo-1.5-silicon'],
      requestCount: 34,
      tokens: 2000000,
      amountMilli: 680000,
      lastAt: iso(now - 6 * 86400 * 1000),
    },
    {
      conversationId: 'demo-glossary',
      title: '示例 · 术语表构建',
      status: 'active',
      userId: 'demo-user',
      modelIds: ['clawsgo-1.5-lithium'],
      requestCount: 12,
      tokens: 640000,
      amountMilli: 210000,
      lastAt: iso(now - 12 * 86400 * 1000),
    },
  ];
}

function demoDays(conversations) {
  const days = [];
  const models = ['clawsgo-1.5-titanium', 'clawsgo-1.5-silicon', 'claude-opus-5-5', 'web-search'];
  for (let i = 0; i < 30; i += 1) {
    const key = dayKey(i);
    const total = 1200000 + ((i * 7919) % 900000);
    const n = 1 + (i % 3);
    for (let j = 0; j < n; j += 1) {
      days.push({
        day: key,
        modelId: models[(i + j) % models.length],
        amountMilli: Math.round(total / n),
      });
    }
  }
  return days;
}

function demoData() {
  const now = Date.now();
  const conversations = demoConversations();
  const amountMilli = conversations.reduce((s, c) => s + c.amountMilli, 0);
  return {
    demo: true,
    teamId: 'demo-team',
    rangeDays: 30,
    subscription: {
      teamId: 'demo-team',
      planId: 'pro',
      planStartAt: iso(now - 45 * 86400 * 1000),
      planEndAt: iso(now + 16 * 86400 * 1000),
      cycleStartAt: iso(now - 14 * 86400 * 1000),
      balanceMilli: 89262000,
      monthlyMilli: 54018038,
      monthlyGrantMilli: 120000000,
      cycleSpentMilli: 71111000,
      planPeriod: 'month',
    },
    stats: {
      requestCount: conversations.reduce((s, c) => s + c.requestCount, 0),
      inputTokens: 2710000,
      cacheReadTokens: 128400000,
      cacheCreationTokens: 880000,
      outputTokens: 1720000,
      amountMilli,
      prevAmountMilli: 24300000,
      days: demoDays(conversations),
      byMember: [{ userId: 'demo-user', amountMilli }],
      byModel: [
        { modelId: 'clawsgo-1.5-titanium', amountMilli: Math.round(amountMilli * 0.78) },
        { modelId: 'clawsgo-1.5-silicon', amountMilli: Math.round(amountMilli * 0.11) },
        { modelId: 'claude-opus-5-5', amountMilli: Math.round(amountMilli * 0.08) },
        { modelId: 'web-search', amountMilli: Math.round(amountMilli * 0.03) },
      ],
      conversations,
    },
  };
}

const TURN_TEMPLATES = [
  {
    prompt: '把这三篇文献的结论整理成一页对比表',
    creditShare: 0.17,
    duration: 720000,
    input: 2100000,
    cacheRate: 0.94,
    output: 62000,
  },
  {
    prompt: '补一下 2023 年之后的综述，重点看方法部分',
    creditShare: 0.31,
    duration: 1080000,
    input: 3600000,
    cacheRate: 0.96,
    output: 88000,
  },
  {
    prompt: '把对比表改成三线表，参考文献按 GB/T 7714 排版',
    creditShare: 0.12,
    duration: 420000,
    input: 1200000,
    cacheRate: 0.93,
    output: 31000,
  },
  {
    prompt: '第 2 列的口径不一致，统一成百分比再核对一遍',
    creditShare: 0.05,
    duration: 180000,
    input: 480000,
    cacheRate: 0.91,
    output: 12000,
  },
  {
    prompt: '生成一页 PPT 汇报这版结果',
    creditShare: 0.24,
    duration: 840000,
    input: 2600000,
    cacheRate: 0.95,
    output: 71000,
  },
  {
    prompt: '最后检查一遍有没有互相矛盾的结论',
    creditShare: 0.11,
    duration: 540000,
    input: 980000,
    cacheRate: 0.92,
    output: 24000,
  },
];

function demoDetail(conversationId) {
  const data = demoData();
  const conv = data.stats.conversations.find((c) => c.conversationId === conversationId) || data.stats.conversations[0];
  const now = Date.now();
  const turns = TURN_TEMPLATES.map((t, i) => {
    const credits = Math.round(conv.amountMilli * t.creditShare);
    const start = now - 5 * 60 * 1000 - (TURN_TEMPLATES.length - 1 - i) * 1.15 * 86400000;
    const input = Math.round(t.input * (conv.amountMilli / 18650000));
    const cacheRead = Math.round(input * t.cacheRate);
    const output = Math.round(t.output * (conv.amountMilli / 18650000));
    const reqCount = Math.max(4, Math.round(conv.requestCount * t.creditShare));
    const requests = Array.from({ length: 4 }, (_, k) => ({
      at: iso(start + k * 60000),
      modelId: conv.modelIds[k % conv.modelIds.length],
      amountMilli: Math.round(credits / 4),
      input: Math.round(input / 4),
      cacheRead: Math.round(cacheRead / 4),
      output: Math.round(output / 4),
      mode: 'chat',
    }));
    return {
      id: `demo-turn-${i}`,
      index: i + 1,
      start,
      end: start + t.duration,
      durationMs: t.duration,
      model: conv.modelIds[0],
      prompt: t.prompt,
      files: i === 0 ? 3 : 0,
      usage: { input, cacheRead, output },
      credits,
      requestCount: reqCount,
      requests,
      gapBased: false,
    };
  });

  const byDay = {};
  for (const t of turns) {
    const key = new Date(t.start).toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + t.credits;
  }

  return {
    conversationId: conv.conversationId,
    count: conv.requestCount,
    amountMilli: conv.amountMilli,
    tokens: {
      input: turns.reduce((s, t) => s + t.usage.input - t.usage.cacheRead, 0),
      cacheRead: turns.reduce((s, t) => s + t.usage.cacheRead, 0),
      cacheCreation: 0,
      output: turns.reduce((s, t) => s + t.usage.output, 0),
    },
    byDay,
    byModel: Object.fromEntries(conv.modelIds.map((m, i) => [m, Math.round(conv.amountMilli * (i === 0 ? 0.9 : 0.1 / Math.max(1, conv.modelIds.length - 1)))])),
    modes: { chat: Math.round(conv.amountMilli * 0.55), delegate: Math.round(conv.amountMilli * 0.45) },
    turns: turns.slice().reverse(),
    turnCount: turns.length,
    scanned: 0,
    demo: true,
  };
}

module.exports = { isDemo, demoData, demoDetail };
