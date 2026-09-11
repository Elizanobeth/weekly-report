#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE = "https://openapi.wps.cn";
const CONTENT_TYPE = "application/json";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

export class WpsProtocolError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "WpsProtocolError";
  }
}

export class WpsApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "WpsApiError";
    this.status = status;
    this.code = code;
  }
}

function required(env, names) {
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigError(`缺少配置：${missing.join(", ")}`);
  }
}

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new ConfigError(`${name} 必须是正整数`);
  }
  return parsed;
}

export function readConfig(env = process.env) {
  required(env, ["WPS_ACCESS_TOKEN", "WPS_FILE_ID", "WPS_SHEET_ID"]);

  const signingEnabled = env.WPS_SIGNING_ENABLED?.toLowerCase() === "true";
  if (signingEnabled) {
    required(env, ["WPS_APP_ID", "WPS_APP_SECRET"]);
  }

  const apiBase = (env.WPS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  let apiUrl;
  try {
    apiUrl = new URL(apiBase);
  } catch {
    throw new ConfigError("WPS_API_BASE 必须是有效 URL");
  }

  if (!['https:', 'http:'].includes(apiUrl.protocol)) {
    throw new ConfigError("WPS_API_BASE 只支持 HTTP 或 HTTPS");
  }

  return {
    accessToken: env.WPS_ACCESS_TOKEN.trim(),
    fileId: env.WPS_FILE_ID.trim(),
    sheetId: parsePositiveInteger(env.WPS_SHEET_ID, "WPS_SHEET_ID"),
    apiBase,
    signingEnabled,
    appId: env.WPS_APP_ID?.trim() || "",
    appSecret: env.WPS_APP_SECRET?.trim() || "",
    allowWrite: env.WPS_ALLOW_WRITE === "YES",
    testTextField: env.WPS_TEST_TEXT_FIELD?.trim() || "",
    timeoutMs: env.WPS_TIMEOUT_MS
      ? parsePositiveInteger(env.WPS_TIMEOUT_MS, "WPS_TIMEOUT_MS")
      : 15_000,
  };
}

export function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

export function buildListBody(pageToken = "") {
  return {
    prefer_id: false,
    text_value: "original",
    page_size: 10,
    fields: [],
    show_record_extra_info: true,
    show_fields_info: true,
    ...(pageToken ? { page_token: pageToken } : {}),
  };
}

function sha256Body(body) {
  if (!body) return "";
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function createKsoHeaders({
  accessKey,
  secretKey,
  method,
  requestUri,
  contentType = CONTENT_TYPE,
  ksoDate = new Date().toUTCString(),
  requestBody = "",
}) {
  const stringToSign =
    `KSO-1${method.toUpperCase()}${requestUri}${contentType}${ksoDate}` +
    sha256Body(requestBody);
  const signature = createHmac("sha256", secretKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    "X-Kso-Date": ksoDate,
    "X-Kso-Authorization": `KSO-1 ${accessKey}:${signature}`,
  };
}

export function parseFieldsJson(fields) {
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    return fields;
  }
  if (typeof fields !== "string") {
    throw new WpsProtocolError("WPS记录的 fields 不是 JSON 字符串");
  }
  try {
    const parsed = JSON.parse(fields);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("fields is not an object");
    }
    return parsed;
  } catch (error) {
    throw new WpsProtocolError("WPS记录的 fields 无法解析", { cause: error });
  }
}

function parseResponseText(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new WpsProtocolError("WPS返回了非JSON响应", { cause: error });
  }
}

