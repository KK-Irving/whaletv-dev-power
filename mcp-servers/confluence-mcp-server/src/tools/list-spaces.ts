/**
 * list_spaces —— 列出全部 global 空间，分页累加直到完成。
 */

import { confluenceGet } from "../http-client.js";

interface SpaceListResp {
  results?: Array<{ key?: string; name?: string; type?: string }>;
  size?: number;
  start?: number;
  limit?: number;
}

export interface SpaceItem {
  key: string;
  name: string;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50; // 安全闸：5000 个空间封顶

export async function listSpaces(): Promise<{
  source: "confluence";
  spaces: SpaceItem[];
  total: number;
}> {
  const out: SpaceItem[] = [];
  let start = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await confluenceGet<SpaceListResp>("/rest/api/space", {
      type: "global",
      start,
      limit: PAGE_SIZE,
    });
    const results = data?.results ?? [];
    for (const s of results) {
      if (s.key) out.push({ key: s.key, name: s.name ?? "" });
    }
    const size = data?.size ?? results.length;
    if (size < PAGE_SIZE || results.length === 0) break;
    start += size;
  }
  return { source: "confluence", spaces: out, total: out.length };
}
