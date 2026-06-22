/**
 * Confluence 同步：拉 pages 写入本地 confluence_pages 表。
 *
 * 使用 cookie 认证（CONFLUENCE_BASE_URL + CONFLUENCE_COOKIE）。
 * 走 GET /rest/api/content?spaceKey=...&type=page 分页拉取所有页面，HTML 转纯文本入库。
 */

import { getDb, getSyncState, setSyncState, runInTransaction } from "../db.js";

const CONFLUENCE_BASE_URL = (process.env.CONFLUENCE_BASE_URL ?? "").replace(/\/+$/, "");
const CONFLUENCE_COOKIE = (process.env.CONFLUENCE_COOKIE ?? "").trim();
const CONFLUENCE_REQUEST_DELAY_MS = (() => {
  const raw = (process.env.CONFLUENCE_REQUEST_DELAY_MS ?? "").trim();
  if (!/^\d+$/.test(raw)) return 150;
  return parseInt(raw, 10);
})();

interface ConfluencePage {
  id: string;
  title?: string;
  space?: { key?: string };
  version?: { number?: number; when?: string };
  body?: { storage?: { value?: string } };
  history?: { createdDate?: string };
  _links?: { webui?: string };
}

interface ListResp {
  results?: ConfluencePage[];
  size?: number;
}

interface SpaceListResp {
  results?: Array<{ key?: string }>;
  size?: number;
}

