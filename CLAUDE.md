# Quant Scout: the model's contract

## What the model is responsible for
Only this, in `analyst.build_prompt()` / `analyst.call_claude()`:
- Read a metrics table for the tickers that already passed the risk rules.
- Choose and rank the top N for the stated risk level.
- For each pick, write a short thesis, cite at least 2 metrics with values copied from the table,
  and name the main risk.
- Optionally list up to 3 eligible tickers it would avoid, then write a short summary.

The model runs as `claude -p --output-format json --tools "" --no-session-persistence`.
It has no tools, so it can't browse, read files, or fetch prices. All it ever sees is the prompt.

## What the surrounding code checks (`analyst.validate()`)
- The reply parses as a JSON object (code fences are tolerated).
- There are exactly N picks with ranks 1..N and no repeated tickers.
- Every picked or avoided ticker is in the eligible list, and no ticker is both picked and avoided.
- Each pick has a thesis, a main risk, and at least 2 evidence items.
- Every evidence metric is a known metric, and its value matches the real number
  (within 0.005 absolute or 2% relative). This catches made-up statistics.

If validation fails, the errors are appended to the prompt and the model tries again (up to 3 attempts).
Each attempt's time, cost, and errors are saved in the report, so a failure can be traced
to either the model or the code.

## What the model is never trusted with
- Arithmetic: all statistics come from `quant.py`.
- Risk limits: `RISK_RULES` filters tickers before the model sees them.
- Look-ahead: `compute_metrics()` slices data at `as_of`.

## The web page (docs/)
- `docs/quant.js` must give the same numbers as `quant.py` and `analyst.eligible_tickers`. Any change to a
  formula, a risk rule or a weight has to be made in both, and `python check_js.py` must print MATCH.
- Tied baseline scores rank alphabetically in both versions.
- Claude's picks on the page come only from `docs/data.json` (written by `publish.py` after `validate()`
  passes). The page never calls a model.

## Conventions for agents working in this repo
- Keep the model's part small. New logic goes in code unless it needs judgment or language.
- Any new field the model returns must get a check in `validate()` and a test in `test_analyst.py`.
- Record plans and changes in `LOG.md`.