export async function wpsRequest(config, requestUri, body, fetchImpl = fetch) {
  const requestBody = body === undefined ? "" : JSON.stringify(body);
  const method = body === undefined ? "GET" : "POST";
  const headers = {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": CONTENT_TYPE,
  };

  if (config.signingEnabled) {
    Object.assign(
      headers,
      createKsoHeaders({
        accessKey: config.appId,
        secretKey: config.appSecret,
        method,
        requestUri,
        contentType: CONTENT_TYPE,
        requestBody,
      }),
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${config.apiBase}${requestUri}`, {
      method,
      headers,
      ...(requestBody ? { body: requestBody } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new WpsApiError(`WPS请求超时（${config.timeoutMs}ms）`);
    }
    throw new WpsApiError(`无法连接WPS开放接口：${error?.message || "未知网络错误"}`);
  } finally {
    clearTimeout(timeout);
  }

  const payload = parseResponseText(await response.text());
  if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
    throw new WpsApiError(payload.msg || `WPS请求失败（HTTP ${response.status}）`, {
      status: response.status,
      code: payload.code,
    });
  }

  return payload;
}

function recordsBasePath(config) {
  return (
    `/v7/coop/dbsheet/${encodePathSegment(config.fileId)}` +
    `/sheets/${config.sheetId}/records`
  );
}

export async function readSheetSample(config, fetchImpl = fetch) {
  const payload = await wpsRequest(
    config,
    recordsBasePath(config),
    buildListBody(),
    fetchImpl,
  );
  const records = payload?.data?.records;
  if (!Array.isArray(records)) {
    throw new WpsProtocolError("WPS列举记录响应缺少 data.records");
  }
  const rawSchema = payload?.data?.fields_schema;
  const fieldsSchema = Array.isArray(rawSchema)
    ? rawSchema.map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
      }))
    : [];
  return { records, fieldsSchema };
}

export async function listRecords(config, fetchImpl = fetch) {
  return (await readSheetSample(config, fetchImpl)).records;
}

export async function createProbeRecord(config, value, fetchImpl = fetch) {
  const payload = await wpsRequest(
    config,
    `${recordsBasePath(config)}/create`,
    {
      prefer_id: false,
      records: [
        {
          fields_value: JSON.stringify({ [config.testTextField]: value }),
        },
      ],
    },
    fetchImpl,
  );
  const record = payload?.data?.records?.[0];
  if (!record?.id) {
    throw new WpsProtocolError("WPS创建记录响应缺少记录ID");
  }
  return record;
}

export async function updateProbeRecord(config, recordId, value, fetchImpl = fetch) {
  const payload = await wpsRequest(
    config,
    `${recordsBasePath(config)}/update`,
    {
      prefer_id: false,
      records: [
        {
          id: recordId,
          fields_value: JSON.stringify({ [config.testTextField]: value }),
        },
      ],
    },
    fetchImpl,
  );
  const record = payload?.data?.records?.[0];
  if (!record?.id) {
    throw new WpsProtocolError("WPS更新记录响应缺少记录ID");
  }
  return record;
}

function summarizeRecords(records) {
  const fieldNames = new Set();
  for (const record of records) {
    const fields = parseFieldsJson(record.fields);
    for (const name of Object.keys(fields)) fieldNames.add(name);
  }
  return {
    recordCount: records.length,
    sampledRecordIds: records.slice(0, 5).map((record) => record.id),
    fieldNames: [...fieldNames].sort((a, b) => a.localeCompare(b, "zh-CN")),
  };
}

export async function runCapabilityCheck({ config, write = false, fetchImpl = fetch }) {
  if (write && (!config.allowWrite || !config.testTextField)) {
    throw new ConfigError(
      "写入验证需要同时设置 WPS_ALLOW_WRITE=YES、WPS_TEST_TEXT_FIELD，并传入 --write",
    );
  }

  const { records, fieldsSchema } = await readSheetSample(config, fetchImpl);
  const result = {
    status: "ok",
    mode: write ? "read-write" : "read-only",
    sheetId: config.sheetId,
    signingEnabled: config.signingEnabled,
    read: {
      ...summarizeRecords(records),
      fieldsSchema,
    },
  };

  if (write) {
    const timestamp = new Date().toISOString();
    const created = await createProbeRecord(config, `能力验证 ${timestamp}`, fetchImpl);
    const updated = await updateProbeRecord(
      config,
      created.id,
      `能力验证已更新 ${timestamp}`,
      fetchImpl,
    );
    result.write = {
      createdRecordId: created.id,
      updatedRecordId: updated.id,
      cleanup: "验证记录已保留，请在测试表中人工确认后删除。",
    };
  }

  return result;
}

function printHelp() {
  process.stdout.write(`WPS多维表格能力验证器\n\n`);
  process.stdout.write(`默认仅执行只读检查：node scripts/wps-capability-check.mjs\n`);
  process.stdout.write(`显式写入测试：WPS_ALLOW_WRITE=YES ... node scripts/wps-capability-check.mjs --write\n\n`);
  process.stdout.write(`必需环境变量：WPS_ACCESS_TOKEN、WPS_FILE_ID、WPS_SHEET_ID\n`);
  process.stdout.write(`签名可选变量：WPS_SIGNING_ENABLED=true、WPS_APP_ID、WPS_APP_SECRET\n`);
  process.stdout.write(`写入额外变量：WPS_ALLOW_WRITE=YES、WPS_TEST_TEXT_FIELD\n`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }
  const unknown = [...args].filter((arg) => arg !== "--write");
  if (unknown.length > 0) {
    throw new ConfigError(`未知参数：${unknown.join(", ")}`);
  }

  const config = readConfig();
  const result = await runCapabilityCheck({ config, write: args.has("--write") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === executedPath) {
  main().catch((error) => {
    const detail = {
      status: "failed",
      type: error.name,
      message: error.message,
      ...(error.code !== undefined ? { code: error.code } : {}),
      ...(error.status !== undefined ? { httpStatus: error.status } : {}),
    };
    process.stderr.write(`${JSON.stringify(detail, null, 2)}\n`);
    process.exitCode = error instanceof ConfigError ? 2 : 1;
  });
}
