"""Export a snapshot for the web page: price history plus Claude's picks per risk level.

    python publish.py                 # prices + 3 Claude runs (low, medium, high)
    python publish.py --skip-claude   # refresh prices, keep the Claude picks already in docs/data.json

Writes docs/data.json. The page (docs/quant.js) recomputes every stat in the
browser from these prices, so visitors can play without Python or a terminal.
Claude can't run in a visitor's browser, so its picks are a dated snapshot.
"""
from __future__ import annotations

import argparse
import json
from datetime import date, timedelta

import analyst
import quant
from scout import ROOT, read_watchlist

OUT = ROOT / "docs" / "data.json"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-claude", action="store_true")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--model")
    args = ap.parse_args()

    tickers = read_watchlist(ROOT / "watchlist.txt")
    start = (date.today() - timedelta(days=365 * 3)).isoformat()
    prices = quant.load_prices(tickers, start, (date.today() + timedelta(days=1)).isoformat())
    as_of = prices.index[-1].date().isoformat()

    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    claude = old.get("claude", {})
    if not args.skip_claude:
        metrics = quant.compute_metrics(prices, as_of)
        claude = {}
        for risk in analyst.RISK_LEVELS:
            print(f"Asking Claude: {risk} risk, as of {as_of}...", flush=True)
            res = analyst.analyze(metrics, risk, as_of, args.top, model=args.model)
            claude[risk] = {"as_of": as_of, **res}

    data = {
        "generated": date.today().isoformat(),
        "benchmark": quant.BENCHMARK,
        "tickers": [t for t in prices.columns if t != quant.BENCHMARK],
        "dates": [d.date().isoformat() for d in prices.index],
        "close": {t: [round(float(v), 4) for v in prices[t]] for t in prices.columns},
        "claude": claude,
    }
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, {len(data['dates'])} days, "
          f"Claude picks for: {', '.join(claude) or 'none'})")


if __name__ == "__main__":
    main()
