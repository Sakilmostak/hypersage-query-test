#!/usr/bin/env python3
"""Build concurrency_data.js for the report site's Concurrency section.

Reads the load-test run records (benchmarks/trace_runs/loadtest*) and emits
window.CONCURRENCY = { meta, runs:[...], improvements:[...] } — a self-contained
summary of the 5-user concurrency load tests, so the static site can render the
before/after across admission cap + fixes.

Usage:  python3 generate_concurrency.py [--bench /path/to/benchmarks/trace_runs]
"""
from __future__ import annotations
import argparse, json, statistics as st, datetime as dt
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_BENCH = Path("/Users/sk.sakil/hypersage/benchmarks/trace_runs")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

# run order oldest -> newest; metadata is authored, metrics are computed
RUNS = [
    dict(id="broken_cap5", dir="loadtest", label="Broken · cap 5",
         phase="pre-fix", cap=5, contaminated=False,
         note="Before the fixes. Leaky slot release: completed investigations held their cap slot until the 300s reaper, so throughput was gated to ~5 admits per 5-min cycle."),
    dict(id="fixed_cap5", dir="loadtest_postfix", label="Fixed · cap 5",
         phase="after #1162+#1163", cap=5, contaminated=False,
         note="After the admission fixes. Slots free on completion (no reaper gating); per-user cap + 409 guard live. Throughput sustained, fairness even."),
    dict(id="cap15_blip", dir="loadtest_pod15", label="Cap 15 · contaminated",
         phase="ceiling→15", cap=15, contaminated=True,
         note="Pod ceiling raised to 15. Disrupted mid-run by a local network blip (11 ConnectErrors, ~25-min stall) — not a clean measurement, kept for reference."),
    dict(id="cap15_clean", dir="loadtest_pod15_rerun", label="Cap 15 · clean",
         phase="ceiling→15 (clean)", cap=15, contaminated=False,
         note="Clean re-run (0 connection errors). Real concurrency ~8, completion ~53%. Timeouts become the dominant failure — the bottleneck is now per-investigation latency + the LLM concurrency gate, not admission."),
]

IMPROVEMENTS = [
    dict(issue=1183, title="Tighten agent/wall-clock timeouts to the client deadline",
         sev="High", effort="trivial (config)", bottleneck=False,
         one_liner="agent_timeout 480→120–150s, wall_clock 600→300–320s — reclaims ~49% of wasted LLM-slot time. Ship first."),
    dict(issue=1184, title="LLM Semaphore(5) wraps whole agent runs + provider max_parallel_requests=5",
         sev="High", effort="medium", bottleneck=True,
         one_liner="The real ceiling: max in-flight LLM calls plateaus at 5. Scope the gate to the ainvoke, env-size it, gate _direct_answer, lift/shard the provider key."),
    dict(issue=1185, title="Diagnosis-path latency p50 ~437s — serial orchestration",
         sev="High", effort="medium", bottleneck=True,
         one_liner="Budget-gate the chain-judge/2nd-analysis wave, collapse redundant synthesis, add phase-timing logs."),
    dict(issue=1186, title="ripgrep missing on the pod → silent empty code search",
         sev="Low", effort="small", bottleneck=False,
         one_liner="Redeploy so rg is on PATH; fail loud instead of returning []."),
]
REFUTED = [
    "Client REST polling as a bottleneck — cheap indexed 200s, uncorrelated with latency, 0 pool exhaustion.",
    "logs_agent 'Loki multi-pod fan-out' — single matcher bounded to 30s; slowness is serialized LLM turns.",
]


def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()]


def parse(x):
    try: return dt.datetime.fromisoformat(x)
    except Exception: return None


