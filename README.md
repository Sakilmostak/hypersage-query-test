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
relevancy (+0.89) and completeness (+0.58); safety stays high (~4.7). The current site shows the
**after** run (290 completed, 289 synthesized).

## View it

No build step, no server, no network — just open it:

```
open index.html        # macOS
# or double-click index.html
```

- **Analytics** (`index.html`) — aggregate scores, per-parameter comparison, distribution, by-channel.
- **Tests** (`tests.html`) — every evaluated query with its overall rating; click any row to compare
  HyperSage's answer vs the dev Slack thread and read the evaluator's per-parameter rationale.

## Regenerate the data

`data.js` is committed so the site is self-contained. To rebuild it from a fresh eval run:

```
python3 generate_data.py --bench /path/to/hypersage/benchmarks/trace_runs
```

It joins `answers_merged.jsonl` (query, trace answer, dev Slack replies) with
`merged_eval/evals.jsonl` (per-parameter scores + rationale) into `window.REPORT`.

## Layout

```
index.html          analytics / results
tests.html          per-test list + comparison modal
data.js             window.REPORT = { meta, tests }  (generated, committed)
generate_data.py    rebuilds data.js from the eval outputs
assets/
  styles.css        styling
  app.js            rendering, search/filter/sort, modal
  marked.min.js     vendored Markdown renderer (offline)
```

## Note

The dataset embeds internal Slack message content (queries, dev replies) and HyperSage's answers,
for side-by-side comparison. Keep the repo's visibility appropriate to that content.
