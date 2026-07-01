// Confluence HTML fallback.
//
// Used when the account lacks "Use Confluence" + "Search" global permission,
// so /rest/api/content/search and /rest/api/content?spaceKey=... return 403.
// Falls back to /dosearchsite.action HTML scraping + per-page HTML/REST hybrid.

const CONFLUENCE_BASE_URL = (process.env.CONFLUENCE_BASE_URL ?? "").replace(/\/+$/, "");
const CONFLUENCE_COOKIE = (process.env.CONFLUENCE_COOKIE ?? "").trim();

const REQUEST_DELAY_MS = (() => {
  const raw = (process.env.CONFLUENCE_REQUEST_DELAY_MS ?? "").trim();
  if (!/^\d+$/.test(raw)) return 150;
  return parseInt(raw, 10);
})();

const DOSEARCH_PAGE_SIZE = 20;

interface HtmlHit {
  pageId: string;
  title: string;
  href: string;
  snippet: string;
}

export interface PageFullData {
  id: string;
  spaceKey: string;
  title: string;
  bodyText: string;
  version: number;
  updated: string;
  created: string;
  webui: string;
}

export interface HtmlSyncArgs {
  spaces: string[];
  query?: string;
  limit: number;
}

export interface HtmlSyncStats {
  fetched: number;
  upserted: number;
  perSpace: Array<{ spaceKey: string; hits: number; upserted: number; total?: number }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  text = text
    .replace(/&#(\d+);/g, (_m: string, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m: string, code: string) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    });
  return text.replace(/\s+/g, " ").trim();
}

async function htmlGet(pathOrUrl: string): Promise<string> {
  if (!CONFLUENCE_BASE_URL || !CONFLUENCE_COOKIE) {
    throw new Error(
      "Missing Confluence credentials: set CONFLUENCE_BASE_URL + CONFLUENCE_COOKIE.",
    );
  }
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : CONFLUENCE_BASE_URL + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Cookie: CONFLUENCE_COOKIE,
    },
    redirect: "manual",
  });
  if (res.status === 302 || res.status === 303) {
    throw new Error("Confluence HTML 302 login redirect: cookie expired");
  }
  if (res.status === 403) {
    throw new Error("Confluence HTML 403 at " + url + ": account permission too low");
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error("Confluence HTML HTTP " + res.status + ": " + text.slice(0, 300));
  }
  return text;
}

function extractAjsMeta(html: string, name: string): string {
  const pattern = '<meta[^>]*name=["\\\']?ajs-' + name + '["\\\']?[^>]*content=["\\\']?([^"\\\'>]+)["\\\']?';
  const re = new RegExp(pattern, "i");
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

function parseDosearchsiteHtml(html: string): HtmlHit[] {
  const hits: HtmlHit[] = [];
  const seen = new Set<string>();

  let scope = html;
  const scopeMatch =
    html.match(/<ol[^>]*class="[^"]*search-results[^"]*"[^>]*>([\s\S]*?)<\/ol>/i) ??
    html.match(/<div[^>]*id="search-results-body"[^>]*>([\s\S]*?)<\/div>/i);
  if (scopeMatch) scope = scopeMatch[1];

  const anchorRe = /<a[^>]*\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(scope)) !== null) {
    const full = m[0];
    const href = m[1].trim();
    const innerHtml = m[2];

    let pageId = "";
    const pidMatch = href.match(/[?&]pageId=(\d+)/);
    if (pidMatch) pageId = pidMatch[1];
    const isDisplayUrl = /^\/display\/[A-Za-z0-9_]+\/[^?#]+$/.test(href);
    if (!pageId && !isDisplayUrl) continue;

    const title = stripHtml(innerHtml).slice(0, 500);
    if (!title || title.length < 2) continue;
    if (/^(login|log\s?in|sign\s?up|space\s?directory|dashboard|home|logout)$/i.test(title)) {
      continue;
    }

    const key = pageId ? "p:" + pageId : "d:" + href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let snippet = "";
    const anchorEnd = (m.index ?? 0) + full.length;
    const after = scope.slice(anchorEnd, anchorEnd + 2500);
    const excerptMatch = after.match(
      /<(?:div|p|span)[^>]*class="[^"]*(?:search-result-excerpt|excerpt|desc)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/i,
    );
    if (excerptMatch) {
      snippet = stripHtml(excerptMatch[1]).slice(0, 500);
    }

    hits.push({ pageId, title, href, snippet });
  }

  return hits;
}

