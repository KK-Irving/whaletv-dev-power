/**
 * Zmind HTTP 客户端封装（v2.1.1）。
 *
 * 设计目标：
 *   1. **WAF 限速应对**：公司 Zmind 部署在 Aliyun WAF 后，对单连接突发请求会
 *      返回 403/429/502/503。重试时使用 `Connection: close` 头要求服务器关闭
 *      连接，配合线性退避（0.8s × N），帮助下一次请求落到新连接上、避开 per-
 *      connection 计数。
 *
 *   2. **进程级速率门**：通过 `ZMIND_HTTP_MIN_INTERVAL` 控制所有出站 Zmind
 *      请求的最小间隔（毫秒，默认 0=禁用）。
 *
 *   3. **进程级并发上限**：通过 `ZMIND_FETCH_CONCURRENCY` 控制同时发起的
 *      Zmind 请求数（默认 2）。用一个简易 semaphore 实现。
 *
 *   4. **失败不阻塞**：5 次尝试全失败后抛 Error 让调用方决定（一般是记入
 *      `failed_attachments` 列表后继续处理后续）。
 *
 * 依赖：仅 Node.js 18+ 内建 fetch，无第三方依赖。
 */

// =============================================================================
// 配置（启动时一次性读取）
// =============================================================================

const ZMIND_HTTP_MIN_INTERVAL_MS = parsePositiveInt(
  process.env.ZMIND_HTTP_MIN_INTERVAL,
  0,
);
const ZMIND_FETCH_CONCURRENCY = Math.max(
  1,
  parsePositiveInt(process.env.ZMIND_FETCH_CONCURRENCY, 2),
);

const WAF_RETRY_STATUS_CODES = new Set([403, 429, 502, 503]);
const WAF_RETRY_MAX_ATTEMPTS = 5;
const WAF_RETRY_BACKOFF_MS = 800; // linear: 0.8s, 1.6s, 2.4s, 3.2s

