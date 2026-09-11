const state = {
  report: null,
  pages: [],
  activePage: 0,
};

const elements = {
  weekSelect: document.querySelector("#weekSelect"),
  finalButton: document.querySelector("#finalizeButton"),
  pageNav: document.querySelector("#pageNav"),
  report: document.querySelector("#report"),
  updatedAt: document.querySelector("#updatedAt"),
  toast: document.querySelector("#toast"),
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function dateTime(value) {
  if (!value) return "暂无更新时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function statusClass(status) {
  if (status === "需协同") return "help";
  if (status === "有风险") return "risk";
  if (status === "暂停") return "pause";
  if (status === "已完成") return "done";
  return "normal";
}

function notify(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function renderNav() {
  elements.pageNav.innerHTML = state.pages.map((page, index) => `
    <button class="nav-button ${index === state.activePage ? "active" : ""}" data-page-index="${index}" type="button">
      ${escapeHtml(page.label)}${page.count === undefined ? "" : `<span>${page.count}项</span>`}
    </button>
  `).join("");
}

function summaryList(items, emptyText) {
  if (!items.length) return `<p class="empty-note">${escapeHtml(emptyText)}</p>`;
  return `<ul class="summary-list">${items.map((item) => `
    <li>
      <button class="summary-link" type="button" data-source-record="${escapeHtml(item.sourceRecordIds[0])}">
        ${escapeHtml(item.text)}
        <small>${escapeHtml(item.owner || "团队摘要")}</small>
      </button>
    </li>
  `).join("")}</ul>`;
}

function renderSummaryPage() {
  const { report } = state;
  const { metrics, summary } = report;
  return `
    <section class="page summary-page">
      <div class="page-heading">
        <div>
          <p class="page-kicker">${escapeHtml(report.week)} · 团队总览</p>
          <h2 class="page-title">本周重点一页看清</h2>
          <p class="page-subtitle">摘要条目可直接跳转到对应成员的具体任务。</p>
        </div>
        <div class="summary-state">
          <span class="summary-badge">${escapeHtml(summary.status)} · 模拟摘要</span>
          <span>生成于 ${dateTime(summary.generatedAt)}</span>
        </div>
      </div>
      <div class="metrics">
        <article class="metric"><p class="metric-label">汇报成员</p><p class="metric-value">${metrics.memberCount}</p></article>
        <article class="metric"><p class="metric-label">本周任务</p><p class="metric-value">${metrics.taskCount}</p></article>
        <article class="metric ${metrics.riskCount ? "alert" : ""}"><p class="metric-label">风险 / 协同</p><p class="metric-value">${metrics.riskCount}</p></article>
        <article class="metric ${metrics.helpCount ? "alert" : ""}"><p class="metric-label">需要帮助</p><p class="metric-value">${metrics.helpCount}</p></article>
        <article class="metric"><p class="metric-label">本周完成</p><p class="metric-value">${metrics.completedCount}</p></article>
      </div>
      <div class="summary-grid">
        <article class="summary-card">
          <div class="summary-card-header"><span class="summary-icon">成</span><h3>本周关键成果</h3></div>
          ${summaryList(summary.keyAchievements, "本周没有里程碑或验收记录")}
        </article>
        <article class="summary-card risk-card">
          <div class="summary-card-header"><span class="summary-icon">险</span><h3>风险与问题</h3></div>
          ${summaryList(summary.risks, "本周未填写风险或问题")}
        </article>
        <article class="summary-card help-card">
          <div class="summary-card-header"><span class="summary-icon">协</span><h3>需要协调</h3></div>
          ${summaryList(summary.coordination, "本周没有需要协调的事项")}
        </article>
        <article class="summary-card">
          <div class="summary-card-header"><span class="summary-icon">下</span><h3>下周重点</h3></div>
          ${summaryList(summary.nextFocus, "本周未填写下周计划")}
        </article>
      </div>
    </section>`;
}

function taskCard(task) {
  const item = task.item;
  const deviation = task.deviation;
  const isHelp = task.status === "需协同";
  const isRisk = task.status === "有风险";
  return `
    <article class="task-card ${isHelp ? "is-help" : isRisk ? "is-risk" : ""}" id="record-${escapeHtml(task.id)}">
      <div class="task-head">
        <div>
          <p class="project-context">${escapeHtml(item.portfolio)} / ${escapeHtml(item.projectName)}</p>
          <h3 class="task-title">${escapeHtml(item.taskName)}</h3>
        </div>
        <div class="task-tags">
          <span class="type-pill">${escapeHtml(item.itemType)}</span>
          <span class="status-pill ${statusClass(task.status)}">${escapeHtml(task.status)}</span>
          <div class="progress-block">
            <div class="progress-label"><span>当前进度</span><strong>${percent(task.actualCompletionRate)}</strong></div>
            <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, Math.max(0, task.actualCompletionRate * 100))}%"></div></div>
            <p class="progress-plan ${deviation < 0 ? "behind" : ""}">当周计划 ${percent(task.plannedCompletionRate)} · ${deviation < 0 ? `落后 ${percent(Math.abs(deviation))}` : deviation > 0 ? `领先 ${percent(deviation)}` : "符合计划"}</p>
          </div>
        </div>
      </div>
      <div class="task-body">
        <section class="task-section">
          <h4>本周主要进展</h4>
          <p>${escapeHtml(task.progress)}</p>
        </section>
        <section class="task-section problem">
          <h4>存在问题</h4>
          <p class="${task.problem ? "" : "none"}">${escapeHtml(task.problem || "无")}</p>
        </section>
        <section class="task-section help">
          <h4>需要帮助</h4>
          <p class="${task.helpNeeded ? "" : "none"}">${escapeHtml(task.helpNeeded || "无")}</p>
        </section>
        <section class="task-section">
          <h4>下周计划</h4>
          <p>${escapeHtml(task.nextPlan || "未填写")}</p>
        </section>
      </div>
    </article>`;
}

function renderMemberPage(member) {
  const riskCount = member.tasks.filter((task) => ["有风险", "需协同"].includes(task.status)).length;
  return `
    <section class="page member-page">
      <div class="page-heading">
        <div>
          <p class="page-kicker">${escapeHtml(state.report.week)} · 成员汇报</p>
          <h2 class="page-title">${escapeHtml(member.name)}</h2>
          <p class="page-subtitle">只展示本周有填报记录的任务，不合并同项目下的不同责任任务。</p>
        </div>
        <div class="member-overview">
          <div class="member-stat"><strong>${member.tasks.length}</strong><span>汇报任务</span></div>
          <div class="member-stat"><strong>${riskCount}</strong><span>风险协同</span></div>
        </div>
      </div>
      <div class="task-list">${member.tasks.map(taskCard).join("")}</div>
    </section>`;
}

function renderPage() {
  renderNav();
  const page = state.pages[state.activePage];
  elements.report.innerHTML = page.type === "summary"
    ? renderSummaryPage()
    : renderMemberPage(state.report.members[page.memberIndex]);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setActivePage(index) {
  state.activePage = (index + state.pages.length) % state.pages.length;
  renderPage();
}

async function loadReport(week) {
  elements.report.innerHTML = `<div class="loading-state"><div class="loading-mark"></div><p>正在整理本周周报…</p></div>`;
  const response = await fetch(`/api/report?week=${encodeURIComponent(week)}`);
  if (!response.ok) throw new Error((await response.json()).error || "周报读取失败");
  state.report = await response.json();
  state.pages = [
    { type: "summary", label: "团队摘要" },
    ...state.report.members.map((member, memberIndex) => ({ type: "member", label: member.name, count: member.tasks.length, memberIndex })),
  ];
  state.activePage = 0;
  elements.updatedAt.textContent = `数据更新：${dateTime(state.report.dataUpdatedAt)}`;
  renderPage();
}

async function initialize() {
  try {
    const response = await fetch("/api/weeks");
    if (!response.ok) throw new Error("周次读取失败");
    const { weeks } = await response.json();
    elements.weekSelect.innerHTML = weeks.map((week) => `<option value="${escapeHtml(week)}">${escapeHtml(week)}</option>`).join("");
    await loadReport(weeks[0]);
  } catch (error) {
    elements.report.innerHTML = `<div class="error-state"><h2>周报暂时无法打开</h2><p>${escapeHtml(error.message)}</p><button class="primary-button" type="button" onclick="location.reload()">重新加载</button></div>`;
  }
}

elements.pageNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page-index]");
  if (button) setActivePage(Number(button.dataset.pageIndex));
});