// Confluence 6.x front-end SPA search endpoint.
// Discovered by browser F12 XHR capture on /dosearchsite.action interaction:
//   GET /rest/searchv3/1.0/cqlSearch?cql=<CQL>&start=<N>&limit=<K>&excerpt=highlight
//       &includeArchivedSpaces=false&user=<username>&sessionUuid=<uuid>
// Response is JSON with `results[].content.{id,title,space,body,...}` and `totalSize`.

interface SearchV3Content {
  id?: string | number;
  type?: string;
  title?: string;
  space?: { key?: string; name?: string };
  _links?: { webui?: string };
  body?: { view?: { value?: string }; storage?: { value?: string } };
  history?: { createdDate?: string };
  version?: { number?: number; when?: string };
}

interface SearchV3Result {
  content?: SearchV3Content;
  excerpt?: string;
  lastModified?: string;
  friendlyLastModified?: string;
  entityType?: string;
}

interface SearchV3Response {
  results?: SearchV3Result[];
  start?: number;
  limit?: number;
  size?: number;
  totalSize?: number;
}

async function searchV3CqlPage(args: {
  spaceKey?: string;
  since?: string;
  start: number;
  limit: number;
}): Promise<{
  hits: HtmlHit[];
  fullResults: SearchV3Content[];
  total?: number;
}> {
  const parts: string[] = ["type = page"];
  if (args.spaceKey) parts.push('space = "' + args.spaceKey + '"');
  if (args.since) parts.push('lastmodified > "' + args.since + '"');
  const cql = parts.join(" AND ");

  const params = new URLSearchParams();
  params.set("cql", cql);
  params.set("start", String(args.start));
  params.set("limit", String(args.limit));
  params.set("excerpt", "highlight");
  params.set("includeArchivedSpaces", "false");

  // sessionUuid: server-side session tracking; a random UUID is accepted
  const uuid =
    typeof (globalThis as any).crypto?.randomUUID === "function"
      ? (globalThis as any).crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000000";
  params.set("sessionUuid", uuid);

  // Optional user hint (server can also derive from cookie's X-AUSERNAME)
  const user = (process.env.CONFLUENCE_USERNAME ?? "").trim();
  if (user) params.set("user", user);

  const path = "/rest/searchv3/1.0/cqlSearch?" + params.toString();

  if (!CONFLUENCE_BASE_URL || !CONFLUENCE_COOKIE) {
    throw new Error(
      "Missing Confluence credentials: set CONFLUENCE_BASE_URL + CONFLUENCE_COOKIE.",
    );
  }
  const url = CONFLUENCE_BASE_URL + path;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Cookie: CONFLUENCE_COOKIE },
    redirect: "manual",
  });
  if (res.status === 302 || res.status === 303) {
    throw new Error("Confluence searchv3 302 login redirect: cookie expired");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      "Confluence searchv3 HTTP " + res.status + ": " + body.slice(0, 300),
    );
  }
  const data = (await res.json()) as SearchV3Response;
  const results = data.results ?? [];

  const contents: SearchV3Content[] = [];
  const hits: HtmlHit[] = [];
  for (const r of results) {
    const c = r.content;
    if (!c?.id) continue;
    // Some deployments include non-page entities (space/user) in results.
    if (c.type && c.type !== "page") continue;
    contents.push(c);
    hits.push({
      pageId: String(c.id),
      title: c.title ?? "",
      href: c._links?.webui ?? "",
      snippet: stripHtml(r.excerpt ?? ""),
    });
  }

  if (
    process.env.KNOWLEDGE_CONFLUENCE_DEBUG === "1" &&
    (hits.length === 0 || contents.length !== results.length)
  ) {
    process.stderr.write(
      "[confluence-html/debug] path=" + path +
        " total=" + (data.totalSize ?? "-") +
        " raw_results=" + results.length +
        " page_hits=" + hits.length + "\n"
    );
  }

  return { hits, fullResults: contents, total: data.totalSize };
}

