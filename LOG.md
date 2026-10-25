# Build log

## 2026-10-25: Plan
Idea: an agent that uses quant statistics on past and current price data to suggest the
lowest-risk stock to buy.

Scoped down to fit one day:
- Shape: a Python script that runs Claude Code headless (`claude -p`) as one step. It runs on the
  class's Claude Code access, so no paid API key is needed.
- Split: code does the data and math, Claude does the judgment and the explanation, and code
  verifies Claude's answer. Hard risk limits stay in code.
- "Best stock" became "rank a watchlist by risk-adjusted past statistics". Prediction isn't
  something these statistics can honestly claim, so a backtest checks whether the ranking helps at all.

## 2026-10-25: Build
- Data: tried Stooq CSVs first, but they now sit behind a JavaScript bot check. Switched to `yfinance`.
- `quant.py`: 10 metrics per ticker (annualized return, volatility, Sharpe, Sortino, max drawdown,
  1-day 95% VaR, beta vs SPY, 3m and 6m momentum, above the 200-day average). Data is sliced at `as_of`
  to avoid look-ahead.
  - Change: first version had `mom_12m`, which exactly duplicated `ann_return` (both 252 days).
    Replaced it with `mom_6m`.
  - Checked the betas because some were negative (KO, XOM, VZ). The correlations with SPY over the
    window are also negative, so the numbers are right; it's the data.
- `baseline_ranking()`: weighted rank average with no model, used as a control.
- `analyst.py`: risk rules filter, then prompt, `claude -p`, `validate()`, and a retry loop that
  feeds the errors back. Disabled all tools with `--tools ""` so the model only sees the prompt.
  Chose to validate the reply myself instead of using `--json-schema`, because the important check
  (cited numbers match the data) can't be expressed in a schema anyway.
- `test_analyst.py`: 5 tests with fake replies (made-up number, ineligible ticker, duplicate ranks,
  retry). All pass.
- `backtest.py`: monthly replays with a 21-trading-day hold.
  - Change: `scout.py` was ranking the baseline over every ticker, while the backtest only used
    eligible ones. Made both use the eligible list.

## 2026-10-25: First results (baseline only)
Low risk, top 3, 12 months: baseline +2.8% average per month vs SPY +1.0%, and it beat SPY in 8 of 12
months. Its worst month (-5.2%) was slightly worse than SPY's worst (-5.0%). It mostly picked
JNJ and KO, so it is really a defensive-stocks tilt during a year when those did well.
That's one period, not evidence of skill.

## 2026-10-25: Getting the CLI to run
- `claude -p` first failed with "Not logged in". Logging in took a few tries: the setup commands were
  written in Bash syntax but the terminal was PowerShell, and the Claude desktop app is a packaged
  Windows app, so `claude.exe` really lives under `AppData\Local\Packages\Claude_...\LocalCache\Roaming\...`.
  Running `& "<that path>\claude.exe" auth login` and signing in in the browser fixed it.
- In PowerShell, point the script at the CLI with `$env:CLAUDE_BIN = '<path>'` before `python scout.py`.

## 2026-10-25: First Claude run (low risk, as of 2026-10-23)
- Eligible after the risk rules: AAPL, COST, JNJ, JPM, KO, PG, TLT, XOM.
- Claude picked **KO, JNJ, AAPL** and avoided XOM, TLT and COST. Validation passed on the first
  attempt. It took 14.3 s, and the CLI reported $0.068 (an estimate of the equivalent API price;
  this ran on Claude Code access, not a paid key).
- The plain-code baseline picked KO, JNJ, **XOM**, so they agree on 2 of 3. The difference is interesting:
  the baseline likes XOM's top Sharpe (2.31), but Claude rejected it for a low-risk investor because it has
  the deepest drawdown, worst VaR and highest volatility in the eligible set. That's the kind of trade-off
  judgment I wanted the model for.
- Hand check: Claude's comparison claims ("deepest drawdown", "second highest volatility") were all true.
  But `validate()` only checks the *numbers* it cites, not words like "highest" or "deepest". That's a gap a
  future check could close by verifying rank claims against the table.

## Next
- Run `backtest.py --with-model` (12 Claude calls) to see whether Claude's picks beat the baseline over time.
- Add a check for comparison claims ("highest", "lowest", "deepest") in `validate()`.
