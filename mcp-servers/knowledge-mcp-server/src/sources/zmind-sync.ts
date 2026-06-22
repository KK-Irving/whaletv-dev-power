/**
 * Zmind 同步：拉 issues 写入本地 zmind_issues 表。
 *
 * 复用环境变量：
 *   - ZMIND_URL          (默认 https://zmind.whaletv.com)
 *   - ZMIND_API_KEY      必填
 */

import { getDb, getSyncState, setSyncState, runInTransaction } from "../db.js";

const ZMIND_URL = (process.env.ZMIND_URL ?? "https://zmind.whaletv.com").replace(/\/+$/, "");
const ZMIND_API_KEY = process.env.ZMIND_API_KEY ?? "";

interface ZmindListResp {
  issues?: Array<{
    id: number;
    tracker?: { name?: string };
    subject?: string;
    description?: string;
    status?: { name?: string };
    assigned_to?: { name?: string };
    project?: { id?: number; name?: string };
    created_on?: string;
    updated_on?: string;
  }>;
  total_count?: number;
  offset?: number;
  limit?: number;
}

async function zmindGet(path: string, params: Record<string, string>): Promise<ZmindListResp> {
  if (!ZMIND_API_KEY) throw new Error("ZMIND_API_KEY 未配置");
  const url = new URL(path, ZMIND_URL + "/");
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  url.searchParams.set("key", ZMIND_API_KEY);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Zmind HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json() as Promise<ZmindListResp>;
}

export interface ZmindSyncStats {
  source: "zmind";
  fetched: number;
  upserted: number;
  watermark: string;
}

const UPSERT_SQL = `
INSERT INTO zmind_issues (
  id, tracker, subject, description, status, assigned_to,
  project_id, project_name, created_on, updated_on
) VALUES (
  @id, @tracker, @subject, @description, @status, @assigned_to,
  @project_id, @project_name, @created_on, @updated_on
)
ON CONFLICT(id) DO UPDATE SET
  tracker = excluded.tracker,
  subject = excluded.subject,
  description = excluded.description,
  status = excluded.status,
  assigned_to = excluded.assigned_to,
  project_id = excluded.project_id,
  project_name = excluded.project_name,
  created_on = excluded.created_on,
  updated_on = excluded.updated_on
`;

/**
 * 全量/增量同步 Zmind issues。
 *
 * @param args.since  仅同步 updated_on >= since 的 issues（YYYY-MM-DD）。未传则用 sync_state 水位。
 * @param args.limit  最大同步条数（防一次性拉爆）。默认 1000；传 0 / 负数 = 不限（拉到 API 返回空）
 * @param args.statusId 状态过滤；默认 "*" 全部
 */
export async function syncZmind(args: {
  since?: string;
  limit?: number;
  statusId?: string;
} = {}): Promise<ZmindSyncStats> {
  const db = getDb();
  // limit ≤ 0 → 无限拉（直到 API 返回空）
  const userLimit = args.limit;
  const limit =
    userLimit == null
      ? 1000
      : userLimit <= 0
        ? Number.MAX_SAFE_INTEGER
        : userLimit;
  const stateSince = args.since ?? getSyncState("zmind", "last_full_sync") ?? "";

  const upsert = db.prepare(UPSERT_SQL);
  function upsertMany(rows: any[]): void {
    runInTransaction(db, () => {
      for (const r of rows) upsert.run(r);
    });
  }

  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  let maxUpdatedOn = stateSince; // 用于设置 watermark = 已拉取的最大 updated_on
  const pageSize = 100;

  while (fetched < limit) {
    const remaining = limit - fetched;
    const batch = Math.min(pageSize, remaining);
    const params: Record<string, string> = {
      status_id: args.statusId ?? "*",
      sort: "updated_on:desc",
      offset: String(offset),
      limit: String(batch),
    };
    // Redmine 接受 `>=YYYY-MM-DD` 格式；ISO 时间串会解析失败 → 强制截到 day
    if (stateSince) params.updated_on = `>=${stateSince.slice(0, 10)}`;

    const data = await zmindGet("/issues.json", params);
    const issues = data.issues ?? [];
    if (issues.length === 0) break;

    const rows = issues.map((i) => ({
      id: i.id,
      tracker: i.tracker?.name ?? "",
      subject: i.subject ?? "",
      description: i.description ?? "",
      status: i.status?.name ?? "",
      assigned_to: i.assigned_to?.name ?? "",
      project_id: i.project?.id ?? null,
      project_name: i.project?.name ?? "",
      created_on: i.created_on ?? "",
      updated_on: i.updated_on ?? "",
    }));
    upsertMany(rows);

    fetched += issues.length;
    upserted += issues.length;
    offset += issues.length;

    // 跟踪最大 updated_on（Zmind 返回 ISO 格式，截到 day 即可比较）
    for (const r of rows) {
      if (r.updated_on && r.updated_on > maxUpdatedOn) {
        maxUpdatedOn = r.updated_on;
      }
    }

    process.stderr.write(
      `[zmind-sync] page offset=${offset - issues.length}, got=${issues.length}, total=${fetched}\n`,
    );

    if (issues.length < batch) break;
  }

  // watermark：用已拉取的最大 updated_on 的 day-only 形式（Redmine 接受 YYYY-MM-DD）
  // 若没拉到任何数据，保留 stateSince（不前推）
  const watermark = maxUpdatedOn
    ? maxUpdatedOn.slice(0, 10)
    : stateSince || new Date().toISOString().slice(0, 10);
  setSyncState("zmind", "last_full_sync", watermark);

  return { source: "zmind", fetched, upserted, watermark };
}