// Legacy dosearchsite HTML scrape (kept for pre-6.x server-rendered deployments).
// If your Confluence renders search as SPA (empty anchors in HTML), searchV3CqlPage
// is the preferred entry point.
async function dosearchsitePage(args: {
  spaceKey?: string;
  query?: string;
  startIndex: number;
}): Promise<{ hits: HtmlHit[]; total?: number }> {
  const parts: string[] = [];
  if (args.query) parts.push(args.query);
  if (args.spaceKey) parts.push("space:" + args.spaceKey);
  parts.push("type:page");
  const queryString = parts.join(" AND ");

  const params = new URLSearchParams();
  params.set("queryString", queryString);
  params.set("startIndex", String(args.startIndex));
  const path = "/dosearchsite.action?" + params.toString();
  const html = await htmlGet(path);

  let total: number | undefined;
  const totalMatch =
    html.match(/(\d+)\s+(?:results?|matches?)/i) ??
    html.match(/results-found[^>]*>[\s\S]*?(\d+)/i);
  if (totalMatch) total = parseInt(totalMatch[1], 10);

  const hits = parseDosearchsiteHtml(html);
  return { hits, total };
}

async function fetchPageFull(
  pageId: string,
  fallbackHref: string,
): Promise<PageFullData | null> {
  // Path A: REST single page
  try {
    const url =
      CONFLUENCE_BASE_URL +
      "/rest/api/content/" +
      encodeURIComponent(pageId) +
      "?expand=body.view,version,space,history";
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Cookie: CONFLUENCE_COOKIE },
      redirect: "manual",
    });
    if (res.status === 200) {
      const data = (await res.json()) as any;
      const bodyHtml = data?.body?.view?.value ?? "";
      return {
        id: String(data?.id ?? pageId),
        spaceKey: data?.space?.key ?? "",
        title: data?.title ?? "",
        bodyText: stripHtml(bodyHtml),
        version: data?.version?.number ?? 0,
        updated: data?.version?.when ?? "",
        created: data?.history?.createdDate ?? "",
        webui: data?._links?.webui ?? fallbackHref,
      };
    }
  } catch {
    // fall through to Path B
  }

  // Path B: viewpage.action HTML
  try {
    const html = await htmlGet("/pages/viewpage.action?pageId=" + encodeURIComponent(pageId));

    const titleMatch =
      html.match(/<title>([\s\S]*?)<\/title>/i) ??
      html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
    const rawTitle = titleMatch ? stripHtml(titleMatch[1]) : "";

    const mainMatch =
      html.match(
        /<div[^>]*id="main-content"[^>]*class="[^"]*wiki-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      ) ??
      html.match(/<div[^>]*class="[^"]*wiki-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const bodyText = mainMatch ? stripHtml(mainMatch[1]) : stripHtml(html).slice(0, 10000);

    const spaceKey = extractAjsMeta(html, "space-key");
    const versionStr = extractAjsMeta(html, "page-version");
    const version = versionStr ? parseInt(versionStr, 10) : 0;
    const updatedMatch = html.match(/(?:modification-date|last-modified)[^>]*>([\s\S]*?)</i);
    const updated = updatedMatch ? stripHtml(updatedMatch[1]).slice(0, 30) : "";

    return {
      id: pageId,
      spaceKey,
      title: rawTitle.replace(/\s*-\s*.+$/, "").trim(),
      bodyText,
      version,
      updated,
      created: "",
      webui: fallbackHref,
    };
  } catch (e) {
    const msg = (e as Error).message;
    process.stderr.write("[confluence-html] pageId=" + pageId + " body fetch failed: " + msg + "\n");
    return null;
  }
}