async function confluenceGet<T = any>(
  pathOrUrl: string,
  params: Record<string, string | number>,
): Promise<T> {
  if (!CONFLUENCE_BASE_URL || !CONFLUENCE_COOKIE) {
    throw new Error(
      "缺少 Confluence 凭据：请配置 CONFLUENCE_BASE_URL + CONFLUENCE_COOKIE。运行 scripts/refresh-auth.* 自动生成。",
    );
  }
  const url = new URL(pathOrUrl, CONFLUENCE_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: CONFLUENCE_COOKIE,
    },
    redirect: "manual",
  });
  if (res.status === 302 || res.status === 303) {
    throw new Error(
      "Confluence 302 → /login.action：cookie 已过期。运行 scripts/refresh-auth.* 重新抓取。",
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Confluence HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

function stripHtml(html: string | undefined): string {
  if (!html) return "";
  let t = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  return t.replace(/\s+/g, " ").trim();
}

const UPSERT_SQL = `
INSERT INTO confluence_pages (
  id, space_key, title, body_text, version, webui, created, updated
) VALUES (
  @id, @space_key, @title, @body_text, @version, @webui, @created, @updated
)
ON CONFLICT(id) DO UPDATE SET
  space_key = excluded.space_key,
  title = excluded.title,
  body_text = excluded.body_text,
  version = excluded.version,
  webui = excluded.webui,
  created = excluded.created,
  updated = excluded.updated
`;

export interface ConfluenceSyncStats {
  source: "confluence";
  fetched: number;
  upserted: number;
  spaces: number;
  watermark: string;
}

async function listAllSpaces(): Promise<string[]> {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < 50; i++) {
    const data = await confluenceGet<SpaceListResp>("/rest/api/space", {
      type: "global",
      start,
      limit: 100,
    });
    const items = data.results ?? [];
    for (const s of items) if (s.key) out.push(s.key);
    if (items.length < 100) break;
    start += items.length;
    await sleep(CONFLUENCE_REQUEST_DELAY_MS);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 把 ISO 时间戳（含 T、Z）规范化为 CQL 可接受的 `YYYY-MM-DD HH:mm`。
 * Atlassian CQL parser 要求 day-or-minute 精度，不支持秒、毫秒、Z 后缀。
 *
 * @example
 *   "2026-06-22T10:30:45.123Z"  →  "2026-06-22 10:30"
 *   "2026-06-22"                →  "2026-06-22 00:00"
 */
function toCqlDateTime(s: string): string {
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d, hh = "00", mm = "00"] = m;
  return `${y}-${mo}-${d} ${hh}:${mm}`;
}

/**
 * 全量/增量同步 Confluence pages。
 *
 * @param args.space  仅同步指定空间（可重复传入多个空间用 CSV，如 "TVENG,DOC"）
 * @param args.limit  最大同步条数（防一次性拉爆）。默认 1000；传 0 / 负数 = 不限
 * @param args.since  仅同步 lastmodified > since 的页面（YYYY-MM-DD HH:mm）
 */
export async function syncConfluence(args: {
  space?: string;
  since?: string;
  limit?: number;
} = {}): Promise<ConfluenceSyncStats> {
  const db = getDb();
  // limit ≤ 0 → 无限拉
  const userLimit = args.limit;
  const limit =
    userLimit == null
      ? 1000
      : userLimit <= 0
        ? Number.MAX_SAFE_INTEGER
        : userLimit;
  const stateSinceRaw = args.since ?? getSyncState("confluence", "last_full_sync") ?? "";
  const stateSince = stateSinceRaw ? toCqlDateTime(stateSinceRaw) : "";

  // 决定要同步的空间集合
  let spaces: string[];
  if (args.space) {
    spaces = args.space.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  } else {
    spaces = await listAllSpaces();
  }

  const upsert = db.prepare(UPSERT_SQL);
  function upsertMany(rows: any[]): void {
    runInTransaction(db, () => {
      for (const r of rows) upsert.run(r);
    });
  }

  let fetched = 0;
  let upserted = 0;
  let maxUpdated = stateSinceRaw;
  const pageSize = 100;

  for (const spaceKey of spaces) {
    let start = 0;
    let pageInSpace = 0;
    while (fetched < limit) {
      const remaining = limit - fetched;
      const n = Math.min(pageSize, remaining);
      let resp: ListResp;
      if (stateSince) {
        // 走 CQL 增量（lastmodified 用 day/minute 精度格式）
        const cql = `space.key = "${spaceKey}" AND type = page AND lastmodified > "${stateSince}"`;
        resp = await confluenceGet<ListResp>("/rest/api/content/search", {
          cql,
          start,
          limit: n,
          expand: "body.storage,version,space",
        });
      } else {
        resp = await confluenceGet<ListResp>("/rest/api/content", {
          spaceKey,
          type: "page",
          start,
          limit: n,
          expand: "body.storage,version,space",
        });
      }
      const items = resp.results ?? [];
      if (items.length === 0) break;

      const rows = items.map((p) => ({
        id: String(p.id),
        space_key: p.space?.key ?? spaceKey,
        title: p.title ?? "",
        body_text: stripHtml(p.body?.storage?.value),
        version: p.version?.number ?? 0,
        webui: p._links?.webui ?? "",
        created: p.history?.createdDate ?? "",
        updated: p.version?.when ?? "",
      }));
      upsertMany(rows);

      fetched += items.length;
      upserted += items.length;
      start += items.length;
      pageInSpace++;

      // 跟踪最大 updated（用于 watermark）
      for (const r of rows) {
        if (r.updated && r.updated > maxUpdated) maxUpdated = r.updated;
      }

      process.stderr.write(
        `[confluence-sync] space=${spaceKey} page=${pageInSpace}, got=${items.length}, total=${fetched}\n`,
      );

      if (items.length < n) break;
      await sleep(CONFLUENCE_REQUEST_DELAY_MS);
    }
    if (fetched >= limit) break;
  }

  // watermark：用已拉取的最大 updated 时间的 CQL 格式（YYYY-MM-DD HH:mm）
  const watermark = maxUpdated ? toCqlDateTime(maxUpdated) : stateSince || toCqlDateTime(new Date().toISOString());
  setSyncState("confluence", "last_full_sync", watermark);

  return {
    source: "confluence",
    fetched,
    upserted,
    spaces: spaces.length,
    watermark,
  };
}
