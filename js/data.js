/**
 * Data pipeline: Google Sheets (live) -> clean -> eligibility rule -> category
 * normalization -> dedupe -> shared dataset.
 *
 * Every page (summary.js, location.js, detail.js) must call DataPipeline.load()
 * and use the SAME returned dataset — never re-fetch or re-derive independently,
 * or per-page counts will drift apart (spec: "จำนวนจุดบริการใน Summary, Map และ
 * Detail ต้องสอดคล้องกัน").
 */
(function () {
  "use strict";

  const STANDARD_CATEGORIES = [
    { key: "moto", label: "ซ่อมจักรยานยนต์" },
    { key: "car", label: "ซ่อมรถยนต์" },
    { key: "smallAppliance", label: "ซ่อมเครื่องใช้ไฟฟ้าขนาดเล็ก" },
    { key: "bigAppliance", label: "ซ่อมเครื่องใช้ไฟฟ้าขนาดใหญ่" },
    { key: "homeElectric", label: "ซ่อมระบบไฟฟ้าในครัวเรือน" },
    { key: "health", label: "บริการทางการแพทย์และสาธารณสุข" },
    { key: "food", label: "บริการอาหารและเครื่องดื่ม" },
    { key: "shelter", label: "ศูนย์พักพิง" },
    { key: "other", label: "อื่นๆ" },
  ];

  // Header keyword matchers: first header (in sheet column order) containing the
  // keyword wins. Keep this in sync with README.md if the sheet's headers change.
  const HEADER_MATCHERS = {
    province: ["จังหวัด"],
    district: ["เขต/อำเภอ", "เขต", "อำเภอ"],
    name: ["หน่วยบริการ"],
    affiliation: ["สังกัด"],
    coordinator: ["ประสานงาน"],
    phone: ["โทรศัพท์"],
    location: ["location"],
    // "รถจัก" (not the full word) deliberately — the sheet's own header has a typo
    // ("รถจักยานยนต์", missing ร) that a full "จักรยานยนต์" match would miss.
    cat_moto: ["รถจัก"],
    cat_car: ["ซ่อมรถยนต์"],
    cat_small: ["เครื่องใช้ไฟฟ้าขนาดเล็ก"],
    cat_big: ["เครื่องใช้ไฟฟ้าขนาดใหญ่"],
    cat_homeElectric: ["ระบบไฟฟ้า"],
    cat_health: ["สาธารณ"],
    cat_food: ["อาหาร"],
    cat_shelter: ["ศูนย์พักพิง"],
    otherText: ["บริการอื่นๆ"],
    notes: ["คำอธิบาย"],
  };

  function normalizeHeader(h) {
    return (h || "").toString().trim();
  }

  function resolveColumns(headers) {
    const norm = headers.map(normalizeHeader);
    const map = {};
    for (const field of Object.keys(HEADER_MATCHERS)) {
      const keywords = HEADER_MATCHERS[field];
      let found = -1;
      for (let i = 0; i < norm.length; i++) {
        if (keywords.some((kw) => norm[i].toLowerCase().includes(kw.toLowerCase()))) {
          found = i;
          break;
        }
      }
      map[field] = found; // -1 if not found in this sheet
    }
    return map;
  }

  function loadSheetJSONP(sheetId, gid) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("หมดเวลาเชื่อมต่อ Google Sheets (timeout)"));
      }, 15000);

      function cleanup() {
        clearTimeout(timeout);
        delete window.google.visualization.Query.setResponse;
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window.google = window.google || {};
      window.google.visualization = window.google.visualization || {};
      window.google.visualization.Query = window.google.visualization.Query || {};
      window.google.visualization.Query.setResponse = function (data) {
        cleanup();
        if (!data || data.status !== "ok") {
          reject(new Error("Google Sheets ตอบกลับสถานะผิดพลาด: " + (data && data.status)));
          return;
        }
        resolve(data.table);
      };

      const url =
        "https://docs.google.com/spreadsheets/d/" +
        encodeURIComponent(sheetId) +
        "/gviz/tq?tqx=out:json&gid=" +
        encodeURIComponent(gid) +
        "&_=" +
        Date.now(); // cache-bust so a changed sheet is picked up on reload

      const script = document.createElement("script");
      script.src = url;
      script.onerror = function () {
        cleanup();
        reject(new Error("โหลดข้อมูลจาก Google Sheets ไม่สำเร็จ (เครือข่ายขัดข้อง หรือชีตไม่ public)"));
      };
      document.head.appendChild(script);
    });
  }

  function cellText(row, colIndex) {
    if (colIndex < 0) return "";
    const c = row.c[colIndex];
    if (!c || c.v === null || c.v === undefined) return "";
    return String(c.v).trim();
  }

  function isYes(v) {
    return v.trim() === "มี";
  }

  function extractLatLng(text) {
    if (!text) return null;
    let m = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = text.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = text.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{2,3}\.\d{3,})/);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
    return null;
  }

  function deriveCategories(rec, raw, colMap) {
    const cats = {};
    cats.moto = colMap.cat_moto >= 0 ? isYes(cellText(raw, colMap.cat_moto)) : false;
    cats.car = colMap.cat_car >= 0 ? isYes(cellText(raw, colMap.cat_car)) : false;
    cats.smallAppliance = colMap.cat_small >= 0 ? isYes(cellText(raw, colMap.cat_small)) : false;
    cats.bigAppliance = colMap.cat_big >= 0 ? isYes(cellText(raw, colMap.cat_big)) : false;
    cats.health = colMap.cat_health >= 0 ? isYes(cellText(raw, colMap.cat_health)) : false;
    cats.food = colMap.cat_food >= 0 ? isYes(cellText(raw, colMap.cat_food)) : false;
    cats.shelter = colMap.cat_shelter >= 0 ? isYes(cellText(raw, colMap.cat_shelter)) : false;

    // homeElectric: prefer an explicit (มี/ไม่มี) column if the sheet has one;
    // else fall back to a keyword match inside the free-text "อื่นๆ" column
    // (that's where this was recorded before the dedicated column existed).
    if (colMap.cat_homeElectric >= 0) {
      const v = cellText(raw, colMap.cat_homeElectric);
      cats.homeElectric = v === "มี" || v === "ไม่มี" ? isYes(v) : v.includes("ระบบไฟฟ้า");
    } else {
      cats.homeElectric = rec.otherText.includes("ระบบไฟฟ้า");
    }

    // other: has free-text "อื่นๆ" content that isn't just the homeElectric note
    const otherStripped = rec.otherText.replace(/ระบบไฟฟ้า[^|]*/g, "").trim();
    cats.other = otherStripped.length > 0;

    return cats;
  }

  function buildRecord(raw, colMap, rowIndex) {
    const rec = {
      id: "SP-" + rowIndex,
      province: cellText(raw, colMap.province),
      district: cellText(raw, colMap.district),
      subdistrict: "", // not present in the sheet; kept for UI shape consistency
      name: cellText(raw, colMap.name),
      affiliation: cellText(raw, colMap.affiliation),
      coordinator: cellText(raw, colMap.coordinator),
      phone: cellText(raw, colMap.phone),
      location: cellText(raw, colMap.location),
      otherText: cellText(raw, colMap.otherText),
      notes: cellText(raw, colMap.notes),
    };
    const ll = extractLatLng(rec.location);
    rec.lat = ll ? ll.lat : null;
    rec.lng = ll ? ll.lng : null;
    rec.categories = deriveCategories(rec, raw, colMap);
    rec.activeCategoryKeys = STANDARD_CATEGORIES.filter((c) => rec.categories[c.key]).map(
      (c) => c.key
    );
    return rec;
  }

  function rowSignature(raw) {
    return raw.c.map((c) => (c && c.v !== null && c.v !== undefined ? String(c.v) : "")).join("");
  }

  async function load() {
    const cfg = window.APP_CONFIG;
    const table = await loadSheetJSONP(cfg.SHEET_ID, cfg.SHEET_GID);
    const dataRows = table.rows;
    if (!dataRows || dataRows.length === 0) {
      throw new Error("ไม่พบข้อมูลใน Google Sheets");
    }
    const headerRow = dataRows[0];
    const headers = headerRow.c.map((c) => (c ? c.v : ""));
    const colMap = resolveColumns(headers);

    const missingRequired = ["province", "name"].filter((f) => colMap[f] < 0);
    if (missingRequired.length) {
      throw new Error(
        "ไม่พบคอลัมน์ที่จำเป็นในชีต: " + missingRequired.join(", ") + " — ตรวจสอบหัวตารางในชีตต้นทาง"
      );
    }

    const totalRaw = dataRows.length - 1;
    const seen = new Set();
    let duplicateCount = 0;
    let noServiceCount = 0;
    const records = [];

    for (let i = 1; i < dataRows.length; i++) {
      const raw = dataRows[i];
      if (!raw || !raw.c) continue;
      const sig = rowSignature(raw);
      if (seen.has(sig)) {
        duplicateCount++;
        continue;
      }
      seen.add(sig);

      const rec = buildRecord(raw, colMap, i + 1); // +1 => sheet row number (header = row1)
      if (!rec.name) continue; // completely blank row

      const hasAnyService = STANDARD_CATEGORIES.some((c) => rec.categories[c.key]);
      if (!hasAnyService) {
        noServiceCount++;
        continue;
      }
      records.push(rec);
    }

    const quality = {
      totalRawRows: totalRaw,
      duplicateRowsDropped: duplicateCount,
      noServiceRowsExcluded: noServiceCount,
      eligibleServicePoints: records.length,
      withCoords: records.filter((r) => r.lat !== null).length,
      withoutCoords: records.filter((r) => r.lat === null).length,
      byCategory: Object.fromEntries(
        STANDARD_CATEGORIES.map((c) => [c.key, records.filter((r) => r.categories[c.key]).length])
      ),
      provinces: new Set(records.map((r) => r.province).filter(Boolean)).size,
      loadedAt: new Date().toISOString(),
    };

    // Internal data-quality report (console only — not shown in the end-user UI,
    // per spec section 11).
    console.groupCollapsed("[DataPipeline] Data quality report");
    console.table(quality.byCategory);
    console.log(quality);
    console.groupEnd();

    return { records, quality, categories: STANDARD_CATEGORIES, columnMap: colMap, headers };
  }

  let cachedPromise = null;
  window.DataPipeline = {
    STANDARD_CATEGORIES,
    load: function (force) {
      if (!cachedPromise || force) {
        cachedPromise = load();
      }
      return cachedPromise;
    },
  };
})();