async function resolvePageIdFromDisplayUrl(displayHref: string): Promise<string> {
  try {
    const html = await htmlGet(displayHref);
    return extractAjsMeta(html, "page-id");
  } catch {
    return "";
  }
}

/**
 * Endpoint history:
 *   - Confluence 5.x / 6.x-early: /dosearchsite.action returned server-rendered HTML
 *     with anchor list; parseDosearchsiteHtml handled it.
 *   - Confluence 6.x-late / 7.x: /dosearchsite.action is a JS SPA shell (empty
 *     anchors, ~30KB of just <meta>/navigation), the real search results come from
 *     XHR to /rest/searchv3/1.0/cqlSearch which returns JSON.
 *
 * Verified 2026-06-30 that `/rest/searchv3/1.0/cqlSearch?cql=<CQL>&start=N&limit=K`
 * works on `docs.whaletv.com` even when `/rest/api/content` batch endpoints return
 * 403 — the searchv3 endpoint has lower per-permission gate (view permission,
 * comparable to what the web UI uses). Real test: 2515 pages listed in one space.
 *
 * fetchViaHtml auto-detects: tries searchv3 first; if the endpoint 404s (very old
 * deployment) falls back to dosearchsite HTML. Override with
 * KNOWLEDGE_CONFLUENCE_FALLBACK_ENDPOINT=searchv3|dosearchsite.
 */
/**
 * HTML fallback main entry.
 *
 * Preferred path: `/rest/searchv3/1.0/cqlSearch` (Confluence 6.x SPA search XHR).
 * If that endpoint returns 404/501 (very old deployment), fall back to
 * `/dosearchsite.action` legacy HTML page scraping (server-rendered results).
 *
 * For each hit we try to reuse body from search response first; otherwise call
 * fetchPageFull(pageId) to get view HTML.
 */
