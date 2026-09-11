const RISK_STATUSES = new Set(["有风险", "需协同"]);

function byUpdatedAtDescending(left, right) {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function latestTimestamp(records) {
  if (records.length === 0) return null;
  return [...records].sort(byUpdatedAtDescending)[0].updatedAt;
}

function summaryItem(text, record) {
  return { text, sourceRecordIds: [record.id], owner: record.owner, workItemId: record.workItemId };
}

export function getAvailableWeeks(weeklyRecords) {
  return [...new Set(weeklyRecords.map((record) => record.week))]
    .sort((left, right) => right.localeCompare(left));
}

export function buildWeeklyReport(data, week) {
  const taskRecords = data.weeklyRecords.filter(
    (record) => record.recordType === "任务进展" && record.week === week,
  );
  const storedSummary = data.weeklyRecords.find(
    (record) => record.recordType === "团队摘要" && record.week === week,
  );
  const workItems = new Map(data.workItems.map((item) => [item.id, item]));
  const members = new Map();

  for (const record of taskRecords) {
    const item = workItems.get(record.workItemId);
    if (!item) continue;

    const owner = record.owner || item.owner;
    if (!members.has(owner)) members.set(owner, { name: owner, tasks: [] });
    members.get(owner).tasks.push({
      ...record,
      item,
      deviation: record.actualCompletionRate - record.plannedCompletionRate,
      kpiMapping: data.statusMap[record.status] ?? null,
    });
  }

  const memberPages = [...members.values()].map((member) => ({
    ...member,
    tasks: member.tasks.sort((left, right) => {
      const riskDelta = Number(RISK_STATUSES.has(right.status)) - Number(RISK_STATUSES.has(left.status));
      return riskDelta || left.item.priority.localeCompare(right.item.priority);
    }),
  }));

  const keyAchievements = taskRecords
    .filter((record) => ["里程碑", "上线", "验收"].includes(record.updateType) || record.status === "已完成")
    .map((record) => summaryItem(record.progress, record));
  const risks = taskRecords
    .filter((record) => record.problem || RISK_STATUSES.has(record.status))
    .map((record) => summaryItem(record.problem || record.progress, record));
  const coordination = taskRecords
    .filter((record) => record.helpNeeded)
    .map((record) => summaryItem(record.helpNeeded, record));
  const nextFocus = taskRecords
    .filter((record) => record.nextPlan)
    .map((record) => summaryItem(record.nextPlan, record));

  return {
    week,
    dataSource: "mock",
    dataUpdatedAt: latestTimestamp(taskRecords),
    summary: {
      id: storedSummary?.id ?? null,
      status: storedSummary?.aiSummaryStatus ?? "未生成",
      generatedAt: storedSummary?.aiGeneratedAt ?? null,
      model: storedSummary?.aiModel ?? null,
      keyAchievements,
      risks,
      coordination,
      nextFocus,
    },
    metrics: {
      memberCount: memberPages.length,
      taskCount: taskRecords.length,
      riskCount: taskRecords.filter((record) => RISK_STATUSES.has(record.status)).length,
      helpCount: coordination.length,
      completedCount: taskRecords.filter((record) => record.status === "已完成").length,
    },
    members: memberPages,
  };
}
