#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMockData } from "../domain/mock-repository.mjs";
import { ExcelDataRepository } from "../domain/excel-repository.mjs";
import { buildWeeklyReport, getAvailableWeeks } from "../domain/report-service.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const webRoot = join(currentDir, "..", "web");
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
const dataSource = (process.env.DATA_SOURCE || "excel").toLowerCase();
const configuredExcelFile = process.env.EXCEL_FILE || "outputs/excel-sync/周报模拟数据.xlsx";
const excelFile = isAbsolute(configuredExcelFile) ? configuredExcelFile : join(projectRoot, configuredExcelFile);
const excelRepository = new ExcelDataRepository(excelFile, join(projectRoot, "config", "status-map.json"));
let mockCache;
const summaryOverrides = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function loadData() {
  if (dataSource === "mock") {
    if (!mockCache) mockCache = { data: await loadMockData(), sourceVersion: "mock-static", sourceModifiedAt: null, dataSource: "mock" };
    return mockCache;
  }
  if (dataSource !== "excel") throw new Error(`不支持的数据源：${dataSource}`);
  return excelRepository.load();
}

function reportForWeek(source, week) {
  const report = buildWeeklyReport(source.data, week);
  report.dataSource = source.dataSource;
  report.sourceVersion = source.sourceVersion;
  report.sourceModifiedAt = source.sourceModifiedAt;
  const override = summaryOverrides.get(week);
  if (override) report.summary = { ...report.summary, ...override };
  return report;
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(webRoot, safePath);
  if (!filePath.startsWith(webRoot)) {
    sendJson(response, 403, { error: "禁止访问" });
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") sendJson(response, 404, { error: "页面不存在" });
    else throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      const source = await loadData();
      sendJson(response, 200, { status: "ok", dataSource: source.dataSource, sourceModifiedAt: source.sourceModifiedAt });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/weeks") {
      const source = await loadData();
      sendJson(response, 200, { weeks: getAvailableWeeks(source.data.weeklyRecords), sourceVersion: source.sourceVersion });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/report") {
      const source = await loadData();
      const availableWeeks = getAvailableWeeks(source.data.weeklyRecords);
      const week = url.searchParams.get("week") || availableWeeks[0];
      if (!availableWeeks.includes(week)) {
        sendJson(response, 404, { error: `没有${week}的周报记录` });
        return;
      }
      sendJson(response, 200, reportForWeek(source, week));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/summary/finalize") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const week = JSON.parse(body || "{}").week;
      const source = await loadData();
      const availableWeeks = getAvailableWeeks(source.data.weeklyRecords);
      if (!availableWeeks.includes(week)) {
        sendJson(response, 404, { error: "周报周期不存在" });
        return;
      }
      const override = {
        status: "最终版",
        generatedAt: new Date().toISOString(),
        model: "mock-summary-v1",
      };
      summaryOverrides.set(week, override);
      sendJson(response, 200, reportForWeek(source, week).summary);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 405, { error: "不支持的请求方法" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "本地服务处理失败" });
  }
});

server.listen(port, host, () => {
  console.log(`供应链周报已启动：http://${host}:${port}`);
  console.log(dataSource === "excel" ? `当前读取Excel：${excelFile}` : "当前使用JSON演示数据。");
});

export { server };
