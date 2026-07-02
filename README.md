# HyperSage Trace — Evaluation Report

A self-contained static site visualizing an LLM-judge evaluation of HyperSage's **trace**
(payment-failure diagnosis) agent on real Slack incident queries.

Each conversation that was deemed useful for the trace agent was replayed through the deployed
HyperSage instance; the answer it produced was scored **1–5** on five parameters — **accuracy,
relevancy, completeness, safety, reasoning** — by an LLM judge, comparing it against the dev team's
actual Slack-thread resolution.

## Headline

Same queries, scored before and after the trace fixes (single-agent synthesis bypass, narration
leak, synthesis-timeout + DB-pool stability):

| Metric | Before | After | Δ |
|--------|:---:|:---:|:---:|
| Synthesis rate (reached a conclusion) | 67% | **99%** | +32pt |
| Overall, synthesized answers (/5) | 2.98 | **3.36** | +0.38 |
| Overall, paired same-query (/5) | 2.90 | **3.34** | +0.44 |
| Synthesized answers scoring ≥4/5 | ~30% | **45%** | +15pt |

On the 273 queries scored in both runs: **174 improved, 80 regressed, 19 unchanged**, with far
larger gains than losses (70 improvements >1.0 vs 19 regressions >1.0). Biggest movers are
relevancy (+0.89) and completeness (+0.58); safety stays high (~4.7). The site shows both runs —
**v1** (pre-fix, 297 scored) and **v2** (post-fix, 290 scored) — defaulting to v2 vs v1; use the run
selector to switch or add more runs (see *Versioning* below).

## View it

No build step, no server, no network — just open it:

```
open index.html        # macOS
# or double-click index.html
```

- **Analytics** (`index.html`) — pick a run and a comparison run; see that run's aggregate scores plus
  an **Improvement across runs** trend table (synthesis rate + overall + per-parameter, with Δ).
- **Tests** (`tests.html`) — every evaluated query with its rating **and its Δ vs the comparison run**;
  sort by *most improved / most regressed*. Click a row to compare HyperSage's answer vs the dev Slack
  thread; use the **version tabs** in the modal to see how that one test's answer + scores changed run-to-run.
- **Concurrency** (`concurrency.html`) — the 5-user concurrency load tests (broken cap-5 → fixed cap-5 →
  cap-15): completion %, max concurrent, throughput, per-user fairness across runs. Regenerate with
  `python3 generate_concurrency.py`.
- **Reports** (`reports.html`) — every bug & improvement this investigation filed on `juspay/hypersage`
  (answer-quality + concurrency), each as a report grouped by tracking issue, with live fixed/open status.
  Regenerate from GitHub with `python3 generate_reports.py` (needs `gh` authenticated).

## Versioning — multiple runs

The site is multi-run. Runs are declared in **`runs.json`** (ordered oldest → newest):

```jsonc
{
  "baseline": "v1", "latest": "v2",
  "bench": "/path/to/hypersage/benchmarks/trace_runs",
  "runs": [
    { "id": "v1", "label": "Pre-fix baseline", "date": "2026-06-28",
      "answers": "answers_merged.jsonl",       "evals": "merged_eval/evals.jsonl",  "note": "…" },
    { "id": "v2", "label": "Post-fix (deploy #1113)", "date": "2026-06-29",
      "answers": "answers_full_v2_dedup.jsonl", "evals": "full_v2_eval/evals.jsonl", "note": "…" }
  ]
}
```

**To add a new run** (e.g. after the next round of fixes): append an entry to `runs.json`, bump
`latest`, and regenerate. Runs are joined per test by `unit_id`, so any query present in multiple runs
gets a per-test delta automatically.

## Regenerate the data

`data.js` is committed so the site is self-contained. Rebuild it from the manifest:

```
python3 generate_data.py                 # reads ./runs.json
```

For each run it joins the answers JSONL (query, trace answer, dev Slack replies) with the evals JSONL
(per-parameter scores + rationale) into `window.REPORT = { meta, runsData, tests }`, where each test
carries its per-run entries under `runs: { <run_id>: {…} }`.

## Layout

```
runs.json           run manifest (declares the runs shown)
index.html          analytics / results + cross-run trend
tests.html          per-test list (+ Δ) + version-compare modal
data.js             window.REPORT = { meta, runsData, tests }  (generated, committed)
generate_data.py    rebuilds data.js from the manifest
assets/
  styles.css        styling
  app.js            run selector, trend, search/filter/sort, version modal
  marked.min.js     vendored Markdown renderer (offline)
```

## Note

The dataset embeds internal Slack message content (queries, dev replies) and HyperSage's answers,
for side-by-side comparison. Keep the repo's visibility appropriate to that content.
