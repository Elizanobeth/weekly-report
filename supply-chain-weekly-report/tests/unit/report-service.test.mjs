import test from "node:test";
import assert from "node:assert/strict";

import { loadMockData, validateData } from "../../src/domain/mock-repository.mjs";
import { buildWeeklyReport, getAvailableWeeks } from "../../src/domain/report-service.mjs";

test("mock three-table data passes relationship validation", async () => {
  const data = await loadMockData();
  assert.deepEqual(validateData(data), {
    kpiCount: 4,
    workItemCount: 7,
    weeklyRecordCount: 11,
  });
});

test("available weeks are returned newest first", async () => {
  const data = await loadMockData();
  assert.deepEqual(getAvailableWeeks(data.weeklyRecords), ["2026-W37", "2026-W36"]);
});

test("current week contains only tasks with a current-week record", async () => {
  const data = await loadMockData();
  const report = buildWeeklyReport(data, "2026-W37");
  const itemIds = report.members.flatMap((member) => member.tasks.map((task) => task.item.id));

  assert.equal(report.metrics.memberCount, 3);
  assert.equal(report.metrics.taskCount, 5);
  assert.ok(!itemIds.includes("ITEM-006"), "上周有记录、本周无记录的事项必须隐藏");
  assert.ok(!itemIds.includes("ITEM-007"), "历史已完成事项不能出现在本周");
});

test("different tasks in the same project remain on their owners' pages", async () => {
  const data = await loadMockData();
  const report = buildWeeklyReport(data, "2026-W37");
  const chen = report.members.find((member) => member.name === "陈悦");
  const zhou = report.members.find((member) => member.name === "周凯");

  assert.ok(chen.tasks.some((task) => task.item.taskName === "主数据校验规则上线"));
  assert.ok(zhou.tasks.some((task) => task.item.taskName === "主数据接口性能优化"));
  assert.equal(chen.tasks.find((task) => task.item.id === "ITEM-001").item.projectName, "供应商主数据治理");
  assert.equal(zhou.tasks.find((task) => task.item.id === "ITEM-002").item.projectName, "供应商主数据治理");
});

test("history is restored from weekly rows rather than snapshots", async () => {
  const data = await loadMockData();
  const current = buildWeeklyReport(data, "2026-W37");
  const history = buildWeeklyReport(data, "2026-W36");

  assert.equal(current.metrics.taskCount, 5);
  assert.equal(history.metrics.taskCount, 4);
  assert.ok(history.members.flatMap((member) => member.tasks).some((task) => task.item.id === "ITEM-006"));
});

test("summary items retain source weekly-record ids", async () => {
  const data = await loadMockData();
  const report = buildWeeklyReport(data, "2026-W37");
  const allItems = [
    ...report.summary.keyAchievements,
    ...report.summary.risks,
    ...report.summary.coordination,
    ...report.summary.nextFocus,
  ];

  assert.ok(allItems.length > 0);
  assert.ok(allItems.every((item) => item.sourceRecordIds.length === 1));
  assert.ok(report.summary.coordination.some((item) => item.sourceRecordIds[0] === "WR-2026-W37-004"));
});

test("status mapping matches the approved KPI rules", async () => {
  const { statusMap } = await loadMockData();
  assert.deepEqual(statusMap, {
    未开始: { kpiStatus: "未开始", light: "绿" },
    正常: { kpiStatus: "进行中", light: "绿" },
    有风险: { kpiStatus: "进行中", light: "黄" },
    需协同: { kpiStatus: "进行中", light: "红" },
    暂停: { kpiStatus: "暂停", light: "黄" },
    已完成: { kpiStatus: "已完成", light: "绿" },
  });
});

test("duplicate week and item records are rejected", () => {
  const broken = {
    kpi: [],
    workItems: [{ id: "ITEM-1", itemType: "非KPI需求", kpiRecordId: null }],
    weeklyRecords: [
      { id: "WR-1", recordType: "任务进展", week: "2026-W37", workItemId: "ITEM-1", owner: "成员A" },
      { id: "WR-2", recordType: "任务进展", week: "2026-W37", workItemId: "ITEM-1", owner: "成员A" },
    ],
  };
  assert.throws(() => validateData(broken), /唯一性规则/);
});