export async function fetchViaHtml(
  args: HtmlSyncArgs,
  onPage: (spaceKey: string, pages: PageFullData[]) => Promise<void>,
  opts?: { since?: string },
): Promise<HtmlSyncStats> {
  const stats: HtmlSyncStats = { fetched: 0, upserted: 0, perSpace: [] };
  const limit = args.limit;
  const isUnlimited = limit <= 0;

  // Auto-detect endpoint on first request. searchv3 preferred, dosearchsite fallback.
  let endpoint: "searchv3" | "dosearchsite" | null = null;
  const forceMode = (process.env.KNOWLEDGE_CONFLUENCE_FALLBACK_ENDPOINT ?? "")
    .trim()
    .toLowerCase();
  if (forceMode === "searchv3" || forceMode === "dosearchsite") {
    endpoint = forceMode;
  }

  const searchv3PageSize = 25; // 25/page is a healthy default for searchv3

  for (const spaceKey of args.spaces) {
    let start = 0;
    let hitsInSpace = 0;
    let upsertedInSpace = 0;
    let totalReported: number | undefined;
    let idlePages = 0;

    while (isUnlimited || stats.fetched < limit) {
      let hits: HtmlHit[] = [];
      let fullResults: SearchV3Content[] = [];
      let pageTotal: number | undefined;

      if (endpoint == null || endpoint === "searchv3") {
        try {
          const r = await searchV3CqlPage({
            spaceKey,
            since: opts?.since,
            start,
            limit: searchv3PageSize,
          });
          hits = r.hits;
          fullResults = r.fullResults;
          pageTotal = r.total;
          if (endpoint == null) endpoint = "searchv3";
        } catch (e) {
          const msg = (e as Error).message;
          if (endpoint == null && /HTTP\s+(404|501)/.test(msg)) {
            process.stderr.write(
              "[confluence-html] /rest/searchv3/1.0/cqlSearch not available (" +
                msg +
                "), falling back to /dosearchsite.action\n",
            );
            endpoint = "dosearchsite";
          } else {
            throw e;
          }
        }
      }

      if (endpoint === "dosearchsite") {
        const r = await dosearchsitePage({
          spaceKey,
          query: args.query,
          startIndex: start,
        });
        hits = r.hits;
        pageTotal = r.total;
      }

      if (pageTotal != null && totalReported == null) totalReported = pageTotal;

      if (hits.length === 0) {
        idlePages++;
        if (idlePages >= 2) break;
        start += endpoint === "searchv3" ? searchv3PageSize : DOSEARCH_PAGE_SIZE;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }
      idlePages = 0;

      const pageDataBatch: PageFullData[] = [];
      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        if (!isUnlimited && stats.fetched >= limit) break;

        let pageId = hit.pageId;
        if (!pageId) {
          pageId = await resolvePageIdFromDisplayUrl(hit.href);
          if (!pageId) {
            process.stderr.write(
              "[confluence-html] cannot resolve pageId from " + hit.href + ", skipping\n",
            );
            continue;
          }
        }

        // Try to build PageFullData directly from search response first
        let pageData: PageFullData | null = null;
        const c = fullResults[i];
        if (c) {
          const bodyHtml = c.body?.view?.value ?? c.body?.storage?.value ?? "";
          const hasBody = bodyHtml && bodyHtml.length > 20;
          if (hasBody) {
            pageData = {
              id: String(c.id ?? pageId),
              spaceKey: c.space?.key ?? spaceKey,
              title: c.title ?? hit.title,
              bodyText: stripHtml(bodyHtml),
              version: c.version?.number ?? 0,
              updated: c.version?.when ?? "",
              created: c.history?.createdDate ?? "",
              webui: c._links?.webui ?? hit.href,
            };
          }
        }

        if (!pageData) {
          // No body in search response -> per-page fetch (REST + HTML fallback)
          pageData = await fetchPageFull(pageId, hit.href);
        }
        if (!pageData) continue;
        if (!pageData.bodyText && hit.snippet) pageData.bodyText = hit.snippet;
        if (!pageData.spaceKey) pageData.spaceKey = spaceKey;

        pageDataBatch.push(pageData);
        stats.fetched++;
        hitsInSpace++;

        if (!pageData || !c || !c.body) await sleep(REQUEST_DELAY_MS);
      }

      if (pageDataBatch.length > 0) {
        await onPage(spaceKey, pageDataBatch);
        stats.upserted += pageDataBatch.length;
        upsertedInSpace += pageDataBatch.length;
      }

      const totalStr = totalReported ? "/" + totalReported : "";
      process.stderr.write(
        "[confluence-html/" + endpoint + "] space=" + spaceKey +
          " start=" + start +
          ", got=" + hits.length +
          ", upserted=" + pageDataBatch.length +
          ", total_so_far=" + stats.fetched + totalStr + "\n"
      );

      const pageSize = endpoint === "searchv3" ? searchv3PageSize : DOSEARCH_PAGE_SIZE;
      start += pageSize;
      if (hits.length < pageSize) break;
      await sleep(REQUEST_DELAY_MS);
    }

    stats.perSpace.push({ spaceKey, hits: hitsInSpace, upserted: upsertedInSpace, total: totalReported });
    if (!isUnlimited && stats.fetched >= limit) break;
  }

  if (stats.fetched === 0) {
    process.stderr.write(
      "[confluence-html] 0 hits from " + (endpoint ?? "auto") + ". " +
        "Set KNOWLEDGE_CONFLUENCE_DEBUG=1 to inspect raw response. " +
        "If your deployment uses a different XHR endpoint, set " +
        "KNOWLEDGE_CONFLUENCE_FALLBACK_ENDPOINT=dosearchsite or capture the real XHR and " +
        "report to maintainer.\n"
    );
  }

  return stats;
}
