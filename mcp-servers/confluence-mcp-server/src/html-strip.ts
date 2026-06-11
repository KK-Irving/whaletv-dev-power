/**
 * HTML → 纯文本转换。
 *
 * 行为：
 *   - 移除 `<script>` 与 `<style>` 的整段（含标签内容）
 *   - 解码常见 HTML 实体（&nbsp; &amp; &lt; &gt; &quot; &#39; 数字实体）
 *   - 折叠连续空白为单个空格
 *
 * 这是 Confluence 全文检索 hit 与 page detail 共用的 sanitizer。
 */

export function stripHtml(html: string | undefined | null): string {
  if (!html) return "";

  // 1. 砍掉 script / style 内部内容
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // 2. 砍掉所有 tag
  text = text.replace(/<[^>]+>/g, " ");

  // 3. 解码常见命名实体
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");

  // 4. 解码数字实体（&#123; / &#x1F4A9;）
  text = text
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, code) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    });

  // 5. 折叠空白
  return text.replace(/\s+/g, " ").trim();
}

export function truncate(text: string, maxChars: number, suffix: string = "…"): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + suffix;
}
