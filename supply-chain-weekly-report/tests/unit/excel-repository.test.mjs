import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ExcelDataRepository } from "../../src/domain/excel-repository.mjs";
import { buildWeeklyReport } from "../../src/domain/report-service.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workbookPath = join(projectRoot, "outputs", "excel-sync", "周报模拟数据.xlsx");
const statusMapPath = join(projectRoot, "config", "status-map.json");

test("Excel repository loads the three-table workbook", { skip: !existsSync(workbookPath) }, async () => {
  const repository = new ExcelDataRepository(workbookPath, statusMapPath);
  const source = await repository.load();
  const report = buildWeeklyReport(source.data, "2026-W37");

  assert.equal(source.dataSource, "excel");
  assert.equal(source.data.kpi.length, 4);
  assert.equal(source.data.workItems.length, 7);
  assert.equal(source.data.weeklyRecords.length, 11);
  assert.equal(report.metrics.memberCount, 3);
  assert.equal(report.metrics.taskCount, 5);
});

test("Excel repository reuses its cache while the file is unchanged", { skip: !existsSync(workbookPath) }, async () => {
  const repository = new ExcelDataRepository(workbookPath, statusMapPath);
  const first = await repository.load();
  const second = await repository.load();
  assert.strictEqual(first, second);
});
