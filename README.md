# Quant Scout

CSS 490, Artifact 3 ("AI Inside It"). A stock screener in which Claude acts as the analyst.
Plain Python computes the risk and return statistics for a watchlist. Claude (run headless
with `claude -p`) ranks the stocks for a chosen risk level and explains its picks, and the code
rejects any answer whose numbers don't match the data.

**Play it in your browser:** https://jcelestra03.github.io/quant-scout/ (no install, no terminal)

The web version recalculates every stat in JavaScript (`docs/quant.js`, a port of `quant.py`) from a
price snapshot in `docs/data.json`. Claude can't run in a visitor's browser, so its picks on the page are
a dated snapshot made by `publish.py`.

> Educational project. It ranks stocks by *past* statistics, which do not predict future
> returns. It is not financial advice and it does not trade.

## How it works

```
watchlist.txt ──► quant.py ──────────► metrics table ──► analyst.py ──────────► reports/*.md
                  (yfinance prices,     (10 stats per      risk rules filter
                   stats, no model)      ticker)           ► claude -p ranks + explains
                                                           ► validate() checks it
                                                           ► retry with errors (max 3)
```

| Part | Who does it | Why |
|---|---|---|
| Download prices, compute Sharpe, volatility, drawdown, VaR, beta, momentum | Code (`quant.py`) | Arithmetic has to be exact and repeatable |
| Decide which tickers are allowed for a risk level | Code (`RISK_RULES` in `analyst.py`) | A hard limit shouldn't depend on the model obeying it |
| Weigh trade-offs, rank the top N, write a thesis and main risk for each | **Claude** | Judgment and explanation are where the model adds value |
| Check the JSON shape, ranks, eligible tickers, and that every cited number matches the data | Code (`validate()`) | Catches made-up numbers and broken output |
| Compare against a model-free ranking and replay past months | Code (`baseline_ranking`, `backtest.py`) | Shows whether the model beats simple rules |

Full contract: [CLAUDE.md](CLAUDE.md). Build history: [LOG.md](LOG.md).

## Setup

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # macOS/Linux: .venv/bin/pip
```

You also need the Claude Code CLI, logged in (run `claude` once and sign in). If `claude` isn't on your
PATH, set `CLAUDE_BIN` to the full path of the executable. No API key is needed; it runs on Claude Code access.

## Usage

```bash
python scout.py                          # low-risk top 3 as of the latest close
python scout.py --risk medium --top 5
python scout.py --as-of 2026-03-02       # replay a past date
python scout.py --baseline-only          # no model, plain-code ranking only
python backtest.py                       # 12 monthly replays, baseline vs SPY
python backtest.py --with-model          # also ask Claude each month (12 calls)
python -m unittest test_analyst          # validator tests with fake model replies
python publish.py                        # refresh the web page's prices + Claude picks (3 claude -p calls)
python check_js.py                       # check docs/quant.js matches quant.py (needs Node.js)
```

Reports are written to `reports/`. Edit `watchlist.txt` to change the stocks.

## Limitations

- Prices come from Yahoo Finance through `yfinance`, an unofficial source that can break or rate-limit.
- The statistics look backward. A low-risk score means the stock was calm over the last year, not that it will stay calm.
- Claude may remember real prices after a backtest date, which can make `--with-model` backtests look better than they would live.
- Twelve months is a small sample, and the backtest ignores trading costs and taxes.
