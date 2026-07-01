/**
 * upload_report — 上传 HTML 报告到 AWS S3
 *
 * 零第三方依赖：自实现 minimal S3 PutObject + AWS SigV4 签名（Node 内置 crypto）。
 *
 * 目标路径：s3://{bucket}/issueAnalysis/{year}/w{iso_week}/{report_id}-report-v1.html
 *
 * 凭据从 SoT (~/.ai/whaletv.yaml) 的 s3_issue_analysis 段读取：
 *   s3_issue_analysis:
 *     access_key_id: <>
 *     secret_access_key: <>
 *     region: <>
 *     bucket: <>
 *
 * 触发时机：
 *   - generate_report 完成后，用户请求上传治理归档
 *   - CI / 定时任务批量归档
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

// =============================================================================
// SoT 读取（零依赖，复用现有 sot-loader 逻辑理念）
// =============================================================================

const SOT_PATH = path.join(os.homedir(), ".ai", "whaletv.yaml");

interface S3Config {
  access_key_id: string;
  secret_access_key: string;
  region: string;
  bucket: string;
}

function parseYaml(text: string): Record<string, string | Record<string, string>> {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const data: Record<string, string | Record<string, string>> = {};
  let currentTopKey: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/(?<=\s)#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = (line.match(/^(\s*)/) as RegExpMatchArray)[0].length;
    const stripped = line.slice(indent);
    if (indent === 0) {
      const m = stripped.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2].trim();
      if (rest === "") {
        data[key] = {};
        currentTopKey = key;
      } else {
        data[key] = parseScalar(rest);
        currentTopKey = null;
      }
    } else if (indent === 2 && currentTopKey !== null) {
      const m = stripped.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2].trim();
      const top = data[currentTopKey];
      if (typeof top === "object" && top !== null) {
        (top as Record<string, string>)[key] = parseScalar(rest);
      }
    }
  }
  return data;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return "";
  return trimmed;
}

function readS3ConfigFromSoT(): { config?: S3Config; error?: string } {
  if (!fs.existsSync(SOT_PATH)) {
    return { error: `SoT 不存在 (${SOT_PATH})；跑 whaletv-credentials init 或 migrate 先创建` };
  }
  let data: Record<string, string | Record<string, string>>;
  try {
    data = parseYaml(fs.readFileSync(SOT_PATH, "utf8"));
  } catch (e) {
    return { error: `SoT 解析失败：${(e as Error).message}` };
  }
  const s3 = data.s3_issue_analysis;
  if (!s3 || typeof s3 !== "object") {
    return {
      error: `SoT 中缺少 s3_issue_analysis 段。补充：\nwhaletv-credentials set s3_issue_analysis.access_key_id <>\nwhaletv-credentials set s3_issue_analysis.secret_access_key <>\nwhaletv-credentials set s3_issue_analysis.region <>\nwhaletv-credentials set s3_issue_analysis.bucket <>`,
    };
  }
  const config: S3Config = {
    access_key_id: (s3 as Record<string, string>).access_key_id ?? "",
    secret_access_key: (s3 as Record<string, string>).secret_access_key ?? "",
    region: (s3 as Record<string, string>).region ?? "",
    bucket: (s3 as Record<string, string>).bucket ?? "",
  };
  const missing: string[] = [];
  for (const k of ["access_key_id", "secret_access_key", "region", "bucket"] as const) {
    if (!config[k]) missing.push(`s3_issue_analysis.${k}`);
  }
  if (missing.length > 0) {
    return { error: `SoT s3_issue_analysis 缺少字段：${missing.join(", ")}` };
  }
  return { config };
}

// =============================================================================
// AWS SigV4 签名（minimal，只支持 PUT object）
// =============================================================================

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function iso8601Date(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * 生成 AWS SigV4 签名的 headers（仅 PUT object 场景）
 */
function signPutObject(
  cfg: S3Config,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): {
  url: string;
  headers: Record<string, string>;
} {
  const now = new Date();
  const amzDate = iso8601Date(now); // 20260701T123456Z
  const dateStamp = amzDate.slice(0, 8); // 20260701

  // 用 virtual hosted-style URL：https://<bucket>.s3.<region>.amazonaws.com/<key>
  // 更简单：使用 path-style，兼容性最好：https://s3.<region>.amazonaws.com/<bucket>/<key>
  const host = `s3.${cfg.region}.amazonaws.com`;
  const canonicalUri = "/" + bucket + "/" + key.split("/").map(encodeURIComponent).join("/");
  const canonicalQueryString = "";
  const contentSha256 = sha256Hex(body);

  const headersForSign: Record<string, string> = {
    "content-length": String(body.length),
    "content-type": contentType,
    host: host,
    "x-amz-content-sha256": contentSha256,
    "x-amz-date": amzDate,
  };
  const sortedHeaderKeys = Object.keys(headersForSign).sort();
  const canonicalHeaders =
    sortedHeaderKeys.map((k) => `${k}:${headersForSign[k]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    contentSha256,
  ].join("\n");

  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  // 派生 signing key
  const kDate = hmacSha256("AWS4" + cfg.secret_access_key, dateStamp);
  const kRegion = hmacSha256(kDate, cfg.region);
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${cfg.access_key_id}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      ...headersForSign,
      Authorization: authHeader,
    },
  };
}

// =============================================================================
// ISO 周计算
// =============================================================================

function isoWeek(d: Date): { year: number; week: number } {
  // ISO week: 每年第一个含周四的周 = 第 1 周
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // 周一 = 0
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 24 * 60 * 60 * 1000));
  const year = new Date(firstThursday).getUTCFullYear();
  return { year, week };
}

// =============================================================================
// 主入口
// =============================================================================

export interface UploadReportArgs {
  /** 本地 HTML 报告路径 */
  html_path: string;
  /** report_id（用于生成 S3 key） */
  report_id: string;
  /** 覆盖 year（默认按 UTC 今天算 ISO 年） */
  year?: number;
  /** 覆盖 week（默认按 UTC 今天算 ISO 周） */
  week?: number;
  /** 覆盖 bucket（默认从 SoT 读） */
  bucket_override?: string;
}

export interface UploadReportResult {
  ok: boolean;
  s3_uri?: string;
  bucket?: string;
  key?: string;
  size_bytes?: number;
  http_status?: number;
  error?: string;
}

export async function uploadReport(args: UploadReportArgs): Promise<UploadReportResult> {
  const { config, error } = readS3ConfigFromSoT();
  if (!config) return { ok: false, error };

  const bucket = args.bucket_override ?? config.bucket;

  if (!fs.existsSync(args.html_path)) {
    return { ok: false, error: `HTML 文件不存在：${args.html_path}` };
  }

  const body = await fsp.readFile(args.html_path);

  const now = new Date();
  const iso = isoWeek(now);
  const year = args.year ?? iso.year;
  const week = args.week ?? iso.week;
  const weekStr = `w${String(week).padStart(2, "0")}`;
  const key = `issueAnalysis/${year}/${weekStr}/${args.report_id}-report-v1.html`;

  const { url, headers } = signPutObject(config, bucket, key, body, "text/html; charset=utf-8");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers,
      body,
    });
  } catch (e) {
    return { ok: false, error: `网络错误：${(e as Error).message}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      http_status: res.status,
      error: `S3 PUT 失败 (HTTP ${res.status}): ${text.slice(0, 500)}`,
    };
  }

  return {
    ok: true,
    s3_uri: `s3://${bucket}/${key}`,
    bucket,
    key,
    size_bytes: body.length,
    http_status: res.status,
  };
}
