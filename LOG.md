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

## 2026-10-25: Project page
- Added `docs/index.html`, a single-file GitHub Pages site styled like a Roblox game page: a blocky
  hero scene, a green Play button, and tabs for About (Team Code vs Team Claude, the pipeline as
  "obby stages"), Badges (Claude's picks), Leaderboard (backtest) and How to play.
- Used the look but not Roblox's logo or name: the corner mark is a generic studded brick.
- Checked it at desktop and phone width (no sideways scrolling).

## 2026-10-25: Full test pass
- Live page: all 4 tabs, the top-bar links, the Play button and arrow-key tab switching work; no
  console errors; every link returns 200.
- Bug found and fixed: on a 375px phone the How to play tab was 493px wide because long code lines
  stretched the grid column. Added `min-width: 0` so the code boxes scroll inside themselves.
- Fresh clone from GitHub, following the How to play steps: install, tests (5/5), `scout.py` with
  `--risk medium --top 5`, `--as-of 2026-03-02`, and `backtest.py --risk high` all ran.
- High-risk backtest (momentum-weighted): +0.1% a month, -0.4% over 12 months, worst month -7.2%,
  versus SPY at +11.9%. Chasing momentum lost in this period, while the low-risk tilt won.
- Claude at medium risk, top 5: XOM, KO, JNJ, AAPL, JPM, which matches the baseline 5/5 (only the order differs).
  It passed on try 1 in 19.9 s. XOM went from "avoided" at low risk to #1 at medium risk, which shows the
  risk level actually changes its judgment. Spot-checked its claims and they hold.

## 2026-10-25: Playable in the browser
Goal: let people who don't use terminals play it from GitHub Pages.
- Constraint: Pages is static, so it can't run Python or `claude -p`, and putting a key or login in a public
  page would let anyone use it. Yahoo also blocks requests from other sites' pages.
- Plan: move the math to the browser and keep Claude as a snapshot.
  - `publish.py` writes `docs/data.json` (3 years of prices, 122 KB) and runs Claude once per risk level.
    All three passed validation on try 1 (14.5 s, 13.4 s, 16.6 s). Picks: low KO, JNJ, AAPL; medium KO,
    JNJ, XOM; high XOM, KO, AAPL.
  - `docs/quant.js` ports the stats, risk rules, baseline ranking and backtest.
  - `docs/app.js` adds a Play tab (risk buttons, squad chips, a time-travel slider, a podium, "peek at the
    future", Claude's call, the risk gate, a stats table). Badges, Leaderboard and the header stats are now
    built from `data.json`, so they update whenever the snapshot is republished.
  - Claude's call only shows for the date and full squad it was made on; otherwise it shows a locked card
    with a "Jump to Claude's day" button, so the page never pretends Claude ranked something it didn't.
- `check_js.py` compares JS against Python on 4 dates x 16 stocks x 10 stats, plus eligibility and ranking
  for 3 risk levels.
  - First run: every stat matched, but 3 rankings differed. Cause: exact score ties (TLT and PG both scored
    1.40625), and pandas breaks ties in an arbitrary order. Fixed by ranking ties alphabetically in both
    versions. Now prints MATCH.
  - Side effect: one April 2026 tie now breaks the other way, so the low-risk backtest is +2.6% a month
    (+34.1% over 12 months) instead of the +2.8% / +36.8% recorded earlier. It still beats SPY in 8 of 12 months.
- Tested every control in the browser: risk switching, the slider, benching stocks (with a 3-stock minimum),
  Claude locking and unlocking, and every tab at desktop and 375px phone width. No console errors.
  Fixed: dim risk buttons were hard to read, the Medium icon wrapped differently, a duplicate
  "Team Claude" label, and "these 3" showing when only 2 stocks passed the gate.

## 2026-10-25: Bring your own data set
Goal: let visitors play with their own prices instead of the built-in 16 stocks.
- `docs/dataset.js` parses a CSV in the browser (the file is never uploaded). It accepts one column per stock
  or `Date,Ticker,Close` rows; YYYY-MM-DD or M/D/YYYY dates; comma, semicolon or tab separators; and `$` signs.
  It starts on the first day every stock has a price, carries prices forward over gaps, and explains every
  fix it makes.
- The benchmark is no longer hard-coded to SPY: the page guesses it (SPY, VOO, IVV, ^GSPC, QQQ, VTI) and
  lets you pick another column. `quant.js` and `quant.compute_metrics` both take the benchmark as input.
- The Play tab got a "Use your own data set" section (drag and drop or choose a file, a format checklist,
  a sample CSV to download, a benchmark picker, and a button to go back). Claude's card and the Badges tab
  explain that Claude hasn't seen your file and show the command to get its call: `scout.py --prices`.
- `quant.load_csv` follows the same rules in Python. On a long-format test file with US dates, semicolons,
  holes and a VOO benchmark, Python and JS agree exactly (worst difference 0.0).
- Tested with good and broken files: too short, only 2 stocks, unreadable dates, a negative price, an empty
  file, plain text, and a column named with HTML code (cleaned to letters and digits, and every name is
  escaped). Each gives a specific message. Checked at desktop and phone width with no console errors.

## Next
- Run `backtest.py --with-model` (12 Claude calls) to see whether Claude's picks beat the baseline over time.
- Add a check for comparison claims ("highest", "lowest", "deepest") in `validate()`.
