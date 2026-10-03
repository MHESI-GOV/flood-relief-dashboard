(function () {
  "use strict";

  let map = null;
  let clusterGroup = null;
  let dataset = null;
  let baseRecords = []; // dataset.records after the global กทม./ปริมณฑล toggle is applied
  let state = { categories: new Set(), province: "", district: "", affiliation: "" };
  let container = null;
  let mapDiv = null; // persistent element — Leaflet is bound to this node, never recreate it
  let markersById = new Map();
  let categoryOutsideClickHandler = null;

  function fieldRow(label, value) {
    if (!value) return "";
    return `<div class="popup-row"><b>${label}:</b> ${window.App.escapeHtml(value)}</div>`;
  }

  function popupHtml(rec, categories) {
    const cats = categories.filter((c) => rec.categories[c.key]).map((c) => `<span>${c.label}</span>`).join("");
    return `
      <div class="popup-title">${window.App.escapeHtml(rec.name)}</div>
      ${fieldRow("ผู้ประสานงาน", rec.coordinator)}
      ${fieldRow("เบอร์โทรศัพท์", rec.phone)}
      ${fieldRow("จังหวัด", rec.province)}
      ${fieldRow("อำเภอ/เขต", rec.district)}
      ${fieldRow("สังกัด", rec.affiliation)}
      ${fieldRow("รายละเอียดเพิ่มเติม", rec.otherText || rec.notes)}
      <div class="popup-cats">${cats}</div>
    `;
  }

  function ensureMap() {
    if (map) return;
    map = L.map(mapDiv).setView([13.6, 101.0], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    // Plain layer group — deliberately NOT clustered per user request: every point
    // stays visible as its own marker at any zoom level, never collapsed into a bubble.
    clusterGroup = L.layerGroup();
    map.addLayer(clusterGroup);
  }

  function applyFilters() {
    return baseRecords.filter((r) => {
      if (state.categories.size > 0) {
        const has = [...state.categories].some((k) => r.categories[k]);
        if (!has) return false;
      }
      if (state.province && r.province !== state.province) return false;
      if (state.district && r.district !== state.district) return false;
      if (state.affiliation && r.affiliation !== state.affiliation) return false;
      return true;
    });
  }

  function updateMarkers() {
    const filtered = applyFilters();
    clusterGroup.clearLayers();
    markersById = new Map();
    let withCoords = 0;
    for (const rec of filtered) {
      if (rec.lat === null || rec.lng === null) continue;
      withCoords++;
      const marker = L.marker([rec.lat, rec.lng]);
      marker.bindPopup(popupHtml(rec, dataset.categories));
      clusterGroup.addLayer(marker);
      markersById.set(rec.id, marker);
    }
    const countEl = container.querySelector("#locResultCount");
    if (countEl) {
      countEl.textContent =
        filtered.length.toLocaleString("th-TH") +
        " จุดบริการตรงเงื่อนไข" +
        (filtered.length !== withCoords
          ? ` (แสดงบนแผนที่ ${withCoords.toLocaleString("th-TH")} จุด — ${(filtered.length - withCoords).toLocaleString("th-TH")} จุดไม่มีพิกัด)`
          : "");
    }
    const emptyEl = container.querySelector("#locEmptyState");
    if (emptyEl) emptyEl.style.display = filtered.length === 0 ? "block" : "none";
  }

  function districtsForProvince(province) {
    const set = new Set(
      baseRecords.filter((r) => (!province || r.province === province) && r.district).map((r) => r.district)
    );
    return [...set].sort((a, b) => a.localeCompare(b, "th"));
  }

  function rebuildDistrictOptions() {
    const sel = container.querySelector("#filterDistrict");
    const districts = districtsForProvince(state.province);
    sel.innerHTML = '<option value="">ทั้งหมด</option>' + districts.map((d) => `<option value="${window.App.escapeHtml(d)}">${window.App.escapeHtml(d)}</option>`).join("");
    if (!districts.includes(state.district)) state.district = "";
    sel.value = state.district;
  }

  function render(rootEl, ds, pendingFilter) {
    container = rootEl;
    dataset = ds;
    baseRecords = window.App.filterRecords(dataset.records);

    if (pendingFilter && pendingFilter.categoryKey) {
      state.categories = new Set([pendingFilter.categoryKey]);
    }
    if (pendingFilter && pendingFilter.recordId) {
      // Jumping to one specific point — clear filters so it's guaranteed to be visible.
      state.categories = new Set();
      state.province = "";
      state.district = "";
    }

    const provinces = [...new Set(baseRecords.map((r) => r.province).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "th")
    );
    if (state.province && !provinces.includes(state.province)) state.province = "";

    const affiliations = [...new Set(baseRecords.map((r) => r.affiliation).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "th")
    );
    if (state.affiliation && !affiliations.includes(state.affiliation)) state.affiliation = "";

    container.innerHTML = `
      <div class="filter-bar">
        <div class="filter-field grow">
          <label>ประเภทบริการ (เลือกได้หลายรายการ)</label>
          <div class="dropdown-check" id="categoryDropdown">
            <button type="button" class="dropdown-check-btn" id="categoryDropdownBtn">
              <span id="categoryDropdownLabel">ทั้งหมด</span>
              <span class="dropdown-check-arrow">&#9662;</span>
            </button>
            <div class="dropdown-check-panel checkbox-list" id="filterCategory">
              ${dataset.categories
                .map(
                  (c) => `
                <div class="cb-item">
                  <input type="checkbox" id="loc-cat-${c.key}" value="${c.key}" ${state.categories.has(c.key) ? "checked" : ""}/>
                  <label for="loc-cat-${c.key}">${c.label}</label>
                </div>`
                )
                .join("")}
            </div>
          </div>
        </div>
        <div class="filter-field">
          <label>จังหวัด</label>
          <select id="filterProvince">
            <option value="">ทั้งหมด</option>
            ${provinces.map((p) => `<option value="${window.App.escapeHtml(p)}">${window.App.escapeHtml(p)}</option>`).join("")}
          </select>
        </div>
        <div class="filter-field">
          <label>อำเภอ/เขต</label>
          <select id="filterDistrict"><option value="">ทั้งหมด</option></select>
        </div>
        <div class="filter-field">
          <label>ตำบล</label>
          <select id="filterSubdistrict" disabled><option>ไม่มีข้อมูลตำบลในชุดข้อมูล</option></select>
        </div>
        <div class="filter-field">
          <label>สังกัด</label>
          <select id="filterAffiliation">
            <option value="">ทั้งหมด</option>
            ${affiliations.map((a) => `<option value="${window.App.escapeHtml(a)}">${window.App.escapeHtml(a)}</option>`).join("")}
          </select>
        </div>
        <button class="btn-clear" id="btnClearFilters">ล้างตัวกรอง</button>
        <div class="filter-count" id="locResultCount"></div>
      </div>
      <div id="mapSlot"></div>
      <div class="empty-state" id="locEmptyState" style="display:none;">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>
    `;

    if (!mapDiv) {
      mapDiv = document.createElement("div");
      mapDiv.id = "map";
    }
    container.querySelector("#mapSlot").appendChild(mapDiv);

    ensureMap();
    // Leaflet needs a size recalculation whenever its container was reattached/hidden.
    setTimeout(() => {
      map.invalidateSize();
      if (pendingFilter && pendingFilter.recordId) {
        const marker = markersById.get(pendingFilter.recordId);
        if (marker) {
          map.setView(marker.getLatLng(), 15);
          marker.openPopup();
        }
      }
    }, 50);

    const catDropdown = container.querySelector("#categoryDropdown");
    const catDropdownBtn = container.querySelector("#categoryDropdownBtn");
    const catDropdownLabel = container.querySelector("#categoryDropdownLabel");

    function updateCategoryDropdownLabel() {
      catDropdownLabel.textContent = state.categories.size === 0 ? "ทั้งหมด" : `เลือกแล้ว ${state.categories.size} ประเภท`;
    }
    updateCategoryDropdownLabel();

    catDropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      catDropdown.classList.toggle("open");
    });

    if (categoryOutsideClickHandler) document.removeEventListener("click", categoryOutsideClickHandler, true);
    categoryOutsideClickHandler = (e) => {
      if (!catDropdown.contains(e.target)) catDropdown.classList.remove("open");
    };
    document.addEventListener("click", categoryOutsideClickHandler, true);

    container.querySelector("#filterCategory").addEventListener("change", (e) => {
      if (e.target.matches('input[type="checkbox"]')) {
        state.categories = new Set(
          [...container.querySelectorAll('#filterCategory input[type="checkbox"]:checked')].map((cb) => cb.value)
        );
        updateCategoryDropdownLabel();
        updateMarkers();
      }
    });

    const provSel = container.querySelector("#filterProvince");
    provSel.value = state.province;
    provSel.addEventListener("change", () => {
      state.province = provSel.value;
      state.district = "";
      rebuildDistrictOptions();
      updateMarkers();
    });

    rebuildDistrictOptions();
    container.querySelector("#filterDistrict").addEventListener("change", (e) => {
      state.district = e.target.value;
      updateMarkers();
    });

    const affilSel = container.querySelector("#filterAffiliation");
    affilSel.value = state.affiliation;
    affilSel.addEventListener("change", () => {
      state.affiliation = affilSel.value;
      updateMarkers();
    });

    container.querySelector("#btnClearFilters").addEventListener("click", () => {
      state = { categories: new Set(), province: "", district: "", affiliation: "" };
      container.querySelectorAll('#filterCategory input[type="checkbox"]').forEach((cb) => (cb.checked = false));
      updateCategoryDropdownLabel();
      catDropdown.classList.remove("open");
      provSel.value = "";
      affilSel.value = "";
      rebuildDistrictOptions();
      updateMarkers();
    });

    updateMarkers();
  }

  window.PageLocation = { render };
})();