elements.report.addEventListener("click", (event) => {
  const button = event.target.closest("[data-source-record]");
  if (!button) return;
  const recordId = button.dataset.sourceRecord;
  const memberIndex = state.report.members.findIndex((member) => member.tasks.some((task) => task.id === recordId));
  if (memberIndex < 0) return;
  setActivePage(memberIndex + 1);
  requestAnimationFrame(() => {
    const card = document.querySelector(`#record-${CSS.escape(recordId)}`);
    card?.classList.add("is-highlighted");
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => card?.classList.remove("is-highlighted"), 1800);
  });
});

elements.weekSelect.addEventListener("change", () => loadReport(elements.weekSelect.value));

elements.finalButton.addEventListener("click", async () => {
  elements.finalButton.disabled = true;
  elements.finalButton.textContent = "正在生成…";
  try {
    const response = await fetch("/api/summary/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week: state.report.week }),
    });
    if (!response.ok) throw new Error("最终版生成失败");
    state.report.summary = await response.json();
    if (state.activePage === 0) renderPage();
    notify("模拟最终版已生成，本次运行期间有效");
  } catch (error) {
    notify(error.message);
  } finally {
    elements.finalButton.disabled = false;
    elements.finalButton.textContent = "生成最终版";
  }
});

document.addEventListener("keydown", (event) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.key === "ArrowLeft") setActivePage(state.activePage - 1);
  if (event.key === "ArrowRight") setActivePage(state.activePage + 1);
});

initialize();
