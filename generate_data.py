#!/usr/bin/env python3
"""Build data.js for the HyperSage trace-eval report site.

Joins the trace-run answers with the LLM-judge evaluations and emits a
self-contained ``data.js`` (``window.REPORT = {...}``) so the static site works
over file:// with no server or network.

Inputs (defaults point at the hypersage benchmarks dir; override with --bench):
    <bench>/answers_merged.jsonl         one record per unit (query, trace_answer,
                                         reference_dev_reply, status, ...)
    <bench>/merged_eval/evals.jsonl      one record per unit (scores per parameter)

Usage:
    python3 generate_data.py
    python3 generate_data.py --bench /path/to/hypersage/benchmarks/trace_runs
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

PARAMS = ["accuracy", "relevancy", "completeness", "safety", "reasoning"]
DEFAULT_BENCH = Path("/Users/sk.sakil/hypersage/benchmarks/trace_runs")


def jl(path: Path):
    if not path.exists():
        return []
    out = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def is_synth(rec: dict) -> bool:
    return rec.get("status") == "completed" and "No conclusive answer" not in (rec.get("trace_answer") or "")


def overall(scores: dict) -> float:
    return round(statistics.mean(scores[p]["score"] for p in PARAMS), 2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", type=Path, default=DEFAULT_BENCH)
    ap.add_argument("--answers", default="answers_merged.jsonl",
                    help="answers jsonl filename relative to --bench")
    ap.add_argument("--evals", default="merged_eval/evals.jsonl",
                    help="evals jsonl path relative to --bench")
    ap.add_argument("--baseline", type=float, default=2.98,
                    help="pre-fix synthesized-overall baseline shown in the hero delta")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "data.js")
    args = ap.parse_args()

    answers = {r["unit_id"]: r for r in jl(args.bench / args.answers)}
    evals = {e["unit_id"]: e for e in jl(args.bench / args.evals) if e.get("scores")}

    tests = []
    for uid, e in evals.items():
        a = answers.get(uid, {})
        if a.get("status") != "completed":
            continue
        sc = {p: {"score": int(e["scores"][p]["score"]), "reason": e["scores"][p].get("reason", "")} for p in PARAMS}
        tests.append({
            "id": uid,
            "channel": a.get("channel") or e.get("channel") or "?",
            "query": (a.get("query") or e.get("query") or "").strip(),
            "hypersage": (a.get("trace_answer") or "").strip(),
            "dev": a.get("reference_dev_reply") or [],
            "synthesized": is_synth(a),
            "wall_seconds": a.get("wall_seconds"),
            "scores": sc,
            "overall": overall(sc),
        })

    tests.sort(key=lambda t: t["overall"], reverse=True)

    # ---- aggregates ----
    def group_mean(group, p):
        vals = [t["scores"][p]["score"] for t in group]
        return round(statistics.mean(vals), 2) if vals else 0.0

    def group_overall(group):
        return round(statistics.mean(t["overall"] for t in group), 2) if group else 0.0

    S = [t for t in tests if t["synthesized"]]
    NC = [t for t in tests if not t["synthesized"]]

    params_table = {
        p: {"synthesized": group_mean(S, p), "no_conclusive": group_mean(NC, p), "all": group_mean(tests, p)}
        for p in PARAMS
    }
    dist = Counter(round(t["overall"]) for t in S)
    by_channel = defaultdict(list)
    for t in tests:
        by_channel[t["channel"]].append(t)

    all_answers = list(answers.values())
    status_counts = Counter(r.get("status", "?") for r in all_answers)

    meta = {
        "title": "HyperSage Trace — Evaluation Report",
        "subtitle": "Post-fix synthesized-answer quality on real Slack incident queries",
        "counts": {
            "attempted": len(all_answers),
            "evaluated": len(tests),
            "synthesized": len(S),
            "no_conclusive": len(NC),
            "status": dict(status_counts),
        },
        "overall": {"synthesized": group_overall(S), "no_conclusive": group_overall(NC), "all": group_overall(tests)},
        "params": params_table,
        "distribution": {str(k): dist.get(k, 0) for k in range(1, 6)},
        "good_pct": round(100 * (dist.get(4, 0) + dist.get(5, 0)) / len(S), 1) if S else 0.0,
        "by_channel": {
            ch: {"count": len(g), "synthesized": sum(1 for t in g if t["synthesized"]), "overall": group_overall(g)}
            for ch, g in sorted(by_channel.items())
        },
        # context for the narrative panel (from the run journey)
        "context": {
            "degraded_baseline_overall": args.baseline,
            "params_order": PARAMS,
            "note": (
                "Same queries, before and after the trace fixes. Pre-fix, trace reached a conclusion "
                "only 67% of the time and synthesized answers scored 2.98 overall. After the fixes "
                "(single-agent synthesis bypass, narration leak, synthesis-timeout + DB-pool stability), "
                "it now synthesizes 99% of the time and the synthesized answers below score as shown — "
                "a paired +0.44 overall gain on the same queries. Scored 1–5 by an LLM judge against "
                "the dev team's Slack-thread resolution."
            ),
        },
    }

    report = {"meta": meta, "tests": tests}
    payload = "window.REPORT = " + json.dumps(report, ensure_ascii=False) + ";\n"
    args.out.write_text(payload, encoding="utf-8")
    print(f"wrote {args.out} — {len(tests)} tests, {len(S)} synthesized | "
          f"synthesized overall={meta['overall']['synthesized']} all={meta['overall']['all']} "
          f"| {round(len(payload)/1024)} KB")


if __name__ == "__main__":
    main()
