/**
 * Gerrit 同步：拉 changes 写入本地 gerrit_changes 表。
 *
 * 双通道认证（与 gerrit-mcp v1.1.0 一致）：
 *   - session 模式（首选）：GERRIT_AUTH_HEADER + GERRIT_COOKIE，走 non-/a/ 路径
 *   - basic 模式（备选）：GERRIT_USERNAME + GERRIT_HTTP_PASSWORD，走 /a/ 路径
 *
 * Gerrit 响应首行的 `)]}'` XSSI 防护前缀会被剥离。
 */

import { getDb, getSyncState, setSyncState, runInTransaction } from "../db.js";

const GERRIT_URL = (process.env.GERRIT_URL ?? "").replace(/\/+$/, "");
const GERRIT_AUTH_HEADER = (process.env.GERRIT_AUTH_HEADER ?? "").trim();
const GERRIT_COOKIE = (process.env.GERRIT_COOKIE ?? "").trim();
const GERRIT_USERNAME = (process.env.GERRIT_USERNAME ?? "").trim();
const GERRIT_HTTP_PASSWORD = process.env.GERRIT_HTTP_PASSWORD ?? "";

type AuthMode = "session" | "basic" | "missing";

function authMode(): AuthMode {
  if (GERRIT_AUTH_HEADER && GERRIT_COOKIE) return "session";
  if (GERRIT_USERNAME && GERRIT_HTTP_PASSWORD) return "basic";
  return "missing";
}

function buildHeaders(mode: AuthMode): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (mode === "session") {
    h.Authorization = GERRIT_AUTH_HEADER;
    h.Cookie = GERRIT_COOKIE;
  } else if (mode === "basic") {
    const enc = Buffer.from(`${GERRIT_USERNAME}:${GERRIT_HTTP_PASSWORD}`, "utf8").toString(
      "base64",
    );
    h.Authorization = `Basic ${enc}`;
  }
  return h;
}

function injectAuthPrefix(p: string, mode: AuthMode): string {
  const norm = p.startsWith("/") ? p : `/${p}`;
  if (mode === "session") {
    if (norm.startsWith("/a/")) return norm.slice(2);
    return norm;
  }
  if (norm === "/a" || norm.startsWith("/a/")) return norm;
  return `/a${norm}`;
}

function stripXssi(text: string): string {
  if (text.startsWith(")]}'")) return text.slice(4).trimStart();
  return text;
}

interface GerritChange {
  change_id?: string;
  _number?: number;
  _more_changes?: boolean;
  project?: string;
  branch?: string;
  subject?: string;
  status?: string;
  created?: string;
  updated?: string;
  owner?: { name?: string };
  revisions?: Record<string, { commit?: { message?: string } }>;
}

async function gerritGet(path: string, params: Array<[string, string]>): Promise<GerritChange[]> {
  if (!GERRIT_URL) throw new Error("GERRIT_URL 未配置");
  const mode = authMode();
  if (mode === "missing") {
    throw new Error(
      "缺少 Gerrit 凭据：请配置 GERRIT_AUTH_HEADER+GERRIT_COOKIE (session) 或 GERRIT_USERNAME+GERRIT_HTTP_PASSWORD (basic)。运行 scripts/refresh-auth.* 自动生成。",
    );
  }

  const apiPath = injectAuthPrefix(path, mode);
  const url = new URL(apiPath, GERRIT_URL);
  for (const [k, v] of params) url.searchParams.append(k, v);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(mode),
  });
  const text = await res.text();
  const stripped = stripXssi(text);
  if (!res.ok) {
    throw new Error(`Gerrit HTTP ${res.status} (auth_mode=${mode}): ${stripped.slice(0, 300)}`);
  }
  if (!stripped) return [];
  try {
    return JSON.parse(stripped) as GerritChange[];
  } catch (e) {
    throw new Error(
      `Gerrit 响应 JSON 解析失败: ${(e as Error).message}; preview=${stripped.slice(0, 200)}`,
    );
  }
}

function commitMessageOf(ch: GerritChange): string {
  for (const rev of Object.values(ch.revisions ?? {})) {
    const msg = rev?.commit?.message ?? "";
    if (msg) return msg;
  }
  return "";
}

export interface GerritSyncStats {
  source: "gerrit";
  fetched: number;
  upserted: number;
  watermark: string;
  query: string;
}

const UPSERT_SQL = `
INSERT INTO gerrit_changes (
  change_id, number, project, branch, subject,
  commit_message, owner_name, status, created, updated
) VALUES (
  @change_id, @number, @project, @branch, @subject,
  @commit_message, @owner_name, @status, @created, @updated
)
ON CONFLICT(change_id) DO UPDATE SET
  number = excluded.number,
  project = excluded.project,
  branch = excluded.branch,
  subject = excluded.subject,
  commit_message = excluded.commit_message,
  owner_name = excluded.owner_name,
  status = excluded.status,
  created = excluded.created,
  updated = excluded.updated
`;

function buildQuery(args: { since?: string; query?: string; project?: string }): string {
  const parts: string[] = [];
  if (args.query) parts.push(args.query);
  if (args.project) parts.push(`project:${args.project}`);
  if (args.since) parts.push(`after:"${args.since}"`);
  if (parts.length === 0) parts.push("status:open OR -status:open"); // all
  return parts.join(" ");
}

/**
 * 全量/增量同步 Gerrit changes。
 */
export async function syncGerrit(args: {
  query?: string;
  project?: string;
  since?: string;
  limit?: number;
} = {}): Promise<GerritSyncStats> {
  const db = getDb();
  const limit = Math.max(1, Math.min(50000, args.limit ?? 1000));
  const stateSince = args.since ?? getSyncState("gerrit", "last_full_sync_date") ?? "";
  const finalQuery = buildQuery({
    since: stateSince,
    query: args.query,
    project: args.project,
  });

  const upsert = db.prepare(UPSERT_SQL);
  function upsertMany(rows: any[]): void {
    runInTransaction(db, () => {
      for (const r of rows) upsert.run(r);
    });
  }

  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  const batchSize = 200;

  while (fetched < limit) {
    const remaining = limit - fetched;
    const n = Math.min(batchSize, remaining);
    const params: Array<[string, string]> = [
      ["q", finalQuery],
      ["n", String(n)],
      ["S", String(offset)],
      ["o", "CURRENT_REVISION"],
      ["o", "CURRENT_COMMIT"],
      ["o", "DETAILED_ACCOUNTS"],
    ];
    const changes = await gerritGet("/changes/", params);
    if (changes.length === 0) break;

    const rows = changes.map((ch) => ({
      change_id: ch.change_id ?? String(ch._number ?? ""),
      number: ch._number ?? null,
      project: ch.project ?? "",
      branch: ch.branch ?? "",
      subject: ch.subject ?? "",
      commit_message: commitMessageOf(ch),
      owner_name: ch.owner?.name ?? "",
      status: ch.status ?? "",
      created: ch.created ?? "",
      updated: ch.updated ?? "",
    }));
    upsertMany(rows);

    fetched += changes.length;
    upserted += changes.length;
    offset += changes.length;

    if (changes.length < n) break;
    if (!changes[changes.length - 1]?._more_changes) break;
  }

  const today = new Date().toISOString().slice(0, 10);
  setSyncState("gerrit", "last_full_sync_date", today);

  return { source: "gerrit", fetched, upserted, watermark: today, query: finalQuery };
}
