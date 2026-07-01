#!/usr/bin/env python3
"""Build data.js for the HyperSage trace-eval report site — multi-run (versioned).

Reads a manifest (``runs.json``) listing one or more test runs, each pointing at
an answers JSONL + an evals JSONL. Emits a self-contained ``data.js``
(``window.REPORT = {...}``) with:

    meta      : {title, subtitle, runs:[{id,label,date}], latest, baseline}
    runsData  : {run_id -> aggregate stats for that run}
    tests     : [{id, channel, query, runs:{run_id -> {answer, dev, scores, ...}}}]

so the static site can show any run's analytics AND compare improvement per test
across runs. Works over file:// with no server or network.

Manifest (runs.json), runs ordered oldest -> newest:
    {
      "title": "...", "subtitle": "...",
      "bench": "/abs/path/to/benchmarks/trace_runs",
      "baseline": "v1", "latest": "v2",
      "runs": [
        {"id":"v1","label":"Pre-fix","date":"2026-06-28",
         "answers":"answers_merged.jsonl","evals":"merged_eval/evals.jsonl","note":"..."},
        ...
      ]
    }

Usage:
    python3 generate_data.py                     # reads ./runs.json
    python3 generate_data.py --manifest runs.json
    # legacy single run (no manifest):
    python3 generate_data.py --bench <dir> --answers a.jsonl --evals e/evals.jsonl --run-id v1
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

PARAMS = ["accuracy", "relevancy", "completeness", "safety", "reasoning"]
HERE = Path(__file__).resolve().parent
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


def _gmean(group, p):
    vals = [t["scores"][p]["score"] for t in group]
    return round(statistics.mean(vals), 2) if vals else 0.0


def _goverall(group):
    return round(statistics.mean(t["overall"] for t in group), 2) if group else 0.0


def build_run(bench: Path, answers_file: str, evals_file: str, note: str):
    """Return (aggregate_meta, {unit_id -> per-test entry}) for a single run."""
    answers = {r["unit_id"]: r for r in jl(bench / answers_file)}
    evals = {e["unit_id"]: e for e in jl(bench / evals_file) if e.get("scores")}

    tests = {}
    for uid, e in evals.items():
        a = answers.get(uid, {})
        if a.get("status") != "completed":
            continue
        sc = {p: {"score": int(e["scores"][p]["score"]), "reason": e["scores"][p].get("reason", "")} for p in PARAMS}
        tests[uid] = {
            "channel": a.get("channel") or e.get("channel") or "?",
            "query": (a.get("query") or e.get("query") or "").strip(),
            "hypersage": (a.get("trace_answer") or "").strip(),
            "dev": a.get("reference_dev_reply") or [],
            "synthesized": is_synth(a),
            "wall_seconds": a.get("wall_seconds"),
            "scores": sc,
            "overall": overall(sc),
        }

    tl = list(tests.values())
    S = [t for t in tl if t["synthesized"]]
    NC = [t for t in tl if not t["synthesized"]]
    dist = Counter(round(t["overall"]) for t in S)
    by_channel = defaultdict(list)
    for t in tl:
        by_channel[t["channel"]].append(t)
    all_answers = list(answers.values())
    status_counts = Counter(r.get("status", "?") for r in all_answers)

    meta = {
        "counts": {
            "attempted": len(all_answers),
            "evaluated": len(tl),
            "synthesized": len(S),
            "no_conclusive": len(NC),
            "status": dict(status_counts),
        },
        "overall": {"synthesized": _goverall(S), "no_conclusive": _goverall(NC), "all": _goverall(tl)},
        "synthesis_rate": round(100 * len(S) / len(tl), 1) if tl else 0.0,
        "params": {p: {"synthesized": _gmean(S, p), "no_conclusive": _gmean(NC, p), "all": _gmean(tl, p)} for p in PARAMS},
        "distribution": {str(k): dist.get(k, 0) for k in range(1, 6)},
        "good_pct": round(100 * (dist.get(4, 0) + dist.get(5, 0)) / len(S), 1) if S else 0.0,
        "by_channel": {
            ch: {"count": len(g), "synthesized": sum(1 for t in g if t["synthesized"]), "overall": _goverall(g)}
            for ch, g in sorted(by_channel.items())
        },
        "context": {"note": note or "", "params_order": PARAMS},
    }
    return meta, tests


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, default=HERE / "runs.json")
    ap.add_argument("--out", type=Path, default=HERE / "data.js")
    # legacy single-run overrides (used only when --manifest is absent)
    ap.add_argument("--bench", type=Path, default=DEFAULT_BENCH)
    ap.add_argument("--answers", default=None)
    ap.add_argument("--evals", default=None)
    ap.add_argument("--run-id", default="v1")
    args = ap.parse_args()

    if args.manifest.exists():
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    elif args.answers and args.evals:
        manifest = {
            "bench": str(args.bench),
            "runs": [{"id": args.run_id, "label": args.run_id, "date": "", "answers": args.answers, "evals": args.evals}],
        }
    else:
        raise SystemExit(f"No manifest at {args.manifest} and no --answers/--evals given.")

    bench = Path(manifest.get("bench", DEFAULT_BENCH))
    runs = manifest["runs"]  # oldest -> newest
    latest = manifest.get("latest") or runs[-1]["id"]
    baseline = manifest.get("baseline") or runs[0]["id"]

    runs_meta, runs_data, all_tests = [], {}, {}
    for run in runs:
        meta, tests = build_run(bench, run["answers"], run["evals"], run.get("note", ""))
        runs_data[run["id"]] = meta
        runs_meta.append({"id": run["id"], "label": run["label"], "date": run.get("date", "")})
        for uid, t in tests.items():
            entry = all_tests.setdefault(uid, {"id": uid, "channel": t["channel"], "query": t["query"], "runs": {}})
            # runs are oldest->newest, so later iterations (newer runs) win for stable fields
            if t["channel"]:
                entry["channel"] = t["channel"]
            if t["query"]:
                entry["query"] = t["query"]
            entry["runs"][run["id"]] = {k: t[k] for k in ("hypersage", "dev", "synthesized", "wall_seconds", "scores", "overall")}

    tests_list = list(all_tests.values())

    def sort_key(t):
        r = t["runs"].get(latest) or next(iter(t["runs"].values()))
        return r["overall"]

    tests_list.sort(key=sort_key, reverse=True)

    report = {
        "meta": {
            "title": manifest.get("title", "HyperSage Trace — Evaluation Report"),
            "subtitle": manifest.get("subtitle", "Versioned LLM-judge evaluation across trace test runs"),
            "runs": runs_meta,
            "latest": latest,
            "baseline": baseline,
        },
        "runsData": runs_data,
        "tests": tests_list,
    }
    payload = "window.REPORT = " + json.dumps(report, ensure_ascii=False) + ";\n"
    args.out.write_text(payload, encoding="utf-8")
    n_shared = sum(1 for t in tests_list if len(t["runs"]) == len(runs))
    print(f"wrote {args.out} — {len(runs)} runs {[r['id'] for r in runs_meta]}, "
          f"{len(tests_list)} unique tests ({n_shared} in all runs) | {round(len(payload)/1024)} KB")
    for rid, m in runs_data.items():
        print(f"  {rid}: evaluated={m['counts']['evaluated']} synth_rate={m['synthesis_rate']}% "
              f"overall(synth)={m['overall']['synthesized']} overall(all)={m['overall']['all']}")


if __name__ == "__main__":
    main()
