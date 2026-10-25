"""Check that docs/quant.js gives the same numbers as quant.py (needs Node.js).

    python check_js.py
"""
import json
import subprocess
import sys

import pandas as pd

import analyst
import quant
from scout import ROOT

data = json.loads((ROOT / "docs" / "data.json").read_text(encoding="utf-8"))
prices = pd.DataFrame(data["close"], index=pd.to_datetime(data["dates"]))
tickers = data["tickers"]
dates = [data["dates"][i] for i in (300, 450, 600, len(data["dates"]) - 1)]

js = r"""
const Q = require("./docs/quant.js");
const data = JSON.parse(require("fs").readFileSync("docs/data.json", "utf8"));
const out = {};
for (const d of %s) {
  const i = data.dates.indexOf(d);
  const m = Q.computeMetrics(data, data.tickers, i);
  out[d] = { metrics: m };
  for (const r of ["low", "medium", "high"]) {
    const ok = Q.eligible(m, r);
    out[d][r] = { eligible: ok, ranking: Q.baselineRanking(m, r).filter(t => ok.includes(t)) };
  }
}
out.backtest = {};
for (const r of ["low", "medium", "high"]) out.backtest[r] = Q.backtest(data, data.tickers, r).baseline;
console.log(JSON.stringify(out));
""" % json.dumps(dates)
res = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True, cwd=ROOT).stdout)

problems = 0
for d in dates:
    py = quant.compute_metrics(prices, d)
    for t in tickers:
        for m in quant.METRIC_DESCRIPTIONS:
            a, b = float(py.at[t, m]), res[d]["metrics"][t][m]
            if abs(a - b) > 1.5e-4:
                problems += 1
                print(f"{d} {t} {m}: python {a} js {b}")
    for r in analyst.RISK_LEVELS:
        ok = analyst.eligible_tickers(py, r)
        rank = [t for t in quant.baseline_ranking(py, r) if t in ok]
        if ok != res[d][r]["eligible"] or rank != res[d][r]["ranking"]:
            problems += 1
            print(f"{d} {r}: python {rank} js {res[d][r]['ranking']}")

print(f"Compared {len(dates)} dates x {len(tickers)} tickers x 10 metrics, plus eligibility and ranking for 3 risk levels.")
print(f"JS backtest (baseline avg/month): " + ", ".join(f"{r} {res['backtest'][r]['avg']:+.4f}" for r in analyst.RISK_LEVELS))
print("MATCH" if not problems else f"{problems} MISMATCHES")
sys.exit(1 if problems else 0)
