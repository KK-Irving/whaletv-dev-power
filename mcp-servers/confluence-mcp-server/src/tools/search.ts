/**
 * search_confluence —— Confluence 全文检索工具实现。
 *
 * 输入 query 自动判定：
 *   - 如果含 CQL 关键字（AND/OR/NOT/space/type/title/text 等运算）→ 直接当 CQL 透传
 *   - 否则包装为 `text ~ "<query>"`
 * 始终附加 `AND type = page` 限定为页面（不返回博客/评论）。
 * 可选 space 参数会附加 `AND space.key = "<space>"`。
 */

import { confluenceGet } from "../http-client.js";
import { stripHtml, truncate } from "../html-strip.js";

const SNIPPET_MAX_CHARS = 320;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

const CQL_KEYWORDS_RE = /\b(AND|OR|NOT|space|type|title|text)\s*[~=:]/i;

export function buildCql(query: string, space?: string): string {
  const q = (query || "").trim();
  if (!q) return "";
  let cql: string;
  if (CQL_KEYWORDS_RE.test(q)) {
    cql = q;
  } else {
    const safe = q.replace(/"/g, '\\"');
    cql = `text ~ "${safe}"`;
  }
  if (space) {
    const safeSpace = space.replace(/"/g, '\\"');
    cql += ` AND space.key = "${safeSpace}"`;
  }
  cql += " AND type = page";
  return cql;
}

interface ConfluenceSearchResult {
  results?: Array<{
    id?: string;
    title?: string;
    type?: string;
    space?: { key?: string; name?: string };
    body?: { view?: { value?: string } };
    _links?: { webui?: string };
  }>;
}

export interface SearchHit {
  id: string;
  source: "confluence";
  title: string;
  url: string;
  snippet: string;
  meta: {
    type: string;
    space: string;
    space_name: string;
  };
}

export async function searchConfluence(args: {
  query: string;
  space?: string;
  limit?: number;
}): Promise<{
  source: "confluence";
  query: string;
  cql: string;
  hits: SearchHit[];
  truncated: boolean;
}> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, args.limit ?? DEFAULT_LIMIT));
  const cql = buildCql(args.query, args.space);
  if (!cql) {
    return {
      source: "confluence",
      query: args.query ?? "",
      cql: "",
      hits: [],
      truncated: false,
    };
  }

  const data = await confluenceGet<ConfluenceSearchResult>("/rest/api/content/search", {
    cql,
    limit,
    expand: "body.view,space",
  });

  const baseUrl = (process.env.CONFLUENCE_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const hits: SearchHit[] = (data?.results ?? []).slice(0, limit).map((p) => {
    const bodyHtml = p.body?.view?.value ?? "";
    const snippet = truncate(stripHtml(bodyHtml), SNIPPET_MAX_CHARS);
    const webui = p._links?.webui ?? "";
    const url = webui.startsWith("http") ? webui : baseUrl + webui;
    return {
      id: String(p.id ?? ""),
      source: "confluence" as const,
      title: p.title ?? "",
      url,
      snippet,
      meta: {
        type: p.type ?? "",
        space: p.space?.key ?? "",
        space_name: p.space?.name ?? "",
      },
    };
  });

  return {
    source: "confluence",
    query: args.query ?? "",
    cql,
    hits,
    truncated: hits.length >= limit,
  };
}
