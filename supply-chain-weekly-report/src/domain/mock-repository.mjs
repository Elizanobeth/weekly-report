import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requireUniqueIds(rows, tableName) {
  const ids = new Set();
  for (const row of rows) {
    if (!row.id || typeof row.id !== "string") {
      throw new Error(`${tableName}存在缺少ID的记录`);
    }
    if (ids.has(row.id)) {
      throw new Error(`${tableName}存在重复ID：${row.id}`);
    }
    ids.add(row.id);
  }
}

export function validateData({ kpi, workItems, weeklyRecords }) {
  requireUniqueIds(kpi, "KPI表");
  requireUniqueIds(workItems, "事项台账");
  requireUniqueIds(weeklyRecords, "周报记录表");

  const kpiIds = new Set(kpi.map((row) => row.id));
  const workItemIds = new Set(workItems.map((row) => row.id));
  const weeklyKeys = new Set();

  for (const item of workItems) {
    if (item.itemType === "KPI项目" && !kpiIds.has(item.kpiRecordId)) {
      throw new Error(`事项${item.id}未关联有效KPI记录`);
    }
    if (item.itemType !== "KPI项目" && item.kpiRecordId !== null) {
      throw new Error(`非KPI事项${item.id}不应关联KPI记录`);
    }
  }

  for (const record of weeklyRecords) {
    if (!record.week || !/^\d{4}-W\d{2}$/.test(record.week)) {
      throw new Error(`周报${record.id}的周报周期格式不正确`);
    }

    const key = record.recordType === "团队摘要"
      ? `${record.week}:团队摘要`
      : `${record.week}:${record.workItemId}`;
    if (weeklyKeys.has(key)) {
      throw new Error(`周报记录违反唯一性规则：${key}`);
    }
    weeklyKeys.add(key);

    if (record.recordType === "任务进展") {
      if (!workItemIds.has(record.workItemId)) {
        throw new Error(`周报${record.id}未关联有效事项`);
      }
      if (!record.owner) {
        throw new Error(`周报${record.id}缺少责任人`);
      }
    }
  }

  return { kpiCount: kpi.length, workItemCount: workItems.length, weeklyRecordCount: weeklyRecords.length };
}

export async function loadMockData() {
  const [kpi, workItems, weeklyRecords, statusMap] = await Promise.all([
    readJson(join(projectRoot, "mock", "kpi.json")),
    readJson(join(projectRoot, "mock", "work-items.json")),
    readJson(join(projectRoot, "mock", "weekly-records.json")),
    readJson(join(projectRoot, "config", "status-map.json")),
  ]);
  validateData({ kpi, workItems, weeklyRecords });
  return { kpi, workItems, weeklyRecords, statusMap };
}
