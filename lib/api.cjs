const BASE = 'https://api.clawsgo.cn';

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function rpc(ctx, method, data = {}, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  if (ctx.teamId) headers['x-team-id'] = ctx.teamId;
  let res;
  try {
    res = await fetch(`${BASE}/api/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(opts.timeoutMs || 20000),
    });
  } catch (err) {
    throw new ApiError('NETWORK', `网络请求失败：${(err && err.message) || err}`, 0);
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', `接口返回无法解析（HTTP ${res.status}）`, res.status);
  }
  if (payload && payload.error) {
    throw new ApiError(payload.error.code || 'API_ERROR', payload.error.message || '接口错误', res.status);
  }
  if (!res.ok) throw new ApiError('HTTP', `HTTP ${res.status}`, res.status);
  return payload.data;
}

const getSubscription = (ctx, teamId) =>
  rpc(ctx, 'getSubscription', { teamId }).then((d) => d.subscription);

const getUsageStats = (ctx, { teamId, rangeDays, memberId, modelId }) =>
  rpc(ctx, 'getUsageStats', {
    teamId,
    rangeDays,
    ...(memberId && memberId !== 'all' ? { memberId } : {}),
    ...(modelId && modelId !== 'all' ? { modelId } : {}),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  }).then((d) => d.usageStats);

const getCreditLedger = (ctx, { teamId, limit = 100, offset = 0 }) =>
  rpc(ctx, 'getCreditLedger', { teamId, limit, offset }).then((d) => d.entries || []);

const getMessages = (ctx, { conversationId, limit = 100, offset = 0 }) =>
  rpc(ctx, 'getMessages', { conversationId, limit, offset }).then((d) => d.messages || []);

module.exports = { ApiError, rpc, getSubscription, getUsageStats, getCreditLedger, getMessages };
