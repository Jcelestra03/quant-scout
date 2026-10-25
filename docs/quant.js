/*
  Browser port of quant.py + the risk rules from analyst.py. Same formulas, same
  defaults, so the page shows the numbers the Python version would.
  Checked against Python by check_js.py.

  Prices come from data.json: { dates: [...], close: { TICKER: [...] }, benchmark: "SPY" }
  (or an uploaded CSV turned into the same shape by dataset.js).
  Dates are indexes into that array; `asOf` is the index of the last usable day.
*/
(function (root) {
  const TRADING_DAYS = 252;
  const RISK_FREE = 0.04;
  const BENCHMARK = "SPY";

  const METRICS = ["ann_return", "ann_vol", "sharpe", "sortino", "max_drawdown", "var_95", "beta", "mom_3m", "mom_6m", "above_sma200"];

  const RISK_RULES = {
    low: { maxDrawdownMin: -0.25, volPct: 0.5 },
    medium: { maxDrawdownMin: -0.35, volPct: 0.8 },
    high: { maxDrawdownMin: -1.0, volPct: 1.0 },
  };

  const WEIGHTS = {
    low: { sharpe: 1, sortino: 1, ann_vol: -2, max_drawdown: 2, beta: -1, mom_3m: 0.5 },
    medium: { sharpe: 2, sortino: 1, ann_vol: -1, max_drawdown: 1, mom_3m: 1 },
    high: { sharpe: 1, mom_3m: 2, mom_6m: 2, ann_return: 1 },
  };

  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => sum(a) / a.length;
  function std(a) { // sample std, like pandas
    const m = mean(a);
    return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1));
  }
  function cov(a, b) {
    const ma = mean(a), mb = mean(b);
    return sum(a.map((x, i) => (x - ma) * (b[i] - mb))) / (a.length - 1);
  }
  function quantile(a, q) { // linear interpolation, like numpy/pandas
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  const round4 = x => Math.round(x * 1e4) / 1e4;

  function returns(series) {
    const r = [];
    for (let i = 1; i < series.length; i++) r.push(series[i] / series[i - 1] - 1);
    return r;
  }

  function maxDrawdown(series) {
    let peak = -Infinity, worst = 0;
    for (const p of series) { peak = Math.max(peak, p); worst = Math.min(worst, p / peak - 1); }
    return worst;
  }

  /** Stats per ticker using only data up to index asOf. Returns {TICKER: {metric: value}}. */
  function computeMetrics(data, tickers, asOf, lookback = TRADING_DAYS) {
    if (asOf < lookback) throw new Error("not enough history before this date");
    const start = asOf - lookback;
    const bench = returns(data.close[data.benchmark || BENCHMARK].slice(start, asOf + 1));
    const out = {};
    for (const t of tickers) {
      const full = data.close[t].slice(0, asOf + 1);
      const window = full.slice(start);
      const r = returns(window);
      const annRet = Math.pow(r.reduce((p, x) => p * (1 + x), 1), TRADING_DAYS / r.length) - 1;
      const annVol = std(r) * Math.sqrt(TRADING_DAYS);
      const downside = std(r.filter(x => x < 0)) * Math.sqrt(TRADING_DAYS);
      const last = full[full.length - 1];
      const m = {
        ann_return: annRet,
        ann_vol: annVol,
        sharpe: annVol ? (annRet - RISK_FREE) / annVol : 0,
        sortino: downside ? (annRet - RISK_FREE) / downside : 0,
        max_drawdown: maxDrawdown(window),
        var_95: quantile(r, 0.05),
        beta: cov(r, bench) / cov(bench, bench),
        mom_3m: last / full[full.length - 64] - 1,
        mom_6m: last / full[full.length - 127] - 1,
        above_sma200: last > mean(full.slice(-200)) ? 1 : 0,
      };
      for (const k of METRICS) m[k] = round4(m[k]);
      out[t] = m;
    }
    return out;
  }

  /** Tickers that pass the risk rules (code decides this, never the model). */
  function eligible(metrics, risk) {
    const rule = RISK_RULES[risk];
    const names = Object.keys(metrics);
    const volCap = quantile(names.map(t => metrics[t].ann_vol), rule.volPct);
    return names.filter(t => metrics[t].max_drawdown >= rule.maxDrawdownMin && metrics[t].ann_vol <= volCap).sort();
  }

  function pctRank(values) { // pandas rank(pct=True), ties averaged
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[order[k][1]] = avg / values.length;
      i = j + 1;
    }
    return ranks;
  }

  /** Model-free ranking: weighted average of percentile ranks. Best first. */
  function baselineRanking(metrics, risk) {
    const names = Object.keys(metrics);
    const score = new Array(names.length).fill(0);
    for (const [m, w] of Object.entries(WEIGHTS[risk])) {
      pctRank(names.map(t => metrics[t][m])).forEach((r, i) => { score[i] += w * r; });
    }
    // Ties rank alphabetically (matches quant.py).
    return names.map((t, i) => [t, score[i]]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(x => x[0]);
  }

  function forwardReturn(data, ticker, asOf, days) {
    const s = data.close[ticker];
    if (asOf + days >= s.length) return null;
    return s[asOf + days] / s[asOf] - 1;
  }

  /** First trading day of each recent month that still has `hold` days after it. */
  function monthStarts(data, months, hold) {
    const firsts = [];
    let prev = "";
    for (let i = 0; i < data.dates.length - hold; i++) {
      const ym = data.dates[i].slice(0, 7);
      if (ym !== prev) { firsts.push(i); prev = ym; }
    }
    return firsts.slice(-months);
  }

  function avgForward(data, tickers, asOf, hold) {
    const r = tickers.map(t => forwardReturn(data, t, asOf, hold)).filter(x => x !== null);
    return r.length ? mean(r) : null;
  }

  /** Same replay as backtest.py, without the model. */
  function backtest(data, tickers, risk, { top = 3, months = 12, hold = 21 } = {}) {
    const rows = [];
    for (const i of monthStarts(data, months, hold)) {
      if (i < TRADING_DAYS) continue;
      const metrics = computeMetrics(data, tickers, i);
      const ok = eligible(metrics, risk);
      const picks = baselineRanking(metrics, risk).filter(t => ok.includes(t)).slice(0, top);
      rows.push({
        date: data.dates[i],
        picks,
        spy: forwardReturn(data, data.benchmark || BENCHMARK, i, hold),
        eligibleEqWt: avgForward(data, ok, i, hold),
        baseline: avgForward(data, picks, i, hold),
      });
    }
    const summarize = key => {
      const v = rows.map(r => r[key]).filter(x => x !== null);
      return {
        avg: v.length ? mean(v) : null,
        worst: v.length ? Math.min(...v) : null,
        beatSpy: rows.filter(r => r[key] !== null && r[key] > r.spy).length,
        total: v.reduce((p, x) => p * (1 + x), 1) - 1,
      };
    };
    return { rows, spy: summarize("spy"), eligibleEqWt: summarize("eligibleEqWt"), baseline: summarize("baseline") };
  }

  root.Quant = { METRICS, RISK_RULES, BENCHMARK, TRADING_DAYS, computeMetrics, eligible, baselineRanking, backtest, forwardReturn };
  if (typeof module !== "undefined") module.exports = root.Quant;
})(typeof window !== "undefined" ? window : globalThis);
