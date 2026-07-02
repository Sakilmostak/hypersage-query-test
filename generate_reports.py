#!/usr/bin/env python3
"""Build reports_data.js — every fix/bug we filed across the project, as reports.

Fetches the real issues from GitHub (title/state/labels) and merges them with the
track structure + curated summaries into window.REPORTS, grouped by category →
tracking issue → child reports. Powers the site's Reports tab.

Usage:  python3 generate_reports.py   (requires `gh` authenticated to juspay/hypersage)
"""
from __future__ import annotations
import json, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = "juspay/hypersage"
GH = "https://github.com/juspay/hypersage/issues/"

# category -> tracks (parent + children).  Order = narrative order.
CATEGORIES = [
    dict(name="Query & answer quality", key="quality",
         blurb="Trace answer-quality and resilience work, driven by the LLM-judge evaluation of real Slack incident queries.",
         tracks=[
             dict(parent=1048, children=[1043, 1044, 1045, 1046, 1047],
                  blurb="First round — the resilience bugs behind truncated / empty / raw-dump answers."),
             dict(parent=1113, children=[1105, 1106, 1107, 1108, 1109, 1110, 1111, 1112],
                  blurb="Improvements mined from the 297-answer eval (completeness, grounding, intent routing)."),
             dict(parent=1123, children=[1124, 1125, 1126, 1127],
                  blurb="Regressions found by the post-deploy full re-run (over-synthesis on non-incident threads)."),
         ]),
    dict(name="Concurrency", key="concurrency",
         blurb="Admission, fairness, and capacity under concurrent load — from the 5-user load test.",
         tracks=[
             dict(parent=1161, children=[1162, 1163, 1164, 1165],
                  blurb="Admission bugs behind the throughput collapse — fixed & deployed, verified by the load-test re-runs."),
             dict(parent=1182, children=[1183, 1184, 1185, 1186],
                  blurb="The next bottleneck: per-investigation latency + the LLM concurrency gate (open)."),
         ]),
]

SUMMARIES = {
    1043: "Agent-synthesis & ChainJudge LLM timeouts (30s) collapsed answers to empty/raw.",
    1044: "Loki direct-fallback crashed — asyncio.Event bound to the wrong event loop.",
    1045: "Single-agent queries skipped synthesis/humanize → raw tool dumps.",
    1046: "Empty (length=0) responses + humanizer 'let_me_check' narration leaking through.",
    1047: "Postgres connection-pool exhaustion under agent load; no circuit breaker.",
    1048: "Tracking: trace answer quality & resilience — synthesis timeouts, raw dumps, pool exhaustion.",
    1105: "Route single-agent & chain-judge 'stop' paths through synthesis (not raw dumps).",
    1106: "Grounding/ID validator — stop fabricated incident#/payment_id/refund_id citations.",
    1107: "Add a NON_INVESTIGATION intent branch — stop force-fitting announcements to investigations.",
    1108: "Extend NO_NARRATION + humanizer to catch investigate/gather/focus + reject plan-only answers.",
    1109: "Replace bare 'No relevant results' fallbacks with searched-scope + thread summary + next-step.",
    1110: "Anchor to the literal query entities; classify contract/known-behavior questions as KNOWLEDGE.",
    1111: "Don't cite not_found / mismatched / future-dated tool results; anchor log queries to the incident date.",
    1112: "Relevance gate on semantic retrieval — drop off-topic CHANGELOG/PR snippets.",
    1113: "Tracking: answer-quality improvements mined from the 297-answer eval.",
    1123: "Tracking: post-deploy regressions from the full re-run.",
    1124: "Cross-conversation retrieval bleed — closed as a harness artifact (our runner's issue_id mis-binding, not a product bug).",
    1125: "Overconfident wrong root-cause — synthesis hardens inconclusive evidence into a confident wrong cause.",
    1126: "False 'no content / paste the thread' deflection on content-rich threads.",
    1127: "Restate-the-prompt-as-summary — drops actionable next-steps / scope-routing.",
    1161: "Tracking: concurrency load test — throughput collapse under parallel load.",
    1162: "Concurrency slot never released on completion — drained only by the 300s reaper (the throughput-collapse root cause).",
    1163: "Cap was global (not per-user) + session_id not bound to identity (409 guard dead) → per-user cap + X-Session-ID.",
    1164: "Demote 'PostgreSQL RO connection stale, reconnecting' WARNING to DEBUG (benign recovery).",
    1165: "Synthesis prompt still leaks process narration (humanizer strips it) — tighten NO_NARRATION.",
    1182: "Tracking: concurrency capacity — effective concurrency plateaus at ~8 despite cap-15.",
    1183: "Agent (480s) & wall-clock (600s) timeouts looser than the 320s client deadline — agents squat LLM slots, ~49% wasted.",
    1184: "LLM Semaphore(5) wraps whole agent runs + provider max_parallel_requests=5 — the real concurrency ceiling.",
    1185: "Diagnosis-path latency p50 ~437s — serial orchestration blows the deadline.",
    1186: "ripgrep missing on the deployed pod → agentic code search silently returns empty.",
}


def fetch(n):
    r = subprocess.run(["gh", "issue", "view", str(n), "--repo", REPO,
                        "--json", "number,title,state,labels"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    d = json.loads(r.stdout)
    return {"number": n, "title": d["title"], "state": d["state"],
            "labels": sorted(l["name"] for l in d["labels"])}


def status(meta):
    labels, state = meta["labels"], meta["state"]
    if state == "CLOSED" and "invalid" in labels:
        return "artifact"
    if state == "CLOSED":
        return "fixed"
    if meta["title"].lstrip().startswith("[Tracking]"):
        return "tracking"
    return "open"


def kind(meta):
    if "bug" in meta["labels"]:
        return "bug"
    if "enhancement" in meta["labels"]:
        return "enhancement"
    return "task"


def report(n):
    meta = fetch(n)
    if not meta:
        return None
    title = meta["title"]
    # strip the "[Tracking] " / "trace: " / "web: " prefixes for the card title
    return {"issue": n, "title": title, "type": kind(meta), "status": status(meta),
            "labels": meta["labels"], "summary": SUMMARIES.get(n, "")}


def main():
    cats = []
    counts = {"fixed": 0, "open": 0, "tracking": 0, "artifact": 0}
    for c in CATEGORIES:
        tracks = []
        for t in c["tracks"]:
            parent = report(t["parent"])
            items = [report(n) for n in t["children"]]
            items = [i for i in items if i]
            for i in items:
                counts[i["status"]] = counts.get(i["status"], 0) + 1
            tracks.append({"parent": parent, "blurb": t["blurb"], "items": items})
        cats.append({"name": c["name"], "key": c["key"], "blurb": c["blurb"], "tracks": tracks})
    data = {"meta": {"repo": REPO, "gh": GH, "counts": counts,
                     "total": sum(len(t["items"]) for c in cats for t in c["tracks"])},
            "categories": cats}
    out = HERE / "reports_data.js"
    out.write_text("window.REPORTS = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"wrote {out} — {len(cats)} categories, {data['meta']['total']} child reports | counts {counts}")


if __name__ == "__main__":
    main()
