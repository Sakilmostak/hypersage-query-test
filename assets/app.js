/* HyperSage Trace — Evaluation Report :: app */
(function () {
  "use strict";
  var R = window.REPORT || { meta: {}, tests: [] };
  var PARAMS = ["accuracy", "relevancy", "completeness", "safety", "reasoning"];
  var SCALE = ["", "#e5484d", "#f2811d", "#f5c243", "#5bbf6a", "#2fa86b"];

  // ---------- helpers ----------
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function scoreColor(s) { return SCALE[Math.round(s)] || "#6b7383"; }
  function overallColor(v) {
    if (v >= 4) return "#2fa86b";
    if (v >= 3.5) return "#5bbf6a";
    if (v >= 2.5) return "#f5c243";
    if (v >= 1.5) return "#f2811d";
    return "#e5484d";
  }
  function md(text) {
    var t = String(text || "");
    try {
      if (window.marked) {
        if (typeof marked.parse === "function") return marked.parse(t);
        if (typeof marked === "function") return marked(t);
      }
    } catch (e) { /* fall through */ }
    return "<pre>" + esc(t) + "</pre>";
  }
  function chip(s) {
    return '<span class="score" style="background:' + scoreColor(s) + '">' + s + "</span>";
  }

  // ---------- analytics page ----------
  function renderAnalytics() {
    var root = document.getElementById("analytics");
    if (!root) return;
    var m = R.meta, c = m.counts || {}, ov = m.overall || {}, ctx = m.context || {};

    // hero
    var hero = document.getElementById("hero");
    hero.innerHTML =
      '<div class="ring">' +
        '<div class="big" style="color:' + overallColor(ov.synthesized) + '">' + ov.synthesized.toFixed(2) +
          '<span>/5</span></div>' +
        '<div class="lbl">Synthesized overall</div>' +
      "</div>" +
      "<div>" +
        "<p>" + esc(ctx.note || "") + "</p>" +
        '<div class="delta">▲ up from a degraded-state baseline of ' +
          (ctx.degraded_baseline_overall != null ? ctx.degraded_baseline_overall.toFixed(1) : "—") +
          " overall</div>" +
      "</div>";

    // count cards
    var cards = document.getElementById("cards");
    var defs = [
      ["Queries attempted", c.attempted],
      ["Completed & scored", c.evaluated],
      ["Synthesized answers", c.synthesized],
      ['"No conclusive answer"', c.no_conclusive],
      ["Good (≥4/5)", (m.good_pct != null ? m.good_pct + "%" : "—"), "of synthesized"],
    ];
    defs.forEach(function (d) {
      var card = el("div", "card");
      card.innerHTML = '<div class="k">' + esc(d[0]) + "</div><div class=\"v\">" +
        (d[1] == null ? "—" : d[1]) + (d[2] ? ' <small>' + esc(d[2]) + "</small>" : "") + "</div>";
      cards.appendChild(card);
    });

    // per-parameter comparison bars
    var params = document.getElementById("params");
    var groups = [["synthesized", "Synthesized", "#5bbf6a"], ["no_conclusive", "No-conclusive", "#f2811d"], ["all", "All", "#6e8bff"]];
    document.getElementById("plegend").innerHTML = groups.map(function (g) {
      return '<span><i style="background:' + g[2] + '"></i>' + g[1] + "</span>";
    }).join("");
    PARAMS.forEach(function (p) {
      var row = el("div", "param-row");
      var bars = '<div class="bars">';
      groups.forEach(function (g) {
        var v = (m.params[p] || {})[g[0]] || 0;
        bars += '<div class="bar"><span class="tag">' + g[1] + '</span>' +
          '<span class="track"><span class="fill" style="width:' + (v / 5 * 100) + '%;background:' + g[2] + '"></span></span>' +
          '<span class="num">' + v.toFixed(2) + "</span></div>";
      });
      bars += "</div>";
      row.innerHTML = '<div class="name">' + esc(p) + "</div>" + bars;
      params.appendChild(row);
    });

    // distribution
    var dist = document.getElementById("dist");
    var dvals = m.distribution || {};
    var maxd = Math.max(1, Math.max.apply(null, Object.keys(dvals).map(function (k) { return dvals[k]; })));
    [1, 2, 3, 4, 5].forEach(function (s) {
      var n = dvals[s] || 0;
      var col = el("div", "col");
      col.innerHTML = '<div class="cnt">' + n + "</div>" +
        '<div class="barv" style="height:' + (n / maxd * 150) + 'px;background:' + SCALE[s] + '"></div>' +
        '<div class="star">' + s + "★</div>";
      dist.appendChild(col);
    });

    // by channel
    var ch = document.getElementById("channels");
    var rows = "";
    Object.keys(m.by_channel || {}).forEach(function (name) {
      var x = m.by_channel[name];
      rows += "<tr><td>#" + esc(name) + '</td><td class="num">' + x.count +
        '</td><td class="num">' + x.synthesized + '</td><td class="num"><span class="badge-overall" style="background:' +
        overallColor(x.overall) + ';min-width:42px;height:24px;font-size:13px">' + x.overall.toFixed(2) + "</span></td></tr>";
    });
    ch.innerHTML = "<thead><tr><th>Channel</th><th class=\"num\">Tests</th><th class=\"num\">Synthesized</th><th class=\"num\">Overall</th></tr></thead><tbody>" + rows + "</tbody>";

    // overall-vs-noconclusive note card
    var oc = document.getElementById("overall-compare");
    oc.innerHTML =
      "<div class=\"cards\">" +
      ["synthesized", "no_conclusive", "all"].map(function (k) {
        var lbl = { synthesized: "Synthesized", no_conclusive: "No-conclusive", all: "All completed" }[k];
        var v = ov[k] || 0;
        return '<div class="card"><div class="k">' + lbl + ' — overall</div><div class="v" style="color:' +
          overallColor(v) + '">' + v.toFixed(2) + ' <small>/5</small></div></div>';
      }).join("") + "</div>";
  }

  // ---------- tests page ----------
  function renderTests() {
    var root = document.getElementById("tests");
    if (!root) return;
    var listEl = document.getElementById("tlist");
    var countEl = document.getElementById("tcount");
    var search = document.getElementById("search");
    var fFilter = document.getElementById("filter");
    var fSort = document.getElementById("sort");

    function current() {
      var q = (search.value || "").toLowerCase().trim();
      var f = fFilter.value, s = fSort.value;
      var arr = R.tests.filter(function (t) {
        if (f === "synth" && !t.synthesized) return false;
        if (f === "nc" && t.synthesized) return false;
        if (!q) return true;
        return (t.query || "").toLowerCase().indexOf(q) >= 0 ||
               (t.channel || "").toLowerCase().indexOf(q) >= 0 ||
               (t.hypersage || "").toLowerCase().indexOf(q) >= 0;
      });
      arr.sort(function (a, b) {
        if (s === "overall_desc") return b.overall - a.overall;
        if (s === "overall_asc") return a.overall - b.overall;
        if (s === "channel") return (a.channel || "").localeCompare(b.channel || "");
        return b.overall - a.overall;
      });
      return arr;
    }

    function draw() {
      var arr = current();
      countEl.textContent = arr.length + " of " + R.tests.length + " tests";
      listEl.innerHTML = "";
      arr.forEach(function (t) {
        var row = el("div", "trow");
        row.tabIndex = 0;
        var mini = PARAMS.map(function (p) {
          return '<span class="score" title="' + p + '" style="background:' + scoreColor(t.scores[p].score) + '">' + t.scores[p].score + "</span>";
        }).join("");
        row.innerHTML =
          '<div class="chan">#' + esc(t.channel) + '<br><span class="pill ' + (t.synthesized ? "synth" : "nc") + '">' +
            (t.synthesized ? "synthesized" : "no-conclusive") + "</span></div>" +
          '<div class="q" title="' + esc(t.query) + '">' + esc(t.query || "(no query)") + "</div>" +
          '<div class="mini">' + mini + "</div>" +
          '<div class="badge-overall" style="background:' + overallColor(t.overall) + '">' + t.overall.toFixed(1) + "</div>";
        row.addEventListener("click", function () { openModal(t); });
        row.addEventListener("keydown", function (e) { if (e.key === "Enter") openModal(t); });
        listEl.appendChild(row);
      });
    }

    [search, fFilter, fSort].forEach(function (e) { e.addEventListener("input", draw); });
    draw();

    // deep-link: #test=<id>
    if (location.hash.indexOf("#test=") === 0) {
      var id = decodeURIComponent(location.hash.slice(6));
      var t = R.tests.find(function (x) { return x.id === id; });
      if (t) openModal(t);
    }
  }

  // ---------- modal ----------
  function openModal(t) {
    var overlay = document.getElementById("overlay");
    var devHtml;
    if (t.dev && t.dev.length) {
      devHtml = t.dev.map(function (mm) {
        var bot = mm.role === "assistant";
        return '<div class="devmsg"><div class="who ' + (bot ? "bot" : "") + '">' +
          (bot ? "bot" : "dev") + '</div><div class="md">' + md(mm.content) + "</div></div>";
      }).join("");
    } else {
      devHtml = '<div class="empty">No dev reply captured in this Slack thread.</div>';
    }
    var ratings = PARAMS.map(function (p, i) {
      var sc = t.scores[p];
      var full = i === PARAMS.length - 1 && PARAMS.length % 2 === 1 ? " full" : "";
      return '<div class="rcard' + full + '"><div class="rh">' + chip(sc.score) +
        '<span class="nm">' + p + '</span></div><div class="reason">' + esc(sc.reason || "—") + "</div></div>";
    }).join("");

    document.getElementById("modal").innerHTML =
      '<div class="mhead">' +
        '<div><div class="qtext">' + esc(t.query || "(no query)") + "</div>" +
          '<div class="meta"><span class="pill ' + (t.synthesized ? "synth" : "nc") + '">' +
            (t.synthesized ? "synthesized" : "no-conclusive") + "</span>" +
            "<span>#" + esc(t.channel) + "</span>" +
            (t.wall_seconds != null ? "<span>" + Math.round(t.wall_seconds) + "s</span>" : "") +
            '<span>overall <b style="color:' + overallColor(t.overall) + '">' + t.overall.toFixed(2) + "</b>/5</span>" +
          "</div></div>" +
        '<button class="close" title="Close (Esc)">×</button>' +
      "</div>" +
      '<div class="mbody">' +
        '<div class="compare">' +
          '<div class="col-box"><div class="ch"><span class="dot" style="background:#38d9c4"></span>HyperSage Trace answer</div>' +
            '<div class="body md">' + md(t.hypersage || "*(empty)*") + "</div></div>" +
          '<div class="col-box"><div class="ch"><span class="dot" style="background:#6e8bff"></span>Dev — Slack thread</div>' +
            '<div class="body">' + devHtml + "</div></div>" +
        "</div>" +
        '<h2 style="margin:24px 0 12px;font-size:13px;letter-spacing:.1em;color:#6b7383;text-transform:uppercase">Evaluator ratings &amp; rationale</h2>' +
        '<div class="ratings">' + ratings + "</div>" +
      "</div>";

    document.getElementById("modal").querySelector(".close").addEventListener("click", closeModal);
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    try { history.replaceState(null, "", "#test=" + encodeURIComponent(t.id)); } catch (e) {}
  }
  function closeModal() {
    document.getElementById("overlay").classList.remove("open");
    document.body.style.overflow = "";
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }

  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  document.addEventListener("click", function (e) {
    var ov = document.getElementById("overlay");
    if (ov && e.target === ov) closeModal();
  });

  // ---------- boot ----------
  document.addEventListener("DOMContentLoaded", function () {
    if (R.meta && R.meta.title) {
      var t = document.getElementById("doc-sub");
      if (t && R.meta.subtitle) t.textContent = R.meta.subtitle;
    }
    renderAnalytics();
    renderTests();
  });
})();
