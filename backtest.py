"""Replay past months: did the picks beat SPY over the next month?

    python backtest.py                     # plain-code baseline only (free, fast)
    python backtest.py --with-model        # also ask Claude each month (one claude -p call per month)

Each month uses only data available on that date, then measures the next
`--hold` trading days. Caveat: Claude may remember real prices from training,
so its backtest can look better than it would live.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

import analyst
import quant
from scout import REPORTS, ROOT, read_watchlist


def month_starts(prices: pd.DataFrame, months: int, hold: int) -> list[str]:
    """First trading day of each recent month that still has `hold` days after it."""
    usable = prices.index[: len(prices) - hold]
    firsts = pd.Series(usable, index=usable).groupby(usable.to_period("M")).first()
    return [d.date().isoformat() for d in firsts.iloc[-months:]]


def avg_forward(prices, tickers, as_of, hold):
    rets = [quant.forward_return(prices, t, as_of, hold) for t in tickers]
    rets = [r for r in rets if r is not None]
    return sum(rets) / len(rets) if rets else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--risk", choices=analyst.RISK_LEVELS, default="low")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--months", type=int, default=12)
    ap.add_argument("--hold", type=int, default=21, help="trading days held after each pick")
    ap.add_argument("--with-model", action="store_true")
    ap.add_argument("--model")
    args = ap.parse_args()

    tickers = read_watchlist(ROOT / "watchlist.txt")
    start = (date.today() - timedelta(days=365 * 3)).isoformat()
    prices = quant.load_prices(tickers, start, (date.today() + timedelta(days=1)).isoformat())

    rows = []
    for as_of in month_starts(prices, args.months, args.hold):
        metrics = quant.compute_metrics(prices, as_of)
        eligible = analyst.eligible_tickers(metrics, args.risk)
        base = [t for t in quant.baseline_ranking(metrics, args.risk) if t in eligible][: args.top]
        row = {
            "as_of": as_of,
            "spy": quant.forward_return(prices, quant.BENCHMARK, as_of, args.hold),
            "eligible_eq_wt": avg_forward(prices, eligible, as_of, args.hold),
            "baseline": avg_forward(prices, base, as_of, args.hold),
            "baseline_picks": " ".join(base),
        }
        if args.with_model:
            print(f"{as_of}: asking Claude...", flush=True)
            res = analyst.analyze(metrics, args.risk, as_of, args.top, model=args.model)
            picks = [p["ticker"] for p in sorted(res["answer"]["picks"], key=lambda p: p["rank"])]
            row["model"] = avg_forward(prices, picks, as_of, args.hold)
            row["model_picks"] = " ".join(picks)
            row["model_attempts"] = len(res["attempts"])
        rows.append(row)
        print(f"{as_of}: baseline {base}", flush=True)

    df = pd.DataFrame(rows).set_index("as_of")
    strategies = [c for c in ("spy", "eligible_eq_wt", "baseline", "model") if c in df]
    summary = pd.DataFrame({
        "avg_monthly": df[strategies].mean(),
        "worst_month": df[strategies].min(),
        "months_beating_spy": [(df[s] > df["spy"]).sum() for s in strategies],
        "compounded": (1 + df[strategies]).prod() - 1,
    }).round(4)

    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / f"backtest_{args.risk}{'_model' if args.with_model else ''}.md"
    text = "\n".join([
        f"# Backtest: {args.risk} risk, top {args.top}, hold {args.hold} trading days, {len(df)} months", "",
        "> Small sample, no trading costs, and the model may remember real prices. Treat as a sanity check, not proof.", "",
        "## Summary", "", summary.to_markdown(), "",
        "## By month", "", df.round(4).to_markdown(), "",
    ])
    path.write_text(text, encoding="utf-8")
    print("\n" + text + f"\nSaved {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