def compute(bench: Path, meta: dict) -> dict:
    fs = sorted((bench / meta["dir"]).glob("*.records.jsonl"))
    if not fs:
        return {**meta, "missing": True}
    recs = jl(fs[-1])
    stt = Counter(r["status"] for r in recs)
    comp = [r for r in recs if r["status"] == "completed" and r.get("wall_seconds")]
    ev = []
    for r in comp:
        a, b = parse(r["post_ts_utc"]), parse(r["answer_ts_utc"])
        if a and b: ev += [(a, 1), (b, -1)]
    ev.sort(); c = m = 0
    for _, d in ev: c += d; m = max(m, c)
    ans = [parse(r["answer_ts_utc"]) for r in comp if r.get("answer_ts_utc")]
    posts = [parse(r["post_ts_utc"]) for r in recs if r.get("post_ts_utc")]
    curve = {}
    start = end = None
    if posts:
        start = min(posts)
        end = max([e for e in ans if e] + [start])
        if ans:
            bb = Counter(int((a - start).total_seconds() // 300) for a in ans)
            curve = {k: bb.get(k, 0) for k in range(max(bb) + 1)}
    ws = sorted(r["wall_seconds"] for r in comp)
    dur_min = ((end - start).total_seconds() / 60) if (start and end) else 0
    return {
        **{k: meta[k] for k in ("id", "label", "phase", "cap", "contaminated", "note")},
        "n": len(recs), "completed": len(comp),
        "completion_pct": round(100 * len(comp) / len(recs), 1) if recs else 0,
        "status": dict(stt),
        "timeout": stt.get("timeout", 0), "cap_abandoned": stt.get("cap_abandoned", 0),
        "errors": stt.get("error", 0) + stt.get("server_error", 0),
        "cap_429": sum(r["cap_429"] for r in recs),
        "cap_pod": sum(r.get("cap_pod_429", 0) for r in recs),
        "cap_user": sum(r.get("cap_user_429", 0) for r in recs),
        "session_409": sum(r.get("session_409", 0) for r in recs),
        "max_concurrent": m,
        "wall_p50": ws[len(ws) // 2] if ws else None,
        "wall_max": ws[-1] if ws else None,
        "completions_per_5min": [curve.get(k, 0) for k in range(len(curve))] if curve else [],
        "throughput_per_min": round(len(comp) / dur_min, 2) if dur_min else 0,
        "per_user_completed": dict(sorted(Counter(r["user_index"] for r in comp).items())),
        "duration_min": round(dur_min, 1),
        "window_ist": (start.astimezone(IST).strftime("%Y-%m-%d %H:%M") + " → " + end.astimezone(IST).strftime("%H:%M")) if (start and end) else "",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", type=Path, default=DEFAULT_BENCH)
    ap.add_argument("--out", type=Path, default=HERE / "concurrency_data.js")
    a = ap.parse_args()
    runs = [compute(a.bench, m) for m in RUNS]
    runs = [r for r in runs if not r.get("missing")]
    data = {
        "meta": {
            "title": "Concurrency load test",
            "config": "5 users × 3 concurrency × up to 50 queries · multi-IP (X-Forwarded-For)",
            "headline": ("Admission bugs fixed (#1162 slot-release, #1163 per-user cap + 409). Raising the pod ceiling "
                         "5→15 lifts real concurrency to ~8 and completion to ~53%, but the bottleneck has moved to "
                         "per-investigation latency + the LLM concurrency gate — not the admission cap."),
            "fixes": [{"issue": 1162, "title": "release cap slot on completion (not the 300s reaper)"},
                      {"issue": 1163, "title": "per-user fairness cap + revived X-Session-ID 409 guard"}],
            "parent_issue": 1182,
            "refuted": REFUTED,
        },
        "runs": runs,
        "improvements": IMPROVEMENTS,
    }
    payload = "window.CONCURRENCY = " + json.dumps(data, ensure_ascii=False) + ";\n"
    a.out.write_text(payload, encoding="utf-8")
    print(f"wrote {a.out} — {len(runs)} runs, {len(IMPROVEMENTS)} improvements | {round(len(payload)/1024)} KB")
    for r in runs:
        print(f"  {r['label']:22s} n={r['n']:3d} completed={r['completion_pct']}% maxc={r['max_concurrent']} "
              f"wall_p50={r['wall_p50']}s cap429={r['cap_429']}(pod{r['cap_pod']}/usr{r['cap_user']})")


if __name__ == "__main__":
    main()
