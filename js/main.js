(function () {
  "use strict";

  const ROUTES = {
    summary: { title: "ภาพรวม", sub: "สรุปจุดบริการทั้งหมดที่ผ่านเงื่อนไขของระบบ" },
    location: { title: "แผนที่จุดบริการ", sub: "ค้นหาและกรองจุดบริการบนแผนที่" },
    detail: { title: "รายละเอียดจุดบริการ", sub: "ตารางข้อมูลจุดบริการแบบละเอียด" },
  };

  let dataset = null;
  let pendingLocationFilter = null; // category key to pre-apply when Location page renders

  const BKK_METRO_PROVINCES = ["กรุงเทพมหานคร", "นครปฐม", "ปทุมธานี", "นนทบุรี", "สมุทรปราการ", "สมุทรสาคร"];
  window.App = window.App || {};
  window.App.BKK_METRO_PROVINCES = BKK_METRO_PROVINCES;
  window.App.state = { bkkOnly: false };
  // Every page must call this instead of reading dataset.records directly, so the global
  // "กทม. และปริมณฑล" toggle applies consistently across Summary / Location / Detail.
  window.App.filterRecords = function (records) {
    if (!window.App.state.bkkOnly) return records;
    return records.filter((r) => BKK_METRO_PROVINCES.includes(r.province));
  };

  const els = {
    pageTitle: document.getElementById("pageTitle"),
    pageSub: document.getElementById("pageSub"),
    statusPill: document.getElementById("statusPill"),
    statusText: document.getElementById("statusText"),
    errorBanner: document.getElementById("errorBanner"),
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),
    modalBackdrop: document.getElementById("modalBackdrop"),
  };

  function setStatus(kind, text) {
    els.statusPill.className = "status-pill" + (kind === "error" ? " error" : kind === "loading" ? " loading" : "");
    els.statusText.textContent = text;
  }

  function showError(message) {
    els.errorBanner.innerHTML =
      '<div class="banner-error">' + escapeHtml(message) + "</div>";
  }
  function clearError() {
    els.errorBanner.innerHTML = "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  window.App = window.App || {};
  window.App.escapeHtml = escapeHtml;

  function currentRoute() {
    const h = (location.hash || "#summary").replace("#", "");
    return ROUTES[h] ? h : "summary";
  }

  function renderRoute() {
    const route = currentRoute();
    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.route === route);
    });
    document.querySelectorAll(".page").forEach((sec) => sec.classList.remove("active"));
    const sec = document.getElementById("page-" + route);
    sec.classList.add("active");
    els.pageTitle.textContent = ROUTES[route].title;
    els.pageSub.textContent = ROUTES[route].sub;

    if (!dataset) return; // still loading / errored — page renderers need data

    if (route === "summary") window.PageSummary.render(sec, dataset);
    if (route === "location") {
      window.PageLocation.render(sec, dataset, pendingLocationFilter);
      pendingLocationFilter = null;
    }
    if (route === "detail") window.PageDetail.render(sec, dataset);

    // close mobile sidebar on navigation
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("open");
  }

  window.App.goToLocationWithCategory = function (categoryKey) {
    pendingLocationFilter = { categoryKey };
    location.hash = "#location";
    renderRoute();
  };
  window.App.goToLocationWithPoint = function (recordId) {
    pendingLocationFilter = { recordId };
    location.hash = "#location";
    renderRoute();
  };
  window.App.goTo = function (route) {
    location.hash = "#" + route;
  };

  window.App.openModal = function (innerHtml) {
    els.modalBackdrop.innerHTML =
      '<div class="modal-card"><button class="modal-close" id="modalCloseBtn">&times;</button>' + innerHtml + "</div>";
    els.modalBackdrop.classList.add("open");
    document.getElementById("modalCloseBtn").addEventListener("click", window.App.closeModal);
  };
  window.App.closeModal = function () {
    els.modalBackdrop.classList.remove("open");
    els.modalBackdrop.innerHTML = "";
  };
  els.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === els.modalBackdrop) window.App.closeModal();
  });

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => window.App.goTo(btn.dataset.route));
  });
  window.addEventListener("hashchange", renderRoute);

  document.getElementById("sidebarToggle").addEventListener("click", () => {
    els.sidebar.classList.toggle("open");
    els.sidebarBackdrop.classList.toggle("open");
  });
  els.sidebarBackdrop.addEventListener("click", () => {
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("open");
  });

  async function boot(force) {
    setStatus("loading", "กำลังโหลดข้อมูล...");
    clearError();
    try {
      dataset = await window.DataPipeline.load(force);
      const q = dataset.quality;
      setStatus("ok", "อัปเดตล่าสุด " + new Date(q.loadedAt).toLocaleTimeString("th-TH"));
      renderRoute();
    } catch (err) {
      console.error(err);
      setStatus("error", "โหลดข้อมูลไม่สำเร็จ");
      showError(
        "ไม่สามารถโหลดข้อมูลจาก Google Sheets ได้: " +
          err.message +
          " — ตรวจสอบว่าชีตเปิดสิทธิ์ \"ทุกคนที่มีลิงก์\" และลองรีเฟรชอีกครั้ง"
      );
    }
  }

  document.getElementById("btnRefresh").addEventListener("click", () => boot(true));

  document.getElementById("bkkToggle").addEventListener("change", (e) => {
    window.App.state.bkkOnly = e.target.checked;
    renderRoute();
  });

  if (!location.hash) location.hash = "#summary";
  renderRoute();
  boot(false);
})();
