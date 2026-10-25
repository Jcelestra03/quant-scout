"""Plain-code half of Quant Scout: download prices and compute risk/return stats.

Nothing in this file uses a model. Every number the model sees comes from here,
so the analyst step can be checked against it.
"""
from __future__ import annotations

import logging
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")  # yfinance is noisy under pandas 3
logging.getLogger("yfinance").setLevel(logging.ERROR)

TRADING_DAYS = 252
RISK_FREE = 0.04  # annual, used for Sharpe/Sortino
BENCHMARK = "SPY"
CACHE = Path(__file__).parent / "data"

# Metrics the model is allowed to cite. Keys must match compute_metrics output.
METRIC_DESCRIPTIONS = {
    "ann_return": "annualized return over the lookback window",
    "ann_vol": "annualized volatility of daily returns",
    "sharpe": "(ann_return - 4% risk-free) / ann_vol",
    "sortino": "(ann_return - 4%) / annualized downside deviation",
    "max_drawdown": "worst peak-to-trough fall over the window (negative)",
    "var_95": "1-day historical 95% Value at Risk (negative = loss)",
    "beta": "beta vs SPY",
    "mom_3m": "price return over the last 63 trading days",
    "mom_6m": "price return over the last 126 trading days",
    "above_sma200": "1 if last close is above its 200-day average, else 0",
}


def load_prices(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    """Adjusted daily closes, one column per ticker. Cached to data/ as CSV."""
    import yfinance as yf

    CACHE.mkdir(exist_ok=True)
    wanted = sorted(set(tickers) | {BENCHMARK})
    path = CACHE / f"prices_{start}_{end}.csv"
    if path.exists():
        cached = pd.read_csv(path, index_col=0, parse_dates=True)
        if set(wanted) <= set(cached.columns):
            return cached[wanted]

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        raw = yf.download(wanted, start=start, end=end, auto_adjust=True, progress=False)
    prices = raw["Close"].dropna(how="all")
    missing = [t for t in wanted if t not in prices or prices[t].isna().all()]
    if missing:
        raise SystemExit(f"No price data for: {', '.join(missing)}")
    prices.to_csv(path)
    return prices[wanted]


def _max_drawdown(series: pd.Series) -> float:
    running_peak = series.cummax()
    return float((series / running_peak - 1).min())


def compute_metrics(prices: pd.DataFrame, as_of: str, lookback_days: int = 252) -> pd.DataFrame:
    """Stats per ticker using only data on or before `as_of` (no look-ahead)."""
    hist = prices.loc[:as_of]
    if len(hist) < lookback_days + 1:
        raise SystemExit(f"Need {lookback_days + 1} trading days before {as_of}, have {len(hist)}")

    window = hist.iloc[-(lookback_days + 1):]
    rets = window.pct_change().dropna()
    bench = rets[BENCHMARK]

    rows = {}
    for t in prices.columns:
        if t == BENCHMARK:
            continue
        r = rets[t].dropna()
        ann_ret = float((1 + r).prod() ** (TRADING_DAYS / len(r)) - 1)
        ann_vol = float(r.std() * np.sqrt(TRADING_DAYS))
        downside = float(r[r < 0].std() * np.sqrt(TRADING_DAYS))
        full = hist[t].dropna()
        rows[t] = {
            "ann_return": ann_ret,
            "ann_vol": ann_vol,
            "sharpe": (ann_ret - RISK_FREE) / ann_vol if ann_vol else 0.0,
            "sortino": (ann_ret - RISK_FREE) / downside if downside else 0.0,
            "max_drawdown": _max_drawdown(window[t]),
            "var_95": float(np.percentile(r, 5)),
            "beta": float(r.cov(bench) / bench.var()),
            "mom_3m": float(full.iloc[-1] / full.iloc[-64] - 1),
            "mom_6m": float(full.iloc[-1] / full.iloc[-127] - 1),
            "above_sma200": float(full.iloc[-1] > full.iloc[-200:].mean()),
        }
    return pd.DataFrame(rows).T.round(4)


def baseline_ranking(metrics: pd.DataFrame, risk: str = "low") -> list[str]:
    """Deterministic, model-free ranking used as a control in the backtest.

    Ranks each metric across tickers and averages the ranks. `risk` shifts the
    weights: "low" leans on volatility/drawdown, "high" leans on momentum.
    """
    weights = {
        "low": {"sharpe": 1, "sortino": 1, "ann_vol": -2, "max_drawdown": 2, "beta": -1, "mom_3m": 0.5},
        "medium": {"sharpe": 2, "sortino": 1, "ann_vol": -1, "max_drawdown": 1, "mom_3m": 1},
        "high": {"sharpe": 1, "mom_3m": 2, "mom_6m": 2, "ann_return": 1},
    }[risk]
    score = sum(w * metrics[m].rank(pct=True) for m, w in weights.items())
    return list(score.sort_values(ascending=False).index)


def forward_return(prices: pd.DataFrame, ticker: str, as_of: str, days: int) -> float | None:
    """Return from the close on (or just after) `as_of` to `days` trading days later."""
    future = prices[ticker].loc[as_of:].dropna()
    if len(future) <= days:
        return None
    return float(future.iloc[days] / future.iloc[0] - 1)
