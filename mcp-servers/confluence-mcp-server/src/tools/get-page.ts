/**
 * get_page —— 单页面详情拉取。
 */

import { confluenceGet } from "../http-client.js";
import { stripHtml, truncate } from "../html-strip.js";

const BODY_MAX_CHARS = 8000;

interface ConfluencePage {
  id?: string;
  title?: string;
  type?: string;
  space?: { key?: string; name?: string };
  version?: { number?: number; when?: string };
  body?: { view?: { value?: string } };
  _links?: { webui?: string };
}

export interface PageDetail {
  id: string;
  source: "confluence";
  title: string;
  url: string;
  space: string;
  space_name: string;
  version: number;
  updated: string;
  body_text: string;
  body_truncated: boolean;
}

export async function getPage(args: { page_id: string }): Promise<PageDetail> {
  const id = String(args.page_id ?? "").trim();
  if (!id) throw new Error("page_id 不能为空");

  const data = await confluenceGet<ConfluencePage>(`/rest/api/content/${encodeURIComponent(id)}`, {
    expand: "body.view,space,version",
  });

  const bodyHtml = data?.body?.view?.value ?? "";
  const fullText = stripHtml(bodyHtml);
  const baseUrl = (process.env.CONFLUENCE_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const webui = data?._links?.webui ?? "";
  const url = webui.startsWith("http") ? webui : baseUrl + webui;

  return {
    id: String(data?.id ?? id),
    source: "confluence",
    title: data?.title ?? "",
    url,
    space: data?.space?.key ?? "",
    space_name: data?.space?.name ?? "",
    version: data?.version?.number ?? 0,
    updated: data?.version?.when ?? "",
    body_text: truncate(fullText, BODY_MAX_CHARS),
    body_truncated: fullText.length > BODY_MAX_CHARS,
  };
}
