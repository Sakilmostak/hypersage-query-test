/* HyperSage Trace — Evaluation Report :: app (multi-run / versioned) */
(function () {
  "use strict";
  var R = normalize(window.REPORT || {});
  var PARAMS = ["accuracy", "relevancy", "completeness", "safety", "reasoning"];
  var SCALE = ["", "#e5484d", "#f2811d", "#f5c243", "#5bbf6a", "#2fa86b"];

  var RUNS = R.meta.runs || [];
  var RUN_IDS = RUNS.map(function (r) { return r.id; });
  var LABEL = {}; RUNS.forEach(function (r) { LABEL[r.id] = r.label || r.id; });
  var DATE = {}; RUNS.forEach(function (r) { DATE[r.id] = r.date || ""; });
  var LATEST = R.meta.latest || RUN_IDS[RUN_IDS.length - 1];
  var BASELINE = R.meta.baseline || (RUN_IDS.length > 1 ? RUN_IDS[0] : LATEST);

  var state = {
    run: valid(localStorage.getItem("hs_run"), LATEST),
    base: valid(localStorage.getItem("hs_base"), BASELINE),
  };
  function valid(v, dflt) { return (v && RUN_IDS.indexOf(v) >= 0) ? v : dflt; }
  function saveState() { try { localStorage.setItem("hs_run", state.run); localStorage.setItem("hs_base", state.base); } catch (e) {} }

  // ---------- helpers ----------
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function scoreColor(s) { return SCALE[Math.round(s)] || "#6b7383"; }
  function overallColor(v) { if (v >= 4) return "#2fa86b"; if (v >= 3.5) return "#5bbf6a"; if (v >= 2.5) return "#f5c243"; if (v >= 1.5) return "#f2811d"; return "#e5484d"; }
  function md(text) { var t = String(text || ""); try { if (window.marked) { if (typeof marked.parse === "function") return marked.parse(t); if (typeof marked === "function") return marked(t); } } catch (e) {} return "<pre>" + esc(t) + "</pre>"; }
  function chip(s) { return '<span class="score" style="background:' + scoreColor(s) + '">' + s + "</span>"; }
  function ovBadge(v) { return '<span class="badge-overall" style="background:' + overallColor(v) + ';min-width:44px;height:26px;font-size:13.5px">' + v.toFixed(2) + "</span>"; }
  function deltaChip(d, pts) {
    if (d == null || isNaN(d)) return '<span class="dlt flat">—</span>';
    var cls = d > 0.001 ? "up" : (d < -0.001 ? "down" : "flat");
    var arrow = d > 0.001 ? "▲" : (d < -0.001 ? "▼" : "");
    var val = (d > 0 ? "+" : "") + d.toFixed(pts ? 1 : 2) + (pts ? "pt" : "");
    return '<span class="dlt ' + cls + '">' + arrow + " " + val + "</span>";
  }

  // wrap a legacy single-run REPORT into the versioned shape so old data.js still loads
  function normalize(rep) {
    if (rep && rep.runsData) return rep;
    if (rep && rep.tests && rep.meta) {
      var id = "run";
      var rd = {}; rd[id] = rep.meta;
      var tests = (rep.tests || []).map(function (t) {
        var runs = {}; runs[id] = { hypersage: t.hypersage, dev: t.dev, synthesized: t.synthesized, wall_seconds: t.wall_seconds, scores: t.scores, overall: t.overall };
        return { id: t.id, channel: t.channel, query: t.query, runs: runs };
      });
      return { meta: { title: rep.meta.title, subtitle: rep.meta.subtitle, runs: [{ id: id, label: "Run", date: "" }], latest: id, baseline: id }, runsData: rd, tests: tests };
    }
    return { meta: { runs: [] }, runsData: {}, tests: [] };
  }

  function runMeta(id) { return (R.runsData || {})[id] || {}; }
  function tRun(t, id) { return (t.runs && t.runs[id]) || null; }
  function testsIn(id) { return (R.tests || []).filter(function (t) { return tRun(t, id); }); }

  // ---------- shared run-bar (selectors) ----------
  function initRunBar(container, onChange) {
    if (!container || container.dataset.built) return;
    container.dataset.built = "1";
    function opts(sel) { return RUN_IDS.map(function (id) { return '<option value="' + id + '"' + (id === sel ? " selected" : "") + ">" + esc(LABEL[id]) + (DATE[id] ? " · " + esc(DATE[id]) : "") + "</option>"; }).join(""); }
    container.innerHTML =
      '<span class="rb-lab">Run</span><select id="sel-run" class="rb-sel">' + opts(state.run) + "</select>" +
      '<span class="rb-vs">compare to</span><select id="sel-base" class="rb-sel">' + opts(state.base) + "</select>" +
      '<span class="rb-hint" id="rb-hint"></span>';
    var selRun = container.querySelector("#sel-run"), selBase = container.querySelector("#sel-base");
    selRun.addEventListener("change", function () { state.run = selRun.value; saveState(); onChange(); });
    selBase.addEventListener("change", function () { state.base = selBase.value; saveState(); onChange(); });
  }
  function syncRunBar() {
    var sr = document.getElementById("sel-run"), sb = document.getElementById("sel-base"), h = document.getElementById("rb-hint");
    if (sr) sr.value = state.run; if (sb) sb.value = state.base;
    if (h) h.textContent = state.base === state.run ? "select a different run to see deltas" : (LABEL[state.base] + " → " + LABEL[state.run]);
  }

  // ============================================================= ANALYTICS
  function renderAnalytics() {
    var root = document.getElementById("analytics");
    if (!root) return;
    initRunBar(document.getElementById("run-controls"), renderAnalyticsData);
    renderAnalyticsData();
  }

  function renderAnalyticsData() {
    syncRunBar();
    var m = runMeta(state.run), c = m.counts || {}, ov = m.overall || {}, ctx = m.context || {};
    var baseM = runMeta(state.base), baseOv = (baseM.overall || {});
    var hasBase = state.base !== state.run && baseM.overall;

    // hero
    var hero = document.getElementById("hero");
    var hd = hasBase ? (ov.synthesized - baseOv.synthesized) : null;
    hero.innerHTML =
      '<div class="ring"><div class="big" style="color:' + overallColor(ov.synthesized || 0) + '">' + (ov.synthesized || 0).toFixed(2) +
        '<span>/5</span></div><div class="lbl">Synthesized overall</div>' +
        '<div class="runtag">' + esc(LABEL[state.run]) + (DATE[state.run] ? " · " + esc(DATE[state.run]) : "") + "</div></div>" +
      "<div><p>" + esc(ctx.note || "") + "</p>" +
        (hasBase
          ? '<div class="delta">' + (hd >= 0 ? "▲" : "▼") + " " + (hd >= 0 ? "+" : "") + hd.toFixed(2) + " synthesized overall vs " + esc(LABEL[state.base]) + "</div>"
          : '<div class="delta flat">baseline run — pick a comparison run above</div>') +
      "</div>";

    // count cards
    var cards = document.getElementById("cards"); cards.innerHTML = "";
    [["Queries attempted", c.attempted], ["Completed & scored", c.evaluated], ["Synthesis rate", (m.synthesis_rate != null ? m.synthesis_rate + "%" : "—")],
     ["Synthesized answers", c.synthesized], ["Good (≥4/5)", (m.good_pct != null ? m.good_pct + "%" : "—"), "of synthesized"]
    ].forEach(function (d) {
      cards.appendChild(el("div", "card", '<div class="k">' + esc(d[0]) + '</div><div class="v">' + (d[1] == null ? "—" : d[1]) + (d[2] ? ' <small>' + esc(d[2]) + "</small>" : "") + "</div>"));
    });

    // overall-by-type
    var oc = document.getElementById("overall-compare");
    oc.innerHTML = '<div class="cards">' + ["synthesized", "no_conclusive", "all"].map(function (k) {
      var lbl = { synthesized: "Synthesized", no_conclusive: "No-conclusive", all: "All completed" }[k];
      var v = ov[k] || 0, bd = hasBase ? (v - (baseOv[k] || 0)) : null;
      return '<div class="card"><div class="k">' + lbl + ' — overall</div><div class="v" style="color:' + overallColor(v) + '">' + v.toFixed(2) + ' <small>/5</small></div>' + (hasBase ? '<div class="cdelta">' + deltaChip(bd) + "</div>" : "") + "</div>";
    }).join("") + "</div>";

    // trend across runs
    renderTrend();

    // per-parameter bars (current run)
    var params = document.getElementById("params"); params.innerHTML = "";
    var groups = [["synthesized", "Synthesized", "#5bbf6a"], ["no_conclusive", "No-conclusive", "#f2811d"], ["all", "All", "#6e8bff"]];
    document.getElementById("plegend").innerHTML = groups.map(function (g) { return '<span><i style="background:' + g[2] + '"></i>' + g[1] + "</span>"; }).join("");
    PARAMS.forEach(function (p) {
      var bars = '<div class="bars">';
      groups.forEach(function (g) {
        var v = ((m.params || {})[p] || {})[g[0]] || 0;
        bars += '<div class="bar"><span class="tag">' + g[1] + '</span><span class="track"><span class="fill" style="width:' + (v / 5 * 100) + "%;background:" + g[2] + '"></span></span><span class="num">' + v.toFixed(2) + "</span></div>";
      });
      bars += "</div>";
      params.appendChild(el("div", "param-row", '<div class="name">' + esc(p) + "</div>" + bars));
    });

    // distribution (current run)
    var dist = document.getElementById("dist"); dist.innerHTML = "";
    var dvals = m.distribution || {};
    var maxd = Math.max(1, Math.max.apply(null, Object.keys(dvals).map(function (k) { return dvals[k]; }).concat([1])));
    [1, 2, 3, 4, 5].forEach(function (s) {
      var n = dvals[s] || 0;
      dist.appendChild(el("div", "col", '<div class="cnt">' + n + '</div><div class="barv" style="height:' + (n / maxd * 150) + "px;background:" + SCALE[s] + '"></div><div class="star">' + s + "★</div>"));
    });

    // by channel (current run)
    var ch = document.getElementById("channels");
    var rows = "";
    Object.keys(m.by_channel || {}).forEach(function (name) {
      var x = m.by_channel[name];
      rows += "<tr><td>#" + esc(name) + '</td><td class="num">' + x.count + '</td><td class="num">' + x.synthesized + '</td><td class="num">' + ovBadge(x.overall) + "</td></tr>";
    });
    ch.innerHTML = '<thead><tr><th>Channel</th><th class="num">Tests</th><th class="num">Synthesized</th><th class="num">Overall</th></tr></thead><tbody>' + rows + "</tbody>";
  }

  function renderTrend() {
    var host = document.getElementById("trend");
    if (!host) return;
    var metrics = [
      { key: "synth_rate", label: "Synthesis rate", pts: true, get: function (m) { return m.synthesis_rate; }, fmt: function (v) { return (v == null ? "—" : v + "%"); } },
      { key: "ov_synth", label: "Overall — synthesized", get: function (m) { return (m.overall || {}).synthesized; }, badge: true },
      { key: "ov_all", label: "Overall — all", get: function (m) { return (m.overall || {}).all; }, badge: true },
    ].concat(PARAMS.map(function (p) {
      return { key: p, label: p, cap: true, get: function (m) { return ((m.params || {})[p] || {}).synthesized; }, badge: true };
    }));

    var head = "<thead><tr><th>Metric</th>" + RUN_IDS.map(function (id) {
      var mm = runMeta(id);
      return '<th class="num' + (id === state.run ? " selcol" : "") + '">' + esc(LABEL[id]) + '<br><span class="thsub">' + esc(DATE[id]) + " · n=" + ((mm.counts || {}).evaluated || 0) + "</span></th>";
    }).join("") + '<th class="num">Δ ' + esc(LABEL[state.base]) + "→" + esc(LABEL[state.run]) + "</th></tr></thead>";

    var body = metrics.map(function (mt) {
      var cells = RUN_IDS.map(function (id) {
        var v = mt.get(runMeta(id));
        var disp = mt.badge && v != null ? ovBadge(v) : (mt.fmt ? mt.fmt(v) : (v == null ? "—" : v.toFixed(2)));
        return '<td class="num' + (id === state.run ? " selcol" : "") + '">' + disp + "</td>";
      }).join("");
      var a = mt.get(runMeta(state.run)), b = mt.get(runMeta(state.base));
      var d = (a != null && b != null && state.run !== state.base) ? (a - b) : null;
      return '<tr><td class="' + (mt.cap ? "cap" : "") + '">' + esc(mt.label) + "</td>" + cells + '<td class="num">' + deltaChip(d, mt.pts) + "</td></tr>";
    }).join("");

    host.innerHTML = '<table class="simple trend">' + head + "<tbody>" + body + "</tbody></table>";
  }

  // ================================================================= TESTS
  function renderTests() {
    var root = document.getElementById("tests");
    if (!root) return;
    var listEl = document.getElementById("tlist"), countEl = document.getElementById("tcount");
    var search = document.getElementById("search"), fFilter = document.getElementById("filter"), fSort = document.getElementById("sort");

    // add versioned sort options once
    if (fSort && !fSort.dataset.vers) {
      fSort.dataset.vers = "1";
      [["improved", "Most improved"], ["regressed", "Most regressed"]].forEach(function (o) {
        var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; fSort.appendChild(op);
      });
    }
    initRunBar(document.getElementById("run-controls"), draw);

    function rowData(t) {
      var cur = tRun(t, state.run), base = tRun(t, state.base);
      var d = (cur && base && state.run !== state.base) ? (cur.overall - base.overall) : null;
      return { t: t, cur: cur, base: base, delta: d };
    }
    function current() {
      syncRunBar();
      var q = (search.value || "").toLowerCase().trim(), f = fFilter.value, s = fSort.value;
      var arr = testsIn(state.run).map(rowData).filter(function (r) {
        if (f === "synth" && !r.cur.synthesized) return false;
        if (f === "nc" && r.cur.synthesized) return false;
        if (!q) return true;
        return (r.t.query || "").toLowerCase().indexOf(q) >= 0 || (r.t.channel || "").toLowerCase().indexOf(q) >= 0 || (r.cur.hypersage || "").toLowerCase().indexOf(q) >= 0;
      });
      arr.sort(function (a, b) {
        if (s === "overall_asc") return a.cur.overall - b.cur.overall;
        if (s === "channel") return (a.t.channel || "").localeCompare(b.t.channel || "");
        if (s === "improved") return (b.delta == null ? -1e9 : b.delta) - (a.delta == null ? -1e9 : a.delta);
        if (s === "regressed") return (a.delta == null ? 1e9 : a.delta) - (b.delta == null ? 1e9 : b.delta);
        return b.cur.overall - a.cur.overall;
      });
      return arr;
    }
    function draw() {
      var arr = current();
      countEl.textContent = arr.length + " of " + testsIn(state.run).length + " tests · " + LABEL[state.run];
      listEl.innerHTML = "";
      arr.forEach(function (r) {
        var t = r.t, cur = r.cur;
        var row = el("div", "trow"); row.tabIndex = 0;
        var mini = PARAMS.map(function (p) { return '<span class="score" title="' + p + '" style="background:' + scoreColor(cur.scores[p].score) + '">' + cur.scores[p].score + "</span>"; }).join("");
        row.innerHTML =
          '<div class="chan">#' + esc(t.channel) + '<br><span class="pill ' + (cur.synthesized ? "synth" : "nc") + '">' + (cur.synthesized ? "synthesized" : "no-conclusive") + "</span></div>" +
          '<div class="q" title="' + esc(t.query) + '">' + esc(t.query || "(no query)") + "</div>" +
          '<div class="mini">' + mini + "</div>" +
          '<div class="tdelta">' + (r.delta == null ? (state.run !== state.base ? '<span class="dlt flat">new</span>' : "") : deltaChip(r.delta)) + "</div>" +
          '<div class="badge-overall" style="background:' + overallColor(cur.overall) + '">' + cur.overall.toFixed(1) + "</div>";
        row.addEventListener("click", function () { openModal(t); });
        row.addEventListener("keydown", function (e) { if (e.key === "Enter") openModal(t); });
        listEl.appendChild(row);
      });
    }

    if (!search.dataset.wired) { search.dataset.wired = "1";[search, fFilter, fSort].forEach(function (e) { e.addEventListener("input", draw); }); }
    draw();

    if (location.hash.indexOf("#test=") === 0) {
      var id = decodeURIComponent(location.hash.slice(6));
      var t = (R.tests || []).find(function (x) { return x.id === id; });
      if (t) openModal(t);
    }
  }

  // ================================================================= MODAL
  function openModal(t) {
    var overlay = document.getElementById("overlay");
    var runsHere = RUN_IDS.filter(function (id) { return tRun(t, id); });
    var cur = tRun(t, state.run) ? state.run : runsHere[runsHere.length - 1];

    function renderVersion(runId) {
      var v = tRun(t, runId), baseV = tRun(t, state.base);
      var showDelta = state.base !== runId && baseV;
      var devHtml = (v.dev && v.dev.length)
        ? v.dev.map(function (mm) { var bot = mm.role === "assistant"; return '<div class="devmsg"><div class="who ' + (bot ? "bot" : "") + '">' + (bot ? "bot" : "dev") + '</div><div class="md">' + md(mm.content) + "</div></div>"; }).join("")
        : '<div class="empty">No dev reply captured in this Slack thread.</div>';
      var ratings = PARAMS.map(function (p, i) {
        var sc = v.scores[p], bd = showDelta ? (sc.score - baseV.scores[p].score) : null;
        var full = i === PARAMS.length - 1 && PARAMS.length % 2 === 1 ? " full" : "";
        return '<div class="rcard' + full + '"><div class="rh">' + chip(sc.score) + '<span class="nm">' + p + "</span>" + (showDelta ? deltaChip(bd) : "") + '</div><div class="reason">' + esc(sc.reason || "—") + "</div></div>";
      }).join("");
      var tabs = runsHere.map(function (id) {
        var o = tRun(t, id).overall;
        return '<button class="vtab' + (id === runId ? " on" : "") + '" data-run="' + id + '"><span>' + esc(LABEL[id]) + '</span><b style="color:' + overallColor(o) + '">' + o.toFixed(2) + "</b></button>";
      }).join("");
      var mbHd = showDelta ? (v.overall - baseV.overall) : null;

      document.getElementById("modal").innerHTML =
        '<div class="mhead"><div style="flex:1"><div class="qtext">' + esc(t.query || "(no query)") + "</div>" +
          '<div class="meta"><span class="pill ' + (v.synthesized ? "synth" : "nc") + '">' + (v.synthesized ? "synthesized" : "no-conclusive") + "</span>" +
            "<span>#" + esc(t.channel) + "</span>" + (v.wall_seconds != null ? "<span>" + Math.round(v.wall_seconds) + "s</span>" : "") +
            '<span>overall <b style="color:' + overallColor(v.overall) + '">' + v.overall.toFixed(2) + "</b>/5</span>" +
            (showDelta ? "<span>" + deltaChip(mbHd) + " vs " + esc(LABEL[state.base]) + "</span>" : "") +
          "</div></div><button class=\"close\" title=\"Close (Esc)\">×</button></div>" +
        '<div class="vtabs">' + tabs + '<span class="vtabs-lab">version</span></div>' +
        '<div class="mbody"><div class="compare">' +
            '<div class="col-box"><div class="ch"><span class="dot" style="background:#38d9c4"></span>HyperSage Trace — ' + esc(LABEL[runId]) + '</div><div class="body md">' + md(v.hypersage || "*(empty)*") + "</div></div>" +
            '<div class="col-box"><div class="ch"><span class="dot" style="background:#6e8bff"></span>Dev — Slack thread</div><div class="body">' + devHtml + "</div></div>" +
          "</div>" +
          '<h2 style="margin:24px 0 12px;font-size:13px;letter-spacing:.1em;color:#6b7383;text-transform:uppercase">Evaluator ratings &amp; rationale · ' + esc(LABEL[runId]) + (showDelta ? " (Δ vs " + esc(LABEL[state.base]) + ")" : "") + "</h2>" +
          '<div class="ratings">' + ratings + "</div></div>";

      var modal = document.getElementById("modal");
      modal.querySelector(".close").addEventListener("click", closeModal);
      modal.querySelectorAll(".vtab").forEach(function (b) { b.addEventListener("click", function () { renderVersion(b.dataset.run); }); });
    }

    renderVersion(cur);
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    try { history.replaceState(null, "", "#test=" + encodeURIComponent(t.id)); } catch (e) {}
  }
  function closeModal() { document.getElementById("overlay").classList.remove("open"); document.body.style.overflow = ""; try { history.replaceState(null, "", location.pathname); } catch (e) {} }

  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  document.addEventListener("click", function (e) { var ov = document.getElementById("overlay"); if (ov && e.target === ov) closeModal(); });

  // ============================================================ CONCURRENCY
  var GH = "https://github.com/juspay/hypersage/issues/";
  function pctColor(p) { if (p >= 60) return "#2fa86b"; if (p >= 45) return "#5bbf6a"; if (p >= 30) return "#f5c243"; if (p >= 20) return "#f2811d"; return "#e5484d"; }
  function issueLink(n, label) { return '<a href="' + GH + n + '" target="_blank" rel="noopener">' + (label || ("#" + n)) + "</a>"; }
  function spark(arr, h) {
    h = h || 40; if (!arr || !arr.length) return '<span class="faintx">—</span>';
    var mx = Math.max.apply(null, arr.concat([1]));
    return '<span class="spark">' + arr.map(function (v) {
      return '<i style="height:' + Math.max(2, v / mx * h) + "px\" title=\"" + v + '/5min"></i>';
    }).join("") + "</span>";
  }

  function renderConcurrency() {
    var root = document.getElementById("concurrency");
    if (!root || !window.CONCURRENCY) return;
    var C = window.CONCURRENCY, m = C.meta;

    // headline
    document.getElementById("cc-headline").innerHTML =
      '<div class="cc-hero">' +
        "<p>" + esc(m.headline) + "</p>" +
        '<div class="cc-meta"><span>' + esc(m.config) + "</span></div>" +
        '<div class="cc-chips"><span class="cc-lab">Admission fixes verified working:</span>' +
          m.fixes.map(function (f) { return '<span class="chip-ok">' + issueLink(f.issue) + " · " + esc(f.title) + "</span>"; }).join("") +
          '<span class="cc-lab">Tracking:</span><span class="chip-parent">' + issueLink(m.parent_issue, "parent #" + m.parent_issue) + "</span>" +
        "</div>" +
      "</div>";

    // runs comparison table
    var rows = C.runs.map(function (r) {
      var fail = r.timeout >= r.cap_abandoned ? (r.timeout + " timeout") : (r.cap_abandoned + " cap-abandon");
      return "<tr>" +
        "<td><b>" + esc(r.label) + "</b>" + (r.contaminated ? ' <span class="tagx warn">contaminated</span>' : "") +
          '<br><span class="thsub">' + esc(r.phase) + " · cap " + r.cap + "</span></td>" +
        '<td class="num"><span class="badge-overall" style="background:' + pctColor(r.completion_pct) + ';min-width:52px;height:26px;font-size:13px">' + r.completion_pct + "%</span></td>" +
        '<td class="num">' + r.max_concurrent + "</td>" +
        '<td class="num">' + (r.wall_p50 != null ? Math.round(r.wall_p50) + "s" : "—") + "</td>" +
        '<td class="num">' + r.cap_429 + '<span class="thsub"> pod ' + r.cap_pod + " · usr " + r.cap_user + "</span></td>" +
        '<td class="num">' + r.session_409 + "</td>" +
        '<td class="num">' + r.throughput_per_min + "/min</td>" +
        "<td>" + esc(fail) + (r.errors ? " · " + r.errors + " err" : "") + "</td>" +
        "</tr>";
    }).join("");
    document.getElementById("cc-runs").innerHTML =
      '<table class="simple cc-runs"><thead><tr><th>Run</th><th class="num">Completed</th><th class="num">Max concurrent</th>' +
      '<th class="num">Wall p50</th><th class="num">cap-429</th><th class="num">409</th><th class="num">Throughput</th><th>Dominant failure</th></tr></thead><tbody>' +
      rows + "</tbody></table>";

    // per-run detail cards
    document.getElementById("cc-detail").innerHTML = C.runs.map(function (r) {
      var pu = Object.keys(r.per_user_completed || {});
      var puMax = Math.max.apply(null, pu.map(function (k) { return r.per_user_completed[k]; }).concat([1]));
      var puBars = pu.map(function (k) {
        return '<span class="pu"><i style="height:' + Math.max(3, r.per_user_completed[k] / puMax * 34) + 'px"></i><em>u' + k + "</em></span>";
      }).join("");
      return '<div class="card cc-card">' +
        '<div class="cc-card-h"><b>' + esc(r.label) + "</b>" + (r.contaminated ? ' <span class="tagx warn">contaminated</span>' : "") + "</div>" +
        '<div class="cc-big" style="color:' + pctColor(r.completion_pct) + '">' + r.completion_pct + '%<span> completed</span></div>' +
        '<div class="cc-stats">' +
          statx("queries", r.n) + statx("max concurrent", r.max_concurrent) + statx("wall p50", (r.wall_p50 != null ? Math.round(r.wall_p50) + "s" : "—")) +
          statx("timeout", r.timeout) + statx("cap-abandon", r.cap_abandoned) + statx("errors", r.errors) +
        "</div>" +
        '<div class="cc-sub2">throughput (completions / 5-min)</div>' + spark(r.completions_per_5min) +
        '<div class="cc-sub2">per-user completed</div><div class="pu-row">' + puBars + "</div>" +
        (r.window_ist ? '<div class="cc-win">IST ' + esc(r.window_ist) + "</div>" : "") +
        '<p class="cc-note">' + esc(r.note) + "</p>" +
      "</div>";
    }).join("");

    // improvements
    var conf = C.improvements;
    document.getElementById("cc-improve-sub").innerHTML =
      "Verified concurrency improvements from the clean cap-15 run (adversarially checked against the code), tracked under " + issueLink(m.parent_issue, "#" + m.parent_issue) + ".";
    document.getElementById("cc-improve").innerHTML =
      '<table class="simple cc-improve"><thead><tr><th>Issue</th><th>Improvement</th><th class="num">Severity</th><th class="num">Bottleneck</th><th class="num">Effort</th><th>Fix</th></tr></thead><tbody>' +
      conf.map(function (i) {
        return "<tr><td>" + issueLink(i.issue) + "</td><td><b>" + esc(i.title) + "</b></td>" +
          '<td class="num">' + esc(i.sev) + "</td>" +
          '<td class="num">' + (i.bottleneck ? '<span class="tagx hot">yes</span>' : "—") + "</td>" +
          '<td class="num">' + esc(i.effort) + "</td><td>" + esc(i.one_liner) + "</td></tr>";
      }).join("") + "</tbody></table>";

    // methodology + refuted
    document.getElementById("cc-refuted").innerHTML =
      "Each query POSTs to <code>/api/query</code> and the answer is read back via issue-API polling, correlated by a unique " +
      "<code>[[q:…]]</code> marker; 5 distinct users each on their own spoofed IP fire in parallel. " +
      '<div class="cc-sub2">Refuted (adversarially checked — not the bottleneck):</div><ul class="cc-ref">' +
      m.refuted.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  }
  function statx(k, v) { return '<div class="sx"><div class="sk">' + esc(k) + '</div><div class="sv">' + (v == null ? "—" : v) + "</div></div>"; }

  // ---------- boot ----------
  document.addEventListener("DOMContentLoaded", function () {
    var sub = document.getElementById("doc-sub");
    if (sub && R.meta.subtitle) sub.textContent = R.meta.subtitle;
    renderAnalytics();
    renderTests();
    renderConcurrency();
  });
})();
