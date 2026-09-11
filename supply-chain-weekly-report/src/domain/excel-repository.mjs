import { readFile, stat } from "node:fs/promises";

import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

import { validateData } from "./mock-repository.mjs";

const DAY_MS = 86_400_000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function percent(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function isoDateTime(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(EXCEL_EPOCH_MS + value * DAY_MS).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toISOString();
}

function rowsFromSheet(workbook, sheetName) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange(true)?.values ?? [];
  if (values.length < 1) throw new Error(`${sheetName}没有字段行`);
  const headers = values[0].map(text);
  return values.slice(1)
    .filter((row) => row.some((value) => value !== null && value !== undefined && value !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

function ensureHeaders(rows, sheetName, requiredHeaders) {
  if (rows.length === 0) throw new Error(`${sheetName}没有数据记录`);
  const headers = new Set(Object.keys(rows[0]));
  const missing = requiredHeaders.filter((header) => !headers.has(header));
  if (missing.length) throw new Error(`${sheetName}缺少字段：${missing.join("、")}`);
}

function mappingKey(portfolio, projectName, taskName, owner) {
  return [portfolio, projectName, taskName, owner].map(text).join("::");
}

function normalizeKpi(rows, workItems) {
  ensureHeaders(rows, "KPI表", ["项目名称", "关键任务", "单项责任人", "当前状态", "完成比例", "计划比例", "灯光", "进度说明"]);
  const mappedIds = new Map(
    workItems
      .filter((item) => item.itemType === "KPI项目" && item.kpiRecordId)
      .map((item) => [mappingKey(item.portfolio, item.projectName, item.taskName, item.owner), item.kpiRecordId]),
  );
  return rows.map((row, index) => ({
    id: mappedIds.get(mappingKey(row["项目集"], row["项目名称"], row["关键任务"], row["单项责任人"]))
      ?? `KPI-ROW-${String(index + 1).padStart(3, "0")}`,
    portfolio: text(row["项目集"]),
    projectName: text(row["项目名称"]),
    keyTask: text(row["关键任务"]),
    owner: text(row["单项责任人"]),
    currentStatus: text(row["当前状态"]),
    completionRate: percent(row["完成比例"]),
    plannedCompletionRate: percent(row["计划比例"]),
    light: text(row["灯光"]),
    progressNote: text(row["进度说明"]),
  }));
}

function normalizeWorkItems(rows) {
  ensureHeaders(rows, "事项台账", ["事项ID", "事项类型", "项目名称", "任务名称", "责任人", "当前状态", "当前完成比例"]);
  return rows.map((row) => ({
    id: text(row["事项ID"]),
    itemType: text(row["事项类型"]),
    kpiRecordId: nullableText(row["KPI记录ID"]),
    portfolio: text(row["项目集"]),
    projectName: text(row["项目名称"]),
    taskName: text(row["任务名称"]),
    description: text(row["任务内容"]),
    businessValue: text(row["业务价值点"]),
    taskLevel: text(row["任务级别"]),
    priority: text(row["优先级"]),
    plannedStartDate: isoDateTime(row["计划开始时间"]),
    plannedEndDate: isoDateTime(row["计划完成时间"]),
    owner: text(row["责任人"]),
    businessContact: text(row["业务接口人"]),
    itContact: text(row["IT接口人"]),
    currentStatus: text(row["当前状态"]),
    completionRate: percent(row["当前完成比例"]),
    latestProgress: text(row["最新进度说明"]),
    source: text(row["数据来源"]),
    validity: text(row["是否有效"]),
    lastSyncedAt: isoDateTime(row["最后同步时间"]),
  }));
}

function normalizeWeeklyRecords(rows) {
  ensureHeaders(rows, "周报记录表", ["周报记录ID", "记录类型", "周报周期", "关联事项", "本周主要进展", "本周状态", "责任人"]);
  return rows.map((row) => ({
    id: text(row["周报记录ID"]),
    recordType: text(row["记录类型"]),
    week: text(row["周报周期"]),
    workItemId: nullableText(row["关联事项"]),
    updateType: text(row["更新类型"]),
    progress: text(row["本周主要进展"]),
    actualCompletionRate: percent(row["当前完成比例"]),
    plannedCompletionRate: percent(row["当周计划比例"]),
    status: text(row["本周状态"]),
    problem: text(row["存在问题"]),
    helpNeeded: text(row["需要帮助"]),
    nextPlan: text(row["下周计划"]),
    nextTargetCompletionRate: percent(row["下周目标完成比例"]),
    owner: text(row["责任人"]),
    submitter: text(row["填报人"]),
    updatedAt: isoDateTime(row["更新时间"]),
    lockStatus: text(row["锁定状态"]),
    kpiSyncStatus: text(row["KPI同步状态"]),
    kpiSyncTime: isoDateTime(row["KPI同步时间"]),
    kpiSyncError: text(row["KPI同步错误"]),
    aiSummaryStatus: text(row["AI摘要状态"]),
    aiGeneratedAt: isoDateTime(row["AI生成时间"]),
    aiModel: text(row["AI模型"]),
    aiSourceRecordIds: text(row["AI来源记录ID"]).split(",").map((id) => id.trim()).filter(Boolean),
  }));
}

export class ExcelDataRepository {
  constructor(filePath, statusMapPath) {
    this.filePath = filePath;
    this.statusMapPath = statusMapPath;
    this.cached = null;
  }

  async load() {
    const fileStat = await stat(this.filePath);
    const sourceVersion = `${fileStat.mtimeMs}:${fileStat.size}`;
    if (this.cached?.sourceVersion === sourceVersion) return this.cached;

    const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(this.filePath));
    const workItems = normalizeWorkItems(rowsFromSheet(workbook, "事项台账"));
    const kpi = normalizeKpi(rowsFromSheet(workbook, "KPI表"), workItems);
    const weeklyRecords = normalizeWeeklyRecords(rowsFromSheet(workbook, "周报记录表"));
    const statusMap = JSON.parse(await readFile(this.statusMapPath, "utf8"));
    const data = { kpi, workItems, weeklyRecords, statusMap };
    validateData(data);

    this.cached = {
      data,
      sourceVersion,
      sourceModifiedAt: fileStat.mtime.toISOString(),
      dataSource: "excel",
    };
    return this.cached;
  }
}
