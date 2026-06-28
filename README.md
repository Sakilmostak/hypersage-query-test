# HyperSage Trace — Evaluation Report

A self-contained static site visualizing an LLM-judge evaluation of HyperSage's **trace**
(payment-failure diagnosis) agent on real Slack incident queries.

Each conversation that was deemed useful for the trace agent was replayed through the deployed
HyperSage instance; the answer it produced was scored **1–5** on five parameters — **accuracy,
relevancy, completeness, safety, reasoning** — by an LLM judge, comparing it against the dev team's
actual Slack-thread resolution.

## Headline

| Group | Overall (/5) | n |
|-------|:---:|:---:|
| **Synthesized** (trace reached a conclusion) | **2.98** | 201 |
| No-conclusive (safely reported "no data") | 2.73 | 96 |
| All completed | 2.90 | 297 |

~30% of synthesized answers score ≥4/5. Safety is consistently high (~4.5); the gap is in
evidence-backed completeness/reasoning. (Up from a degraded-state baseline of ~2.6 before the
trace fixes — synthesis-timeout, DB pool, and graceful no-conclusive handling.)

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
