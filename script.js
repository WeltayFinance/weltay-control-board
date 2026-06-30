/* ==========================================================================
   WELTAY Control Board
   Read-only board logic. Reads weltay_control_board_data.json and renders the
   interface. Never writes back to the JSON or to GitHub. localStorage is used
   only to remember view preferences, wrapped so missing storage never breaks
   the board.
   ========================================================================== */

(function () {
  "use strict";

  /* ----------------------------------------------------------------------
     Reference constants
     ---------------------------------------------------------------------- */

  var DATA_URL = "weltay_control_board_data.json";

  // Fixed display order for readiness gates.
  var GATE_ORDER = [
    "Concept Clarity",
    "MVP Definition",
    "Prototype Readiness",
    "Validation Readiness",
    "Commercial Model Readiness",
    "Regulatory Boundary Readiness",
    "Investment / Allocation Logic Readiness",
    "External Pitch / Adviser Review Readiness",
    "None"
  ];

  // Fixed display order for deliverable statuses (Kanban columns).
  var DEL_STATUS_ORDER = [
    "Backlog",
    "Ready",
    "In Progress",
    "Blocked",
    "Handover Needed",
    "PM Review",
    "Founder Review",
    "Done",
    "Archived"
  ];
  var DEL_STATUS_SET = toSet(DEL_STATUS_ORDER);

  // Status to summary bucket for milestone roll-ups.
  var STATUS_SUMMARY = {
    "Backlog": "NotStarted",
    "Ready": "NotStarted",
    "In Progress": "Live",
    "Handover Needed": "Live",
    "PM Review": "Live",
    "Founder Review": "Live",
    "Blocked": "Blocked",
    "Done": "Complete",
    "Archived": "Archived"
  };

  // Statuses that draw the eye (not alarmist, just prominent).
  var DEL_ATTENTION_STATUS = toSet(["Blocked", "PM Review", "Founder Review"]);

  // Historical deliverable statuses, hidden from the headline by default.
  var DEL_HISTORICAL = toSet(["Done", "Archived"]);

  var WORKSTREAMS = [
    "Product & UX",
    "Investment Strategy",
    "Financial Modelling",
    "Business Model",
    "Compliance & Regulatory",
    "Go-To-Market",
    "Brand & Positioning",
    "Programme Management"
  ];

  var RAAIDD_TYPES = ["Risk", "Assumption", "Action", "Issue", "Dependency", "Decision"];

  // Valid statuses per RAAIDD type. Anything outside these sets is flagged.
  var RAAIDD_VALID_STATUS = {
    "Risk": ["Open", "Mitigating", "Monitoring", "Accepted", "Closed"],
    "Assumption": ["Unvalidated", "Testing", "Validated", "Invalidated"],
    "Action": ["Open", "In Progress", "Blocked", "Done"],
    "Issue": ["Open", "Investigating", "Resolved", "Closed"],
    "Dependency": ["Open", "Waiting", "Blocked", "Met"],
    "Decision": ["Proposed", "Made", "Deferred", "Superseded"]
  };

  // Historical / settled RAAIDD states, shown more quietly by default.
  var RAAIDD_HISTORICAL = toSet([
    "Closed", "Superseded", "Resolved", "Validated", "Made", "Met", "Done", "Accepted", "Deferred"
  ]);

  var VALID_PRIORITIES = toSet(["P1", "P2", "P3", "P4"]);

  var PRIORITY_RANK = { "P1": 1, "P2": 2, "P3": 3, "P4": 4 };

  var STORAGE_KEY = "weltay-control-board-prefs";

  /* ----------------------------------------------------------------------
     Application state
     ---------------------------------------------------------------------- */

  var state = {
    meta: {},
    deliverables: [],
    raaidd: [],
    delById: {},
    raaiddById: {},
    warnings: [],
    view: "deliverables",       // "deliverables" | "raaidd"
    layout: "kanban",           // "kanban" | "table" (deliverables only)
    search: "",
    showHistorical: false,
    filters: {
      priority: "",
      status: "",
      owner: "",
      gate: "",
      workstream: "",
      type: ""
    }
  };

  /* ----------------------------------------------------------------------
     Small helpers
     ---------------------------------------------------------------------- */

  function $(id) { return document.getElementById(id); }

  function toSet(arr) {
    var s = {};
    for (var i = 0; i < arr.length; i++) { s[arr[i]] = true; }
    return s;
  }

  function isBlank(v) {
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  }

  function asArray(v) { return Array.isArray(v) ? v : []; }

  function esc(v) {
    if (v === undefined || v === null) { return ""; }
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function priorityRank(p) {
    return PRIORITY_RANK[p] || 99;
  }

  function priorityClass(p) {
    return VALID_PRIORITIES[p] ? "badge--" + p.toLowerCase() : "badge--invalid";
  }

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isBlank(v)) { continue; }
      if (!seen[v]) { seen[v] = true; out.push(v); }
    }
    out.sort(function (a, b) { return String(a).localeCompare(String(b)); });
    return out;
  }

  /* ----------------------------------------------------------------------
     localStorage (view preferences only, fully optional)
     ---------------------------------------------------------------------- */

  function loadPrefs() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) { return; }
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object") { return; }
      if (p.view === "deliverables" || p.view === "raaidd") { state.view = p.view; }
      if (p.layout === "kanban" || p.layout === "table") { state.layout = p.layout; }
      if (typeof p.search === "string") { state.search = p.search; }
      if (typeof p.showHistorical === "boolean") { state.showHistorical = p.showHistorical; }
      if (p.filters && typeof p.filters === "object") {
        var keys = ["priority", "status", "owner", "gate", "workstream", "type"];
        for (var i = 0; i < keys.length; i++) {
          if (typeof p.filters[keys[i]] === "string") {
            state.filters[keys[i]] = p.filters[keys[i]];
          }
        }
      }
    } catch (e) { /* storage unavailable or corrupt; ignore */ }
  }

  function savePrefs() {
    try {
      var payload = {
        view: state.view,
        layout: state.layout,
        search: state.search,
        showHistorical: state.showHistorical,
        filters: state.filters
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) { /* ignore; preferences are a convenience only */ }
  }

  /* ----------------------------------------------------------------------
     Boot / load
     ---------------------------------------------------------------------- */

  function showBootError(message) {
    var box = $("boot-message");
    var app = $("app");
    if (app) { app.hidden = true; }
    if (box) {
      box.hidden = false;
      box.innerHTML =
        '<strong>The board could not load.</strong>' +
        '<p>' + esc(message) + '</p>' +
        '<p class="boot-message__hint">Check that <code>' + esc(DATA_URL) +
        '</code> is present in the same folder and contains valid JSON.</p>';
    }
  }

  function boot() {
    loadPrefs();
    fetch(DATA_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("Data file responded with HTTP " + res.status + ".");
        }
        return res.text();
      })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error("The data file is not valid JSON.");
        }
        if (!data || typeof data !== "object") {
          throw new Error("The data file did not contain an object.");
        }
        if (!Array.isArray(data.deliverables) || !Array.isArray(data.raaidd)) {
          throw new Error("The data file must contain 'deliverables' and 'raaidd' arrays.");
        }
        initialise(data);
      })
      .catch(function (err) {
        showBootError(err && err.message ? err.message : "Unknown error.");
      });
  }

  function initialise(data) {
    state.meta = (data.meta && typeof data.meta === "object") ? data.meta : {};
    state.deliverables = data.deliverables;
    state.raaidd = data.raaidd;

    indexRecords();
    state.warnings = validateData();

    $("app").hidden = false;

    renderHeader();
    renderTestBanner();
    renderSourceStrip();
    renderFounderActions();
    renderWarnings();
    populateFilters();
    syncControlsToState();
    bindEvents();

    render();
  }

  function indexRecords() {
    state.delById = {};
    state.raaiddById = {};
    var i;
    for (i = 0; i < state.deliverables.length; i++) {
      var d = state.deliverables[i];
      if (d && !isBlank(d.id) && !state.delById[d.id]) { state.delById[d.id] = d; }
    }
    for (i = 0; i < state.raaidd.length; i++) {
      var r = state.raaidd[i];
      if (r && !isBlank(r.id) && !state.raaiddById[r.id]) { state.raaiddById[r.id] = r; }
    }
  }

  /* ----------------------------------------------------------------------
     Data quality validation -> warnings
     ---------------------------------------------------------------------- */

  function validateData() {
    var warnings = [];
    var seenIds = {};
    var i, j;

    // meta.lastUpdated
    if (isBlank(state.meta.lastUpdated)) {
      warnings.push(warn("Metadata", "Board metadata is missing a last updated date."));
    }

    // Deliverables
    var delRequired = ["id", "title", "primaryWorkstream", "owner", "priority", "status"];
    for (i = 0; i < state.deliverables.length; i++) {
      var d = state.deliverables[i];
      var did = isBlank(d.id) ? "(no id)" : d.id;

      // duplicate id
      if (!isBlank(d.id)) {
        if (seenIds[d.id]) {
          warnings.push(warn("Duplicate ID", "Deliverable ID " + idRef(d.id) + " appears more than once."));
        }
        seenIds[d.id] = true;
      }

      for (j = 0; j < delRequired.length; j++) {
        if (isBlank(d[delRequired[j]])) {
          warnings.push(warn("Missing field", idRef(did) + " is missing required field '" + delRequired[j] + "'."));
        }
      }

      if (!isBlank(d.priority) && !VALID_PRIORITIES[d.priority]) {
        warnings.push(warn("Invalid priority", idRef(did) + " has priority '" + esc(d.priority) + "' (expected P1 to P4)."));
      }
      if (!isBlank(d.status) && !DEL_STATUS_SET[d.status]) {
        warnings.push(warn("Invalid status", idRef(did) + " has unrecognised status '" + esc(d.status) + "'."));
      }
      // Readiness gate: empty/missing is a warning; explicit "None" is fine.
      if (isBlank(d.readinessGate)) {
        warnings.push(warn("Missing readiness gate", idRef(did) + " has no readiness gate. Use 'None' if intentional."));
      }
      // Founder action description
      if (d.founderActionRequired === true && isBlank(d.founderActionDescription)) {
        warnings.push(warn("Founder action", idRef(did) + " is flagged for Founder action but has no description."));
      }
      // Linked RAAIDD references exist + two-way
      var links = asArray(d.linkedRaaiddItems);
      for (j = 0; j < links.length; j++) {
        var rid = links[j];
        var rrec = state.raaiddById[rid];
        if (!rrec) {
          warnings.push(warn("Broken link", idRef(did) + " links to RAAIDD item " + idRef(rid) + ", which does not exist."));
        } else if (asArray(rrec.linkedDeliverables).indexOf(d.id) === -1) {
          warnings.push(warn("One-way link", idRef(did) + " links to " + idRef(rid) + ", but the link is not returned."));
        }
      }
    }

    // RAAIDD
    var raaiddRequired = ["id", "type", "title", "owner", "priority", "status"];
    for (i = 0; i < state.raaidd.length; i++) {
      var r = state.raaidd[i];
      var rid2 = isBlank(r.id) ? "(no id)" : r.id;

      if (!isBlank(r.id)) {
        if (seenIds[r.id]) {
          warnings.push(warn("Duplicate ID", "ID " + idRef(r.id) + " appears more than once."));
        }
        seenIds[r.id] = true;
      }

      for (j = 0; j < raaiddRequired.length; j++) {
        if (isBlank(r[raaiddRequired[j]])) {
          warnings.push(warn("Missing field", idRef(rid2) + " is missing required field '" + raaiddRequired[j] + "'."));
        }
      }

      if (!isBlank(r.priority) && !VALID_PRIORITIES[r.priority]) {
        warnings.push(warn("Invalid priority", idRef(rid2) + " has priority '" + esc(r.priority) + "' (expected P1 to P4)."));
      }
      if (!isBlank(r.type) && RAAIDD_TYPES.indexOf(r.type) === -1) {
        warnings.push(warn("Invalid type", idRef(rid2) + " has unrecognised type '" + esc(r.type) + "'."));
      } else if (!isBlank(r.type) && !isBlank(r.status)) {
        var valid = RAAIDD_VALID_STATUS[r.type] || [];
        if (valid.indexOf(r.status) === -1) {
          warnings.push(warn("Invalid status", idRef(rid2) + " (" + esc(r.type) + ") has status '" + esc(r.status) + "', which is not valid for that type."));
        }
      }

      if (r.founderActionRequired === true && isBlank(r.founderActionDescription)) {
        warnings.push(warn("Founder action", idRef(rid2) + " is flagged for Founder action but has no description."));
      }

      var dlinks = asArray(r.linkedDeliverables);
      for (j = 0; j < dlinks.length; j++) {
        var dref = dlinks[j];
        var drec = state.delById[dref];
        if (!drec) {
          warnings.push(warn("Broken link", idRef(rid2) + " links to deliverable " + idRef(dref) + ", which does not exist."));
        } else if (asArray(drec.linkedRaaiddItems).indexOf(r.id) === -1) {
          warnings.push(warn("One-way link", idRef(rid2) + " links to " + idRef(dref) + ", but the link is not returned."));
        }
      }
    }

    return warnings;
  }

  function warn(kind, detail) { return { kind: kind, detail: detail }; }
  function idRef(id) { return '<span class="id-ref">' + esc(id) + "</span>"; }

  /* ----------------------------------------------------------------------
     Header, banner, source strip
     ---------------------------------------------------------------------- */

  function renderHeader() {
    var m = state.meta;
    if (!isBlank(m.boardTitle)) { $("board-title").textContent = m.boardTitle; }
    if (!isBlank(m.boardSubtitle)) { $("board-subtitle").textContent = m.boardSubtitle; }

    var bits = [];
    if (!isBlank(m.version)) { bits.push(metaItem("Version", m.version)); }
    if (!isBlank(m.dataOwner)) { bits.push(metaItem("Owner", m.dataOwner)); }
    bits.push(metaItem("Last updated", isBlank(m.lastUpdated) ? "Not provided" : m.lastUpdated));
    $("header-meta").innerHTML = bits.join("");
  }

  function metaItem(label, value) {
    return '<span class="meta-item">' + esc(label) + "<strong>" + esc(value) + "</strong></span>";
  }

  function renderTestBanner() {
    var banner = $("test-banner");
    if (state.meta.datasetType === "test") {
      banner.hidden = false;
      var text = !isBlank(state.meta.dataStatus)
        ? state.meta.dataStatus
        : "This board is showing test data, not the live project position.";
      $("test-banner-text").textContent = text;
    } else {
      banner.hidden = true;
    }
  }

  function renderSourceStrip() {
    var m = state.meta;
    var chips = [];
    chips.push(stripItem("Source", isBlank(m.sourceFile) ? DATA_URL : m.sourceFile, false));
    chips.push(stripItem("Mode", "Read-only", false));
    chips.push(stripItem("Deliverables", String(state.deliverables.length), false));
    chips.push(stripItem("RAAIDD items", String(state.raaidd.length), false));
    if (state.warnings.length > 0) {
      chips.push(stripItem("Data warnings", String(state.warnings.length), true));
    }
    $("source-strip").innerHTML = chips.join("");
  }

  function stripItem(label, value, isFlag) {
    return '<span class="strip-item' + (isFlag ? " is-flag" : "") + '">' +
      esc(label) + " <strong>" + esc(value) + "</strong></span>";
  }

  /* ----------------------------------------------------------------------
     Founder Actions panel (aggregated from BOTH arrays)
     ---------------------------------------------------------------------- */

  function founderActionRecords() {
    var out = [];
    var i;
    for (i = 0; i < state.deliverables.length; i++) {
      if (state.deliverables[i].founderActionRequired === true) {
        out.push({ source: "Deliverable", rec: state.deliverables[i] });
      }
    }
    for (i = 0; i < state.raaidd.length; i++) {
      if (state.raaidd[i].founderActionRequired === true) {
        out.push({ source: "RAAIDD", rec: state.raaidd[i] });
      }
    }
    out.sort(function (a, b) {
      var pr = priorityRank(a.rec.priority) - priorityRank(b.rec.priority);
      if (pr !== 0) { return pr; }
      return String(a.rec.id).localeCompare(String(b.rec.id));
    });
    return out;
  }

  function renderFounderActions() {
    var items = founderActionRecords();
    var host = $("founder-actions");
    $("founder-count").textContent = items.length > 0 ? String(items.length) : "";

    if (items.length === 0) {
      host.innerHTML = '<div class="empty-state">No Founder Actions currently flagged.</div>';
      return;
    }

    var html = '<div class="founder-grid">';
    for (var i = 0; i < items.length; i++) {
      var rec = items[i].rec;
      var source = items[i].source;
      var linked = source === "Deliverable"
        ? asArray(rec.linkedRaaiddItems)
        : asArray(rec.linkedDeliverables);

      html += '<div class="fa-card" data-source="' + source.toLowerCase() + '" data-id="' + esc(rec.id) + '" tabindex="0" role="button">';
      html += '<div class="fa-card__top">';
      html += '<span class="badge ' + priorityClass(rec.priority) + '">' + esc(rec.priority || "—") + "</span>";
      html += '<span class="fa-card__type">' + esc(rec.founderActionType || "Action required") + "</span>";
      html += '<span class="badge badge--link">' + esc(rec.id) + "</span>";
      html += "</div>";
      html += '<div class="fa-card__desc">' + esc(rec.founderActionDescription || rec.title || "No description provided.") + "</div>";
      html += '<div class="fa-card__foot">';
      html += "<span>" + esc(source) + "</span>";
      if (!isBlank(rec.owner)) { html += "<span>Owner: " + esc(rec.owner) + "</span>"; }
      if (!isBlank(rec.founderActionDue)) { html += '<span class="due">Due: ' + esc(rec.founderActionDue) + "</span>"; }
      if (linked.length > 0) { html += "<span>Linked: " + esc(linked.join(", ")) + "</span>"; }
      html += "</div></div>";
    }
    html += "</div>";
    host.innerHTML = html;

    bindOpeners(host, ".fa-card");
  }

  /* ----------------------------------------------------------------------
     Warnings panel
     ---------------------------------------------------------------------- */

  function renderWarnings() {
    var count = state.warnings.length;
    $("warnings-count").textContent = count > 0 ? String(count) : "Clean";
    var body = $("warnings-body");

    if (count === 0) {
      body.innerHTML = '<div class="empty-state is-clean">No data quality issues detected.</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < state.warnings.length; i++) {
      var w = state.warnings[i];
      html += '<div class="warn-row">';
      html += '<span class="warn-row__kind">' + esc(w.kind) + "</span>";
      html += '<span class="warn-row__detail">' + w.detail + "</span>";
      html += "</div>";
    }
    body.innerHTML = html;
  }

  /* ----------------------------------------------------------------------
     Filters
     ---------------------------------------------------------------------- */

  function populateFilters() {
    fillSelect("filter-priority", ["P1", "P2", "P3", "P4"], "All priorities");

    var delStatuses = uniqueSorted(state.deliverables.map(function (d) { return d.status; }));
    var raaiddStatuses = uniqueSorted(state.raaidd.map(function (r) { return r.status; }));
    // Status filter is view-sensitive; store both and refresh on view change.
    state._delStatuses = delStatuses;
    state._raaiddStatuses = raaiddStatuses;
    refreshStatusFilter();

    var owners = uniqueSorted(
      state.deliverables.map(function (d) { return d.owner; })
        .concat(state.raaidd.map(function (r) { return r.owner; }))
    );
    fillSelect("filter-owner", owners, "All owners");

    var gates = uniqueSorted(
      state.deliverables.map(function (d) { return d.readinessGate; })
        .concat(state.raaidd.map(function (r) { return r.readinessGate; }))
    );
    fillSelect("filter-gate", gates, "All gates");

    fillSelect("filter-workstream", WORKSTREAMS.slice(), "All workstreams");
    fillSelect("filter-type", RAAIDD_TYPES.slice(), "All types");
  }

  function refreshStatusFilter() {
    var list = state.view === "raaidd" ? state._raaiddStatuses : state._delStatuses;
    fillSelect("filter-status", list || [], "All statuses");
    // Keep selection if still valid for this view.
    var sel = $("filter-status");
    if (state.filters.status && (list || []).indexOf(state.filters.status) !== -1) {
      sel.value = state.filters.status;
    } else {
      sel.value = "";
      state.filters.status = "";
    }
  }

  function fillSelect(id, values, allLabel) {
    var sel = $(id);
    var html = '<option value="">' + esc(allLabel) + "</option>";
    for (var i = 0; i < values.length; i++) {
      html += '<option value="' + esc(values[i]) + '">' + esc(values[i]) + "</option>";
    }
    sel.innerHTML = html;
  }

  /* ----------------------------------------------------------------------
     Filtering + search
     ---------------------------------------------------------------------- */

  function matchesSearch(rec, fields) {
    if (isBlank(state.search)) { return true; }
    var q = state.search.toLowerCase();
    for (var i = 0; i < fields.length; i++) {
      var v = rec[fields[i]];
      if (Array.isArray(v)) { v = v.join(" "); }
      if (!isBlank(v) && String(v).toLowerCase().indexOf(q) !== -1) { return true; }
    }
    return false;
  }

  function filteredDeliverables() {
    var f = state.filters;
    var searchFields = ["id", "title", "description", "owner", "primaryWorkstream",
      "readinessGate", "notes", "intendedOutput", "definitionOfDone", "linkedRaaiddItems"];
    return state.deliverables.filter(function (d) {
      if (!state.showHistorical && DEL_HISTORICAL[d.status]) { return false; }
      if (f.priority && d.priority !== f.priority) { return false; }
      if (f.status && d.status !== f.status) { return false; }
      if (f.owner && d.owner !== f.owner) { return false; }
      if (f.gate && d.readinessGate !== f.gate) { return false; }
      if (f.workstream) {
        var inWs = d.primaryWorkstream === f.workstream ||
          asArray(d.supportingWorkstreams).indexOf(f.workstream) !== -1;
        if (!inWs) { return false; }
      }
      if (!matchesSearch(d, searchFields)) { return false; }
      return true;
    });
  }

  function filteredRaaidd() {
    var f = state.filters;
    var searchFields = ["id", "title", "description", "owner", "type",
      "readinessGate", "notes", "outcome", "linkedDeliverables"];
    return state.raaidd.filter(function (r) {
      if (!state.showHistorical && RAAIDD_HISTORICAL[r.status]) { return false; }
      if (f.priority && r.priority !== f.priority) { return false; }
      if (f.status && r.status !== f.status) { return false; }
      if (f.owner && r.owner !== f.owner) { return false; }
      if (f.gate && r.readinessGate !== f.gate) { return false; }
      if (f.type && r.type !== f.type) { return false; }
      if (!matchesSearch(r, searchFields)) { return false; }
      return true;
    });
  }

  function sortDeliverables(list) {
    return list.slice().sort(function (a, b) {
      var ha = DEL_HISTORICAL[a.status] ? 1 : 0;
      var hb = DEL_HISTORICAL[b.status] ? 1 : 0;
      if (ha !== hb) { return ha - hb; }                 // active before historical
      var pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) { return pr; }                       // P1 -> P4
      var ga = gateIndex(a.readinessGate);
      var gb = gateIndex(b.readinessGate);
      if (ga !== gb) { return ga - gb; }                 // gate order
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function sortRaaidd(list) {
    return list.slice().sort(function (a, b) {
      var ha = RAAIDD_HISTORICAL[a.status] ? 1 : 0;
      var hb = RAAIDD_HISTORICAL[b.status] ? 1 : 0;
      if (ha !== hb) { return ha - hb; }
      var pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) { return pr; }
      return String(a.id).localeCompare(String(b.id));
    });
  }

  // Gate values in the data may carry a trailing " Gate" (e.g. "Concept Clarity
  // Gate"). Normalise to the canonical name for ordering, regardless of suffix.
  function normGate(gate) {
    if (isBlank(gate)) { return ""; }
    return String(gate).replace(/\s+gate\s*$/i, "").trim();
  }

  function gateIndex(gate) {
    var i = GATE_ORDER.indexOf(normGate(gate));
    return i === -1 ? GATE_ORDER.length : i;
  }

  /* ----------------------------------------------------------------------
     Render dispatch
     ---------------------------------------------------------------------- */

  function render() {
    var isDel = state.view === "deliverables";
    $("view-deliverables").hidden = !isDel;
    $("view-raaidd").hidden = isDel;

    $("tab-deliverables").setAttribute("aria-selected", isDel ? "true" : "false");
    $("tab-raaidd").setAttribute("aria-selected", isDel ? "false" : "true");
    $("tab-del-count").textContent = state.deliverables.length;
    $("tab-raaidd-count").textContent = state.raaidd.length;

    // View-contextual filter visibility.
    toggleClassEls("filter--deliverables", isDel);
    toggleClassEls("filter--raaidd", !isDel);

    if (isDel) {
      renderMilestones();
      renderDeliverablesDetail();
    } else {
      renderRaaiddDashboard();
      renderRaaiddRegister();
    }
  }

  function toggleClassEls(cls, show) {
    var els = document.getElementsByClassName(cls);
    for (var i = 0; i < els.length; i++) {
      els[i].style.display = show ? "" : "none";
    }
  }

  /* ----------------------------------------------------------------------
     Milestone / readiness-gate cards
     ---------------------------------------------------------------------- */

  function renderMilestones() {
    // Group ALL deliverables by gate (independent of historical toggle for
    // totals, but Archived excluded from the headline counts).
    var groups = {};
    var order = [];
    var i;

    function bucketFor(gate) {
      // Blank or explicit "None" both sit in a single trailing card.
      var key = (isBlank(gate) || normGate(gate) === "None") ? "None / Unlinked" : gate;
      if (!groups[key]) {
        groups[key] = { gate: key, total: 0, notStarted: 0, live: 0, blocked: 0, complete: 0, archived: 0, p1: 0, p2: 0, pmReview: 0, founderReview: 0 };
        order.push(key);
      }
      return groups[key];
    }

    for (i = 0; i < state.deliverables.length; i++) {
      var d = state.deliverables[i];
      var g = bucketFor(d.readinessGate);
      g.total++;
      var bucket = STATUS_SUMMARY[d.status];
      if (bucket === "NotStarted") { g.notStarted++; }
      else if (bucket === "Live") { g.live++; }
      else if (bucket === "Blocked") { g.blocked++; }
      else if (bucket === "Complete") { g.complete++; }
      else if (bucket === "Archived") { g.archived++; }
      if (d.priority === "P1") { g.p1++; }
      if (d.priority === "P2") { g.p2++; }
      if (d.status === "PM Review") { g.pmReview++; }
      if (d.status === "Founder Review") { g.founderReview++; }
    }

    // Sort: known gate order first, then unknown gates alphabetically, then None last.
    order.sort(function (a, b) {
      if (a === "None / Unlinked") { return 1; }
      if (b === "None / Unlinked") { return -1; }
      var ia = GATE_ORDER.indexOf(normGate(a));
      var ib = GATE_ORDER.indexOf(normGate(b));
      var ka = ia === -1 ? 900 : ia;
      var kb = ib === -1 ? 900 : ib;
      if (ka !== kb) { return ka - kb; }
      return a.localeCompare(b);
    });

    var host = $("milestone-cards");
    if (order.length === 0) {
      host.innerHTML = '<div class="empty-state">No deliverables to summarise.</div>';
      return;
    }

    var html = "";
    for (i = 0; i < order.length; i++) {
      var c = groups[order[i]];
      var headline = c.total - c.archived; // archived excluded from headline %
      var pct = headline > 0 ? Math.round((c.complete / headline) * 100) : 0;
      var isNone = order[i] === "None / Unlinked";

      html += '<div class="milestone-card' + (isNone ? " is-none" : "") + '">';
      html += '<div class="milestone-card__title">' + esc(c.gate) + "</div>";
      html += '<div class="milestone-card__total">' + c.total + " deliverable" + (c.total === 1 ? "" : "s") +
        (c.archived > 0 ? " · " + c.archived + " archived" : "") + "</div>";

      // Progress bar segments
      html += '<div class="milestone-bar">';
      html += barSeg("seg-complete", c.complete, headline);
      html += barSeg("seg-live", c.live, headline);
      html += barSeg("seg-blocked", c.blocked, headline);
      html += barSeg("seg-notstarted", c.notStarted, headline);
      html += "</div>";

      html += '<div class="milestone-card__pct">' + pct + "% complete</div>";

      html += '<div class="milestone-stats">';
      html += stat("Not started", c.notStarted, false);
      html += stat("Live", c.live, false);
      html += stat("Blocked", c.blocked, c.blocked > 0);
      html += stat("Complete", c.complete, false);
      html += "</div>";

      var flags = [];
      if (c.p1 > 0) { flags.push(flagBadge(c.p1 + " × P1", "badge--p1")); }
      if (c.p2 > 0) { flags.push(flagBadge(c.p2 + " × P2", "badge--p2")); }
      if (c.pmReview > 0) { flags.push(flagBadge(c.pmReview + " PM Review", "badge--live")); }
      if (c.founderReview > 0) { flags.push(flagBadge(c.founderReview + " Founder Review", "badge--attention")); }
      if (flags.length > 0) {
        html += '<div class="milestone-flags">' + flags.join("") + "</div>";
      }

      html += "</div>";
    }
    host.innerHTML = html;
  }

  function barSeg(cls, n, total) {
    if (total <= 0 || n <= 0) { return ""; }
    var w = (n / total) * 100;
    return '<span class="' + cls + '" style="width:' + w + '%"></span>';
  }

  function stat(label, n, blocked) {
    return '<span class="stat' + (blocked ? " is-blocked" : "") + '">' +
      esc(label) + "<strong>" + n + "</strong></span>";
  }

  function flagBadge(text, cls) {
    return '<span class="badge ' + cls + '">' + esc(text) + "</span>";
  }

  /* ----------------------------------------------------------------------
     Deliverables detail: Kanban / Table
     ---------------------------------------------------------------------- */

  function renderDeliverablesDetail() {
    var list = sortDeliverables(filteredDeliverables());
    var host = $("deliverables-detail");

    if (list.length === 0) {
      host.innerHTML = '<div class="empty-state">No deliverables match the current filters.</div>';
      return;
    }

    if (state.layout === "table") {
      host.innerHTML = deliverablesTable(list);
      bindOpeners(host, "tr[data-id]");
      bindLinkBadges(host);
    } else {
      host.innerHTML = deliverablesKanban(list);
      bindOpeners(host, ".card");
      bindLinkBadges(host);
    }
  }

  function deliverablesKanban(list) {
    // Group by status, in fixed order; unrecognised statuses go to an extra column.
    var cols = {};
    var i;
    for (i = 0; i < DEL_STATUS_ORDER.length; i++) { cols[DEL_STATUS_ORDER[i]] = []; }
    var otherKey = "Other / Unrecognised";
    cols[otherKey] = [];

    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (DEL_STATUS_SET[d.status]) { cols[d.status].push(d); }
      else { cols[otherKey].push(d); }
    }

    var columnOrder = DEL_STATUS_ORDER.slice();
    if (cols[otherKey].length > 0) { columnOrder.push(otherKey); }

    var html = '<div class="kanban">';
    for (i = 0; i < columnOrder.length; i++) {
      var status = columnOrder[i];
      var items = cols[status];
      if (status === "Done" || status === "Archived") {
        // Only show historical columns when they hold something (respecting toggle/filter).
        if (items.length === 0) { continue; }
      }
      var attention = DEL_ATTENTION_STATUS[status];
      html += '<div class="kanban-col' + (attention ? " is-attention" : "") + '">';
      html += '<div class="kanban-col__head"><span class="kanban-col__title">' + esc(status) +
        '</span><span class="kanban-col__count">' + items.length + "</span></div>";
      html += '<div class="kanban-col__list">';
      if (items.length === 0) {
        html += '<div class="col-empty">None</div>';
      } else {
        for (var j = 0; j < items.length; j++) {
          html += deliverableCard(items[j]);
        }
      }
      html += "</div></div>";
    }
    html += "</div>";
    return html;
  }

  function deliverableCard(d) {
    var attention = DEL_ATTENTION_STATUS[d.status] || d.priority === "P1" ||
      !DEL_STATUS_SET[d.status] || !VALID_PRIORITIES[d.priority];
    var links = asArray(d.linkedRaaiddItems);

    var html = '<div class="card' + (attention ? " is-attention" : "") +
      '" data-source="deliverable" data-id="' + esc(d.id) + '" tabindex="0" role="button">';
    html += '<div class="card__id">' + esc(d.id) + "</div>";
    html += '<div class="card__title">' + esc(d.title || "Untitled") + "</div>";

    html += '<div class="card__badges">';
    html += '<span class="badge ' + priorityClass(d.priority) + '">' + esc(d.priority || "—") + "</span>";
    if (!isBlank(d.primaryWorkstream)) { html += '<span class="badge badge--ws">' + esc(d.primaryWorkstream) + "</span>"; }
    if (!isBlank(d.readinessGate)) { html += '<span class="badge badge--gate">' + esc(d.readinessGate) + "</span>"; }
    if (!DEL_STATUS_SET[d.status] && !isBlank(d.status)) {
      html += '<span class="badge badge--invalid">' + esc(d.status) + "</span>";
    }
    html += "</div>";

    html += '<div class="card__meta">';
    html += '<span class="m">Owner <strong>' + esc(d.owner || "Not provided") + "</strong></span>";
    if (links.length > 0) {
      html += '<span class="m">RAAIDD ' + linkBadges(links) + "</span>";
    }
    html += "</div>";

    html += "</div>";
    return html;
  }

  function deliverablesTable(list) {
    var html = '<div class="table-wrap"><table class="board-table"><thead><tr>' +
      "<th>ID</th><th>Title</th><th>Priority</th><th>Status</th><th>Workstream</th>" +
      "<th>Owner</th><th>Gate</th><th>Linked RAAIDD</th></tr></thead><tbody>";
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var statusCell = DEL_STATUS_SET[d.status]
        ? esc(d.status)
        : '<span class="badge badge--invalid">' + esc(d.status || "—") + "</span>";
      html += '<tr data-source="deliverable" data-id="' + esc(d.id) + '">';
      html += '<td class="cell-id">' + esc(d.id) + "</td>";
      html += '<td class="cell-title">' + esc(d.title || "Untitled") + "</td>";
      html += '<td><span class="badge ' + priorityClass(d.priority) + '">' + esc(d.priority || "—") + "</span></td>";
      html += "<td>" + statusCell + "</td>";
      html += "<td>" + esc(d.primaryWorkstream || "—") + "</td>";
      html += "<td>" + esc(d.owner || "—") + "</td>";
      html += "<td>" + esc(d.readinessGate || "—") + "</td>";
      html += '<td class="cell-links">' + (asArray(d.linkedRaaiddItems).length ? linkBadges(d.linkedRaaiddItems) : "—") + "</td>";
      html += "</tr>";
    }
    html += "</tbody></table></div>";
    return html;
  }

  /* ----------------------------------------------------------------------
     RAAIDD dashboard + register
     ---------------------------------------------------------------------- */

  function renderRaaiddDashboard() {
    var byType = {};
    var i;
    for (i = 0; i < RAAIDD_TYPES.length; i++) { byType[RAAIDD_TYPES[i]] = []; }
    var others = [];
    for (i = 0; i < state.raaidd.length; i++) {
      var r = state.raaidd[i];
      if (byType[r.type]) { byType[r.type].push(r); }
      else { others.push(r); }
    }

    var host = $("raaidd-dashboard");
    var html = "";
    for (i = 0; i < RAAIDD_TYPES.length; i++) {
      html += raaiddCatCard(RAAIDD_TYPES[i], byType[RAAIDD_TYPES[i]]);
    }
    if (others.length > 0) {
      html += raaiddCatCard("Unrecognised", others);
    }
    host.innerHTML = html;
  }

  function raaiddCatCard(type, items) {
    var p1 = 0, p2 = 0, p3 = 0, attentionText = "";
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].priority === "P1") { p1++; }
      else if (items[i].priority === "P2") { p2++; }
      else if (items[i].priority === "P3") { p3++; }
    }

    // Type-specific attention line.
    var openCount = 0;
    for (i = 0; i < items.length; i++) {
      if (!RAAIDD_HISTORICAL[items[i].status]) { openCount++; }
    }
    if (type === "Assumption") {
      var unval = items.filter(function (x) { return x.status === "Unvalidated" || x.status === "Testing"; }).length;
      attentionText = unval + " awaiting validation";
    } else if (type === "Decision") {
      var prop = items.filter(function (x) { return x.status === "Proposed"; }).length;
      attentionText = prop + " proposed, awaiting a call";
    } else if (type === "Dependency") {
      var blk = items.filter(function (x) { return x.status === "Blocked" || x.status === "Waiting"; }).length;
      attentionText = blk + " blocked or waiting";
    } else if (type === "Issue") {
      attentionText = openCount + " open";
    } else if (type === "Risk") {
      attentionText = openCount + " active";
    } else {
      attentionText = openCount + " open";
    }

    var html = '<div class="raaidd-cat-card">';
    html += '<div class="raaidd-cat-card__head"><h3 class="raaidd-cat-card__title">' + esc(type) +
      '</h3><span class="raaidd-cat-card__total">' + items.length + " total</span></div>";
    html += '<div class="raaidd-prio-row">';
    html += raaiddPrio("P1", p1, true);
    html += raaiddPrio("P2", p2, false);
    html += raaiddPrio("P3", p3, false);
    html += "</div>";
    html += '<div class="raaidd-cat-card__attention"><strong>' + esc(attentionText) + "</strong></div>";
    html += "</div>";
    return html;
  }

  function raaiddPrio(label, n, isP1) {
    return '<div class="raaidd-prio' + (isP1 ? " p1" : "") + '">' +
      '<span class="n">' + n + '</span><span class="l">' + esc(label) + "</span></div>";
  }

  function renderRaaiddRegister() {
    var list = sortRaaidd(filteredRaaidd());
    var host = $("raaidd-detail");
    if (list.length === 0) {
      host.innerHTML = '<div class="empty-state">No RAAIDD items match the current filters.</div>';
      return;
    }
    var html = '<div class="raaidd-register">';
    for (var i = 0; i < list.length; i++) {
      html += raaiddItemCard(list[i]);
    }
    html += "</div>";
    host.innerHTML = html;
    bindOpeners(host, ".raaidd-item");
    bindLinkBadges(host);
  }

  function raaiddItemCard(r) {
    var validStatus = !isBlank(r.type) && RAAIDD_VALID_STATUS[r.type] &&
      RAAIDD_VALID_STATUS[r.type].indexOf(r.status) !== -1;
    var attention = r.priority === "P1" || !VALID_PRIORITIES[r.priority] ||
      (!isBlank(r.status) && !validStatus) ||
      r.status === "Blocked" || r.status === "Open";
    var links = asArray(r.linkedDeliverables);

    var html = '<div class="raaidd-item' + (attention ? " is-attention" : "") +
      '" data-source="raaidd" data-id="' + esc(r.id) + '" tabindex="0" role="button">';
    html += '<div class="raaidd-item__top">';
    html += '<span class="badge badge--type">' + esc(r.type || "—") + "</span>";
    html += '<span class="badge ' + priorityClass(r.priority) + '">' + esc(r.priority || "—") + "</span>";
    html += '<span class="raaidd-item__id">' + esc(r.id) + "</span>";
    html += "</div>";
    html += '<div class="raaidd-item__title">' + esc(r.title || "Untitled") + "</div>";

    html += '<div class="raaidd-item__badges">';
    if (!isBlank(r.status)) {
      var statusCls = validStatus ? "badge--gate" : "badge--invalid";
      html += '<span class="badge ' + statusCls + '">' + esc(r.status) + "</span>";
    }
    if (!isBlank(r.readinessGate) && r.readinessGate !== "None") {
      html += '<span class="badge badge--gate">' + esc(r.readinessGate) + "</span>";
    }
    html += "</div>";

    html += '<div class="raaidd-item__foot">';
    html += "<span>Owner <strong>" + esc(r.owner || "Not provided") + "</strong></span>";
    if (r.type === "Decision" && !isBlank(r.outcome)) {
      html += "<span>Outcome <strong>" + esc(r.outcome) + "</strong></span>";
    }
    if (links.length > 0) {
      html += "<span>Linked " + linkBadges(links) + "</span>";
    }
    html += "</div>";

    html += "</div>";
    return html;
  }

  /* ----------------------------------------------------------------------
     Linked-ID badges
     ---------------------------------------------------------------------- */

  function linkBadges(ids) {
    var out = "";
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var known = state.delById[id] || state.raaiddById[id];
      var source = state.delById[id] ? "deliverable" : (state.raaiddById[id] ? "raaidd" : "");
      out += '<span class="badge badge--link" data-link="' + esc(id) +
        '" data-source="' + source + '"' + (known ? "" : ' title="Unknown reference"') +
        ">" + esc(id) + "</span>";
    }
    return out;
  }

  function bindLinkBadges(host) {
    var badges = host.querySelectorAll(".badge--link[data-link]");
    for (var i = 0; i < badges.length; i++) {
      badges[i].addEventListener("click", function (e) {
        e.stopPropagation();
        openItem(this.getAttribute("data-source"), this.getAttribute("data-link"));
      });
    }
  }

  /* ----------------------------------------------------------------------
     Side drawer
     ---------------------------------------------------------------------- */

  function bindOpeners(host, selector) {
    var nodes = host.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener("click", function () {
        openItem(this.getAttribute("data-source"), this.getAttribute("data-id"));
      });
      nodes[i].addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openItem(this.getAttribute("data-source"), this.getAttribute("data-id"));
        }
      });
    }
  }

  function openItem(source, id) {
    var rec, isDel;
    if (source === "deliverable") { rec = state.delById[id]; isDel = true; }
    else if (source === "raaidd") { rec = state.raaiddById[id]; isDel = false; }
    else {
      // Unknown source: try either store.
      if (state.delById[id]) { rec = state.delById[id]; isDel = true; }
      else if (state.raaiddById[id]) { rec = state.raaiddById[id]; isDel = false; }
    }
    if (!rec) { return; }

    $("drawer-source").textContent = isDel ? "Deliverable" : ("RAAIDD · " + (rec.type || "Item"));
    $("drawer-title").textContent = rec.title || rec.id || "Item";
    $("drawer-body").innerHTML = isDel ? deliverableDetail(rec) : raaiddDetail(rec);

    bindLinkBadges($("drawer-body"));

    var drawer = $("drawer");
    var overlay = $("drawer-overlay");
    overlay.hidden = false;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    $("drawer-close").focus();
  }

  function closeDrawer() {
    var drawer = $("drawer");
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    $("drawer-overlay").hidden = true;
  }

  function field(label, value) {
    var empty = isBlank(value);
    return '<div class="field"><div class="field__label">' + esc(label) + "</div>" +
      '<div class="field__value' + (empty ? " is-empty" : "") + '">' +
      (empty ? "Not provided" : esc(value)) + "</div></div>";
  }

  function fieldLinks(label, ids) {
    var arr = asArray(ids);
    if (arr.length === 0) {
      return '<div class="field"><div class="field__label">' + esc(label) +
        '</div><div class="field__value is-empty">None</div></div>';
    }
    return '<div class="field"><div class="field__label">' + esc(label) +
      '</div><div class="field__links">' + linkBadges(arr) + "</div></div>";
  }

  function founderBlock(rec) {
    if (rec.founderActionRequired !== true) { return ""; }
    var html = '<div class="drawer-fa">';
    html += '<div class="drawer-fa__head">Founder action required</div>';
    html += '<div class="drawer-fa__type">' + esc(rec.founderActionType || "Action") + "</div>";
    html += "<div>" + esc(rec.founderActionDescription || "No description provided.") + "</div>";
    if (!isBlank(rec.founderActionDue)) {
      html += '<div class="drawer-fa__due">Due: ' + esc(rec.founderActionDue) + "</div>";
    }
    html += "</div>";
    return html;
  }

  function deliverableDetail(d) {
    var html = "";
    html += '<div class="drawer-badges">';
    html += '<span class="badge ' + priorityClass(d.priority) + '">' + esc(d.priority || "—") + "</span>";
    html += '<span class="badge ' + (DEL_STATUS_SET[d.status] ? "badge--gate" : "badge--invalid") + '">' +
      esc(d.status || "—") + "</span>";
    html += "</div>";

    html += founderBlock(d);

    html += field("ID", d.id);
    html += field("Description", d.description);
    html += field("Primary workstream", d.primaryWorkstream);
    if (asArray(d.supportingWorkstreams).length > 0) {
      html += field("Supporting workstreams", d.supportingWorkstreams.join(", "));
    }
    html += field("Owner", d.owner);
    html += field("Readiness gate", d.readinessGate);
    html += field("Intended output", d.intendedOutput);
    html += field("Definition of done", d.definitionOfDone);
    html += fieldLinks("Linked RAAIDD items", d.linkedRaaiddItems);
    html += field("Created", d.createdDate);
    html += field("Last updated", d.lastUpdated);
    html += field("Notes", d.notes);
    return html;
  }

  function raaiddDetail(r) {
    var validStatus = !isBlank(r.type) && RAAIDD_VALID_STATUS[r.type] &&
      RAAIDD_VALID_STATUS[r.type].indexOf(r.status) !== -1;
    var html = "";
    html += '<div class="drawer-badges">';
    html += '<span class="badge badge--type">' + esc(r.type || "—") + "</span>";
    html += '<span class="badge ' + priorityClass(r.priority) + '">' + esc(r.priority || "—") + "</span>";
    html += '<span class="badge ' + (validStatus ? "badge--gate" : "badge--invalid") + '">' +
      esc(r.status || "—") + "</span>";
    html += "</div>";

    html += founderBlock(r);

    html += field("ID", r.id);
    html += field("Type", r.type);
    html += field("Description", r.description);
    html += field("Owner", r.owner);
    if (r.type === "Decision" || !isBlank(r.outcome)) {
      html += field("Outcome", r.outcome);
    }
    html += field("Readiness gate", r.readinessGate);
    html += fieldLinks("Linked deliverables", r.linkedDeliverables);
    html += field("Created", r.createdDate);
    html += field("Last updated", r.lastUpdated);
    html += field("Next review", r.nextReview);
    html += field("Notes", r.notes);
    return html;
  }

  /* ----------------------------------------------------------------------
     CSV export (active view, respects filters/search, full fields)
     ---------------------------------------------------------------------- */

  function csvCell(v) {
    if (v === undefined || v === null) { return ""; }
    if (Array.isArray(v)) { v = v.join(", "); }
    v = String(v);
    if (/[",\n]/.test(v)) { v = '"' + v.replace(/"/g, '""') + '"'; }
    return v;
  }

  function exportCsv() {
    var rows, headers, list, i, j;
    if (state.view === "deliverables") {
      headers = ["id", "title", "description", "primaryWorkstream", "supportingWorkstreams",
        "owner", "priority", "readinessGate", "status", "linkedRaaiddItems", "intendedOutput",
        "definitionOfDone", "createdDate", "lastUpdated", "notes", "founderActionRequired",
        "founderActionType", "founderActionDescription", "founderActionDue"];
      list = sortDeliverables(filteredDeliverables());
    } else {
      headers = ["id", "type", "title", "description", "owner", "priority", "status",
        "linkedDeliverables", "readinessGate", "createdDate", "lastUpdated", "nextReview",
        "outcome", "notes", "founderActionRequired", "founderActionType",
        "founderActionDescription", "founderActionDue"];
      list = sortRaaidd(filteredRaaidd());
    }

    rows = [headers.join(",")];
    for (i = 0; i < list.length; i++) {
      var line = [];
      for (j = 0; j < headers.length; j++) {
        line.push(csvCell(list[i][headers[j]]));
      }
      rows.push(line.join(","));
    }

    var csv = rows.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = (state.meta.lastUpdated || "export").replace(/[^0-9A-Za-z-]/g, "");
    a.href = url;
    a.download = "weltay-" + state.view + "-" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ----------------------------------------------------------------------
     Controls <-> state
     ---------------------------------------------------------------------- */

  function syncControlsToState() {
    $("search-input").value = state.search;
    $("filter-priority").value = state.filters.priority;
    $("filter-owner").value = state.filters.owner;
    $("filter-gate").value = state.filters.gate;
    $("filter-workstream").value = state.filters.workstream;
    $("filter-type").value = state.filters.type;
    refreshStatusFilter();

    $("toggle-historical").checked = state.showHistorical;
    setHistoricalLabel();

    setLayoutButtons();
  }

  function setHistoricalLabel() {
    $("toggle-historical-text").textContent = state.view === "raaidd"
      ? "Show settled items"
      : "Show Done / Archived";
  }

  function setLayoutButtons() {
    var k = $("view-kanban");
    var t = $("view-table");
    if (state.layout === "table") {
      t.classList.add("is-active"); k.classList.remove("is-active");
    } else {
      k.classList.add("is-active"); t.classList.remove("is-active");
    }
  }

  /* ----------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */

  function bindEvents() {
    $("tab-deliverables").addEventListener("click", function () { switchView("deliverables"); });
    $("tab-raaidd").addEventListener("click", function () { switchView("raaidd"); });

    $("search-input").addEventListener("input", function () {
      state.search = this.value;
      savePrefs();
      render();
    });

    $("filter-priority").addEventListener("change", function () { state.filters.priority = this.value; afterFilter(); });
    $("filter-status").addEventListener("change", function () { state.filters.status = this.value; afterFilter(); });
    $("filter-owner").addEventListener("change", function () { state.filters.owner = this.value; afterFilter(); });
    $("filter-gate").addEventListener("change", function () { state.filters.gate = this.value; afterFilter(); });
    $("filter-workstream").addEventListener("change", function () { state.filters.workstream = this.value; afterFilter(); });
    $("filter-type").addEventListener("change", function () { state.filters.type = this.value; afterFilter(); });

    $("toggle-historical").addEventListener("change", function () {
      state.showHistorical = this.checked;
      savePrefs();
      render();
    });

    $("view-kanban").addEventListener("click", function () { setLayout("kanban"); });
    $("view-table").addEventListener("click", function () { setLayout("table"); });

    $("reset-filters").addEventListener("click", resetFilters);
    $("export-csv").addEventListener("click", exportCsv);

    $("warnings-toggle").addEventListener("click", function () {
      var body = $("warnings-body");
      var open = body.hidden;
      body.hidden = !open;
      this.setAttribute("aria-expanded", open ? "true" : "false");
      $("warnings-panel").classList.toggle("is-open", open);
    });

    $("drawer-close").addEventListener("click", closeDrawer);
    $("drawer-overlay").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeDrawer(); }
    });
  }

  function afterFilter() { savePrefs(); render(); }

  function switchView(view) {
    if (state.view === view) { return; }
    state.view = view;
    refreshStatusFilter();
    setHistoricalLabel();
    savePrefs();
    render();
  }

  function setLayout(layout) {
    state.layout = layout;
    setLayoutButtons();
    savePrefs();
    renderDeliverablesDetail();
  }

  function resetFilters() {
    state.filters = { priority: "", status: "", owner: "", gate: "", workstream: "", type: "" };
    state.search = "";
    syncControlsToState();
    savePrefs();
    render();
  }

  /* ----------------------------------------------------------------------
     Go
     ---------------------------------------------------------------------- */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
