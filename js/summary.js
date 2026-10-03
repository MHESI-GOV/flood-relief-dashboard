(function () {
  "use strict";

  const PALETTE = ["#6d28d9", "#8b5cf6", "#a78bfa", "#c4b5fd", "#4c1d95", "#9333ea", "#7e22ce", "#5b21b6", "#ddd6fe"];

  if (window.Chart && window.ChartDataLabels && !window.Chart.registry.plugins.get("datalabels")) {
    window.Chart.register(window.ChartDataLabels);
  }

  let charts = {}; // keep refs so we can destroy before re-render

  function destroyCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};
  }

  function countBy(records, keyFn) {
    const m = new Map();
    for (const r of records) {
      const k = keyFn(r) || "ไม่ระบุ";
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  function render(container, dataset) {
    destroyCharts();
    const records = window.App.filterRecords(dataset.records);

    const byAffil = countBy(records, (r) => r.affiliation);
    const provincesWithData = new Set(records.map((r) => r.province).filter(Boolean));
    const categoryCounts = Object.fromEntries(
      dataset.categories.map((c) => [c.key, records.filter((r) => r.categories[c.key]).length])
    );

    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state">ไม่พบข้อมูลตามเงื่อนไขที่เลือก (ลองปิดตัวกรอง "เฉพาะ กทม. และปริมณฑล")</div>';
      return;
    }

    const affilEntriesSorted = [...byAffil.entries()].sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">จำนวนจุดบริการทั้งหมด</div>
          <div class="kpi-value">${records.length.toLocaleString("th-TH")}</div>
          <div class="kpi-sub">จุดบริการที่มีบริการอย่างน้อย 1 ประเภท (นับแบบไม่ซ้ำ)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">จำนวนจังหวัดที่มีจุดบริการ</div>
          <div class="kpi-value">${provincesWithData.size.toLocaleString("th-TH")}</div>
          <div class="kpi-sub">จากข้อมูลจริงในชีต</div>
        </div>
        ${affilEntriesSorted
          .map(
            ([name, count]) => `
        <div class="kpi-card">
          <div class="kpi-label">${window.App.escapeHtml(name)}</div>
          <div class="kpi-value">${count.toLocaleString("th-TH")}</div>
          <div class="kpi-sub">จุดบริการในสังกัดนี้</div>
        </div>`
          )
          .join("")}
      </div>

      <div class="charts-grid">
        <div class="card">
          <div class="card-title">จำนวนจุดบริการจำแนกตามประเภทบริการ</div>
          <div class="card-sub">คลิกที่แท่งเพื่อดูจุดบริการประเภทนั้นบนแผนที่ (1 จุดอาจมีได้หลายบริการ ผลรวมจึงมากกว่าจำนวนจุดบริการทั้งหมดได้)</div>
          <div class="chart-wrap tall"><canvas id="chartCategory"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">จำนวนจุดบริการจำแนกตามสังกัด</div>
          <div class="card-sub">นับจากจุดบริการที่ไม่ซ้ำกัน</div>
          <div class="chart-wrap tall"><canvas id="chartAffiliation"></canvas></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px;">
        <div class="card-title">จำนวนจุดบริการจำแนกตามจังหวัด</div>
        <div class="card-sub">เรียงจากมากไปน้อย แสดงเฉพาะจังหวัดที่มีข้อมูลจริง (${provincesWithData.size} จังหวัด)</div>
        <div class="chart-wrap" style="height:${Math.max(260, provincesWithData.size * 22)}px;"><canvas id="chartProvince"></canvas></div>
      </div>

      <div class="nav-buttons">
        <button class="nav-btn" id="btnGoLocation">
          <div class="t1">ดูตำแหน่งจุดบริการ</div>
          <div class="t2">&#8594; แผนที่จุดบริการ</div>
        </button>
        <button class="nav-btn" id="btnGoDetail">
          <div class="t1">ดูข้อมูลแบบละเอียด</div>
          <div class="t2">&#8594; รายละเอียดจุดบริการ</div>
        </button>
      </div>
    `;

    container.querySelector("#btnGoLocation").addEventListener("click", () => window.App.goTo("location"));
    container.querySelector("#btnGoDetail").addEventListener("click", () => window.App.goTo("detail"));

    // ---- Category chart (horizontal bar, clickable) ----
    const catLabels = dataset.categories.map((c) => c.label);
    const catData = dataset.categories.map((c) => categoryCounts[c.key]);
    charts.category = new Chart(container.querySelector("#chartCategory"), {
      type: "bar",
      data: {
        labels: catLabels,
        datasets: [{ data: catData, backgroundColor: PALETTE, borderRadius: 6 }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 28 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#3f3f46",
            font: { weight: "600", size: 12 },
            formatter: (v) => v.toLocaleString("th-TH"),
          },
        },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          window.App.goToLocationWithCategory(dataset.categories[idx].key);
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
      },
    });

    // ---- Affiliation chart (doughnut) ----
    const affilEntries = [...byAffil.entries()].sort((a, b) => b[1] - a[1]);
    charts.affiliation = new Chart(container.querySelector("#chartAffiliation"), {
      type: "doughnut",
      data: {
        labels: affilEntries.map((e) => e[0]),
        datasets: [{ data: affilEntries.map((e) => e[1]), backgroundColor: PALETTE }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: window.innerWidth < 640 ? "bottom" : "right",
            labels: { boxWidth: 12, font: { size: 11 } },
          },
          datalabels: {
            color: "#fff",
            font: { weight: "700", size: 13 },
            formatter: (v) => v.toLocaleString("th-TH"),
          },
        },
      },
    });

    // ---- Province chart ----
    const byProvince = countBy(records, (r) => r.province);
    const provEntries = [...byProvince.entries()].sort((a, b) => b[1] - a[1]);
    charts.province = new Chart(container.querySelector("#chartProvince"), {
      type: "bar",
      data: {
        labels: provEntries.map((e) => e[0]),
        datasets: [{ data: provEntries.map((e) => e[1]), backgroundColor: "#7c3aed", borderRadius: 4 }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 28 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#3f3f46",
            font: { weight: "600", size: 12 },
            formatter: (v) => v.toLocaleString("th-TH"),
          },
        },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  window.PageSummary = { render };
})();
