"""Quant Scout: rank a watchlist by risk-adjusted stats, with Claude as the analyst.

    python scout.py                         # low-risk picks as of the latest close
    python scout.py --risk medium --top 5
    python scout.py --as-of 2026-03-02      # replay a past date
    python scout.py --baseline-only         # skip the model, plain-code ranking only

Educational tool. Past statistics do not predict future returns; not financial advice.
"""
from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

import analyst
import quant

ROOT = Path(__file__).parent
REPORTS = ROOT / "reports"


def read_watchlist(path: Path) -> list[str]:
    lines = path.read_text().splitlines()
    return [l.strip().upper() for l in lines if l.strip() and not l.startswith("#")]


def price_window(as_of: str | None) -> tuple[str, str]:
    end = date.today() + timedelta(days=1)
    anchor = date.fromisoformat(as_of) if as_of else end
    return (anchor - timedelta(days=550)).isoformat(), end.isoformat()


def fmt_pct(x: float) -> str:
    return f"{x * 100:+.1f}%"


def render_report(as_of: str, risk: str, metrics: pd.DataFrame, baseline: list[str], result: dict | None) -> str:
    out = [f"# Quant Scout report: {risk} risk, as of {as_of}", "",
           "> Educational screen built from historical prices. Past statistics do not predict "
           "future returns. Not financial advice.", ""]
    if result:
        ans = result["answer"]
        out += ["## Claude's picks", ""]
        for p in sorted(ans["picks"], key=lambda p: p["rank"]):
            row = metrics.loc[p["ticker"]]
            out += [f"### {p['rank']}. {p['ticker']}",
                    f"Sharpe {row.sharpe:.2f} · vol {fmt_pct(row.ann_vol)} · max drawdown {fmt_pct(row.max_drawdown)} · 3m {fmt_pct(row.mom_3m)}",
                    "", p["thesis"], "",
                    "Evidence (checked against the data): " + ", ".join(f"`{e['metric']}={e['value']}`" for e in p["evidence"]),
                    "", f"**Main risk:** {p['main_risk']}", ""]
        if ans.get("avoid"):
            out += ["## Avoided", ""] + [f"- **{a['ticker']}**: {a['reason']}" for a in ans["avoid"]] + [""]
        out += ["## Summary", "", ans["summary"], ""]
        out += ["## Model run", "", f"Eligible after risk rules: {', '.join(result['eligible'])}", ""]
        for a in result["attempts"]:
            status = "passed" if not a["errors"] else "rejected: " + "; ".join(a["errors"])
            out.append(f"- Attempt {a['attempt']}: {a['seconds']}s, ${a['cost_usd'] or 0:.4f}, {status}")
        out.append("")
        model_top = [p["ticker"] for p in sorted(ans["picks"], key=lambda p: p["rank"])]
        agree = len(set(model_top) & set(baseline[:len(model_top)]))
        out += [f"Plain-code baseline top {len(model_top)}: {', '.join(baseline[:len(model_top)])} "
                f"(overlap with Claude: {agree}/{len(model_top)})", ""]
    else:
        out += ["## Plain-code baseline ranking", "", ", ".join(baseline), ""]
    out += ["## All metrics", "", metrics.to_markdown(), ""]
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--risk", choices=analyst.RISK_LEVELS, default="low")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--as-of", help="YYYY-MM-DD; defaults to the latest close")
    ap.add_argument("--watchlist", type=Path, default=ROOT / "watchlist.txt")
    ap.add_argument("--model", help="Claude model alias passed to claude -p (e.g. sonnet)")
    ap.add_argument("--baseline-only", action="store_true", help="skip the model")
    args = ap.parse_args()

    tickers = read_watchlist(args.watchlist)
    prices = quant.load_prices(tickers, *price_window(args.as_of))
    as_of = args.as_of or prices.index[-1].date().isoformat()
    metrics = quant.compute_metrics(prices, as_of)
    eligible = analyst.eligible_tickers(metrics, args.risk)
    baseline = [t for t in quant.baseline_ranking(metrics, args.risk) if t in eligible]

    result = None
    if not args.baseline_only:
        print(f"Asking Claude to rank {len(metrics)} tickers ({args.risk} risk, as of {as_of})...")
        result = analyst.analyze(metrics, args.risk, as_of, args.top, model=args.model)

    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"{as_of}_{args.risk}"
    report = render_report(as_of, args.risk, metrics, baseline, result)
    stem.with_suffix(".md").write_text(report, encoding="utf-8")
    if result:
        stem.with_suffix(".json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(report)
    print(f"\nSaved {stem.with_suffix('.md').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
