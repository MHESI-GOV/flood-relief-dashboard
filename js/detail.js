(function () {
  "use strict";

  const COLUMNS = [
    { key: "name", label: "ชื่อจุดบริการ" },
    { key: "province", label: "จังหวัด" },
    { key: "district", label: "อำเภอ/เขต" },
    { key: "subdistrict", label: "ตำบล" },
    { key: "categories", label: "ประเภทการให้บริการ", sortable: false },
    { key: "phone", label: "เบอร์ติดต่อ", fit: true },
    { key: "affiliation", label: "สังกัด", fit: true },
  ];

  let dataset = null;
  let baseRecords = []; // dataset.records after the global กทม./ปริมณฑล toggle is applied
  let container = null;
  let state = { search: "", province: "", categories: new Set(), sortKey: "name", sortDir: "asc", page: 1, pageSize: 25 };
  let searchDebounce = null;

  function matches(rec) {
    if (state.province && rec.province !== state.province) return false;
    if (state.categories.size > 0) {
      const has = [...state.categories].some((k) => rec.categories[k]);
      if (!has) return false;
    }
    if (state.search) {
      const hay = [rec.name, rec.province, rec.district, rec.affiliation, rec.coordinator, rec.phone]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(state.search.toLowerCase())) return false;
    }
    return true;
  }

  function sortRecords(list) {
    const dir = state.sortDir === "asc" ? 1 : -1;
    return list.slice().sort((a, b) => {
      const av = (a[state.sortKey] || "").toString();
      const bv = (b[state.sortKey] || "").toString();
      return av.localeCompare(bv, "th") * dir;
    });
  }

  function catTags(rec) {
    return dataset.categories
      .filter((c) => rec.categories[c.key])
      .map((c) => `<span class="cat-tag">${c.label}</span>`)
      .join("");
  }

  function modalHtml(rec) {
    const row = (label, val) => (val ? `<div class="modal-row"><b>${label}</b> ${window.App.escapeHtml(val)}</div>` : "");
    return `
      <h3>${window.App.escapeHtml(rec.name)}</h3>
      ${row("สังกัด:", rec.affiliation)}
      ${row("ผู้ประสานงาน:", rec.coordinator)}
      ${row("เบอร์โทรศัพท์:", rec.phone)}
      ${row("จังหวัด:", rec.province)}
      ${row("อำเภอ/เขต:", rec.district)}
      ${row("พิกัด:", rec.lat !== null ? rec.lat.toFixed(5) + ", " + rec.lng.toFixed(5) : "")}
      ${row("รายละเอียดบริการอื่นๆ:", rec.otherText)}
      ${row("คำอธิบายเพิ่มเติม:", rec.notes)}
      <div class="modal-row"><b>ประเภทบริการ:</b></div>
      <div class="popup-cats">${catTags(rec)}</div>
    `;
  }

  function renderTable() {
    const filtered = sortRecords(baseRecords.filter(matches));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.pageSize;
    const pageRows = filtered.slice(start, start + state.pageSize);

    const thead = COLUMNS.map((c) => {
      const arrow = c.sortable === false ? "" : state.sortKey === c.key ? (state.sortDir === "asc" ? "&#9650;" : "&#9660;") : "";
      return `<th class="${c.fit ? "fit-col" : ""}" data-key="${c.key}" data-sortable="${c.sortable !== false}">${c.label} <span class="arrow">${arrow}</span></th>`;
    }).join("");

    const tbody = pageRows
      .map(
        (r) => `
      <tr data-id="${r.id}">
        <td>${window.App.escapeHtml(r.name)}</td>
        <td>${window.App.escapeHtml(r.province)}</td>
        <td>${window.App.escapeHtml(r.district) || "-"}</td>
        <td>${window.App.escapeHtml(r.subdistrict) || "-"}</td>
        <td>${catTags(r)}</td>
        <td class="fit-col">${window.App.escapeHtml(r.phone) || "-"}</td>
        <td class="fit-col">${window.App.escapeHtml(r.affiliation) || "-"}</td>
      </tr>`
      )
      .join("");

    const tableArea = container.querySelector("#tableArea");
    tableArea.innerHTML =
      total === 0
        ? '<div class="empty-state">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>'
        : `<div class="table-scroll"><table class="data-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;

    tableArea.querySelectorAll("th[data-sortable=true]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else {
          state.sortKey = key;
          state.sortDir = "asc";
        }
        renderTable();
      });
    });
    tableArea.querySelectorAll("tbody tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        const rec = baseRecords.find((r) => r.id === tr.dataset.id);
        if (rec) window.App.openModal(modalHtml(rec));
      });
    });

    container.querySelector("#resultSummary").textContent =
      total === 0 ? "ไม่พบข้อมูล" : `แสดง ${start + 1}-${Math.min(start + state.pageSize, total)} จาก ${total.toLocaleString("th-TH")} รายการ`;

    const pag = container.querySelector("#pagination");
    pag.innerHTML = `
      <button id="pgFirst" ${state.page <= 1 ? "disabled" : ""}>&laquo;</button>
      <button id="pgPrev" ${state.page <= 1 ? "disabled" : ""}>&lsaquo;</button>
      <span>หน้า ${state.page} / ${totalPages}</span>
      <button id="pgNext" ${state.page >= totalPages ? "disabled" : ""}>&rsaquo;</button>
      <button id="pgLast" ${state.page >= totalPages ? "disabled" : ""}>&raquo;</button>
    `;
    pag.querySelector("#pgFirst").addEventListener("click", () => { state.page = 1; renderTable(); });
    pag.querySelector("#pgPrev").addEventListener("click", () => { state.page--; renderTable(); });
    pag.querySelector("#pgNext").addEventListener("click", () => { state.page++; renderTable(); });
    pag.querySelector("#pgLast").addEventListener("click", () => { state.page = totalPages; renderTable(); });
  }

  function render(rootEl, ds) {
    container = rootEl;
    dataset = ds;
    baseRecords = window.App.filterRecords(dataset.records);
    const provinces = [...new Set(baseRecords.map((r) => r.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
    if (state.province && !provinces.includes(state.province)) state.province = "";

    container.innerHTML = `
      <div class="filter-bar">
        <div class="filter-field grow">
          <label>ค้นหา</label>
          <input type="text" id="searchBox" placeholder="ค้นหาชื่อจุดบริการ / จังหวัด / ผู้ประสานงาน / เบอร์โทร" />
        </div>
        <div class="filter-field">
          <label>จังหวัด</label>
          <select id="filterProvinceD">
            <option value="">ทั้งหมด</option>
            ${provinces.map((p) => `<option value="${window.App.escapeHtml(p)}">${window.App.escapeHtml(p)}</option>`).join("")}
          </select>
        </div>
        <div class="filter-field grow">
          <label>ประเภทบริการ (เลือกได้หลายรายการ)</label>
          <div class="checkbox-list" id="filterCategoryD">
            ${dataset.categories
              .map(
                (c) => `
              <div class="cb-item">
                <input type="checkbox" id="det-cat-${c.key}" value="${c.key}" ${state.categories.has(c.key) ? "checked" : ""}/>
                <label for="det-cat-${c.key}">${c.label}</label>
              </div>`
              )
              .join("")}
          </div>
        </div>
        <div class="filter-field">
          <label>แถวต่อหน้า</label>
          <select id="pageSizeSel">
            <option value="10">10</option>
            <option value="25" selected>25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <button class="btn-clear" id="btnClearFiltersD">ล้างตัวกรอง</button>
      </div>

      <p style="font-size:11.5px;color:var(--gray-500);margin:-4px 0 10px;">
        * ชุดข้อมูลนี้ไม่มีคอลัมน์ตำบลจากต้นทาง คอลัมน์ "ตำบล" จึงแสดง "-" ทุกแถว
      </p>

      <div class="table-toolbar">
        <div id="resultSummary" style="font-size:13px;color:var(--gray-500);"></div>
      </div>
      <div id="tableArea"></div>
      <div class="pagination" id="pagination"></div>
    `;

    container.querySelector("#searchBox").addEventListener("input", (e) => {
      clearTimeout(searchDebounce);
      const val = e.target.value;
      searchDebounce = setTimeout(() => {
        state.search = val;
        state.page = 1;
        renderTable();
      }, 250);
    });
    container.querySelector("#filterProvinceD").value = state.province;
    container.querySelector("#filterProvinceD").addEventListener("change", (e) => {
      state.province = e.target.value;
      state.page = 1;
      renderTable();
    });
    container.querySelector("#filterCategoryD").addEventListener("change", (e) => {
      if (e.target.matches('input[type="checkbox"]')) {
        state.categories = new Set(
          [...container.querySelectorAll('#filterCategoryD input[type="checkbox"]:checked')].map((cb) => cb.value)
        );
        state.page = 1;
        renderTable();
      }
    });
    container.querySelector("#pageSizeSel").addEventListener("change", (e) => {
      state.pageSize = parseInt(e.target.value, 10);
      state.page = 1;
      renderTable();
    });
    container.querySelector("#btnClearFiltersD").addEventListener("click", () => {
      state.search = "";
      state.province = "";
      state.categories = new Set();
      state.page = 1;
      container.querySelector("#searchBox").value = "";
      container.querySelector("#filterProvinceD").value = "";
      container.querySelectorAll('#filterCategoryD input[type="checkbox"]').forEach((cb) => (cb.checked = false));
      renderTable();
    });

    renderTable();
  }

  window.PageDetail = { render };
})();