function parsePositiveInt(s: string | undefined, defaultValue: number): number {
  if (typeof s !== "string") return defaultValue;
  const trimmed = s.trim();
  if (!/^\d+$/.test(trimmed)) return defaultValue;
  const value = parseInt(trimmed, 10);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// 进程级速率门：最小请求间隔
// =============================================================================

let _lastRequestTimestamp = 0;
const _rateLockChain: Promise<void>[] = []; // serial chain to enforce min-interval

/**
 * 等待距离上一次请求至少 `_ZMIND_HTTP_MIN_INTERVAL_MS` 毫秒。
 *
 * 用 promise 链确保多个并发调用按顺序消耗时间窗口（避免 `n` 个请求同时
 * 看到 `_lastRequestTimestamp` 然后并发出发，全部跳过限速）。
 */
async function paceBeforeRequest(): Promise<void> {
  if (ZMIND_HTTP_MIN_INTERVAL_MS <= 0) return;

  // 把"等待 + 更新 timestamp"作为一个原子段串到链尾
  const previousTail = _rateLockChain[_rateLockChain.length - 1] ?? Promise.resolve();
  const myTurn = previousTail.then(async () => {
    const now = Date.now();
    const elapsed = now - _lastRequestTimestamp;
    const waitMs = ZMIND_HTTP_MIN_INTERVAL_MS - elapsed;
    if (waitMs > 0) await sleep(waitMs);
    _lastRequestTimestamp = Date.now();
  });
  _rateLockChain.push(myTurn);
  await myTurn;
  // 防 chain 无限增长：每次取出后清理已结算的尾节点（GC 友好）
  if (_rateLockChain.length > 16) _rateLockChain.splice(0, _rateLockChain.length - 8);
}

// =============================================================================
// 进程级并发门：同时最多 N 个请求
// =============================================================================

let _activeRequests = 0;
const _concurrencyWaiters: Array<() => void> = [];

async function acquireConcurrencySlot(): Promise<void> {
  if (_activeRequests < ZMIND_FETCH_CONCURRENCY) {
    _activeRequests++;
    return;
  }
  await new Promise<void>((resolve) => _concurrencyWaiters.push(resolve));
  _activeRequests++;
}

function releaseConcurrencySlot(): void {
  _activeRequests = Math.max(0, _activeRequests - 1);
  const next = _concurrencyWaiters.shift();
  if (next) next();
}

// =============================================================================
// WAF 重试包装器
// =============================================================================

export interface ZmindFetchOptions extends RequestInit {
  /** 最大尝试次数（含首次），默认 5 */
  maxAttempts?: number;
}

/**
 * 带 WAF 重试 + 速率门 + 并发门的 fetch 包装。
 *
 * 重试策略（Property 5：WAF 重试隔离性）：
 *   - 首次请求使用全局 fetch（复用进程级 undici keep-alive 池，性能最好）
 *   - 后续 retry 强制 `Connection: close` 头，让服务端关闭连接，下一次请求
 *     用新连接（绕过 per-connection 计数）
 *   - 触发码 = `[403, 429, 502, 503]`
 *   - 退避 = `0.8s × attempt`
 *   - 最多 `maxAttempts` 次（默认 5）
 *
 * 失败终态：
 *   - 网络层抛异常（DNS/TCP）→ 直接 throw（非 WAF 限速场景）
 *   - 5 次都返回限速码 → 返回最后一次 Response（调用方根据 status 决定）
 */
export async function zmindFetch(
  url: string,
  options: ZmindFetchOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? WAF_RETRY_MAX_ATTEMPTS;
  await acquireConcurrencySlot();
  try {
    let lastResponse: Response | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await paceBeforeRequest();

      // 重试时强制关闭连接以避开 per-connection WAF 计数
      const headers: Record<string, string> = {
        ...(asPlainHeaders(options.headers) ?? {}),
      };
      if (attempt > 1) {
        headers["Connection"] = "close";
      }

      try {
        const res = await fetch(url, {
          ...options,
          headers,
        });
        if (!WAF_RETRY_STATUS_CODES.has(res.status)) {
          return res; // 成功 / 非限速错误 → 直接返回
        }
        lastResponse = res;
      } catch (e) {
        // 网络层错误：DNS/TCP/中断等。最后一次失败时把异常往上抛
        if (attempt >= maxAttempts) throw e;
        // 中间失败 → 走退避后继续
      }

      if (attempt < maxAttempts) {
        await sleep(WAF_RETRY_BACKOFF_MS * attempt);
      }
    }
    // 全部尝试完仍是限速码 → 返回最后一次 Response 让调用方处理
    return lastResponse!;
  } finally {
    releaseConcurrencySlot();
  }
}

/**
 * 兼容旧调用：把 `Headers | string[][] | Record<string, string>` 拍平成 plain object。
 */
function asPlainHeaders(
  h: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!h) return undefined;
  if (h instanceof Headers) {
    const result: Record<string, string> = {};
    h.forEach((v, k) => {
      result[k] = v;
    });
    return result;
  }
  if (Array.isArray(h)) {
    const result: Record<string, string> = {};
    for (const [k, v] of h) result[k] = v;
    return result;
  }
  return h as Record<string, string>;
}

// =============================================================================
// 启动诊断
// =============================================================================

/** 返回当前 HTTP 客户端配置摘要，用于启动 banner */
export function describeHttpClientConfig(): string {
  return [
    `min_interval=${ZMIND_HTTP_MIN_INTERVAL_MS}ms`,
    `concurrency=${ZMIND_FETCH_CONCURRENCY}`,
    `waf_retry_codes=[${[...WAF_RETRY_STATUS_CODES].join(",")}]`,
    `waf_retry_max_attempts=${WAF_RETRY_MAX_ATTEMPTS}`,
  ].join(", ");
}
