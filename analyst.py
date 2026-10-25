"""Model half of Quant Scout: Claude ranks the stocks, plain code checks its work.

The model's job (and only job): read the metrics table, pick and rank the top N
tickers for the risk profile, and explain each pick by citing metrics.

The code's job: decide which tickers are eligible, build the prompt, call
`claude -p`, and reject any answer that breaks the contract in validate().
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field

import pandas as pd

from quant import METRIC_DESCRIPTIONS

RISK_LEVELS = ("low", "medium", "high")

# Hard limits applied by code before the model sees anything. The model can
# only choose among tickers that pass these.
RISK_RULES = {
    "low": {"max_drawdown_min": -0.25, "ann_vol_max_pct": 0.5},  # vol at or below the watchlist median
    "medium": {"max_drawdown_min": -0.35, "ann_vol_max_pct": 0.8},
    "high": {"max_drawdown_min": -1.0, "ann_vol_max_pct": 1.0},
}


def eligible_tickers(metrics: pd.DataFrame, risk: str) -> list[str]:
    rule = RISK_RULES[risk]
    vol_cap = metrics["ann_vol"].quantile(rule["ann_vol_max_pct"])
    ok = metrics[(metrics["max_drawdown"] >= rule["max_drawdown_min"]) & (metrics["ann_vol"] <= vol_cap)]
    return sorted(ok.index)


def build_prompt(metrics: pd.DataFrame, eligible: list[str], risk: str, as_of: str, top_n: int) -> str:
    definitions = "\n".join(f"- {k}: {v}" for k, v in METRIC_DESCRIPTIONS.items())
    table = metrics.loc[eligible].to_json(orient="index", indent=1)
    return f"""You are a quantitative analyst writing an educational screening report.
You only see the numbers below. Do not use outside knowledge of these companies or of
prices after {as_of}; judge purely from the metrics.

Risk profile: {risk}
Data as of: {as_of} (metrics use the prior 252 trading days)

Metric definitions:
{definitions}

Eligible tickers and their metrics (already filtered by the risk rules):
{table}

Task: choose the {top_n} best tickers for a {risk}-risk investor, ranked 1..{top_n}.
Weigh risk-adjusted return against downside (drawdown, VaR, volatility) and trend
(momentum, above_sma200). Explain trade-offs, not just the biggest number.

Reply with ONLY a JSON object, no prose and no code fences, in exactly this shape:
{{
  "picks": [
    {{
      "rank": 1,
      "ticker": "XXX",
      "thesis": "one or two sentences",
      "evidence": [{{"metric": "<metric name>", "value": <number copied from the table>}}],
      "main_risk": "one sentence on what could go wrong, grounded in the metrics"
    }}
  ],
  "avoid": [{{"ticker": "YYY", "reason": "one sentence"}}],
  "summary": "two or three sentences comparing the picks"
}}
Rules: exactly {top_n} picks; ranks 1..{top_n} with no repeats; each pick has at least
2 evidence items; every evidence value must be copied exactly from the table;
"avoid" lists 0-3 eligible tickers you rejected; a ticker cannot be both picked and avoided."""


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(0.0051, 0.02 * abs(b))


def validate(answer: dict, metrics: pd.DataFrame, eligible: list[str], top_n: int) -> ValidationResult:
    errs: list[str] = []
    picks = answer.get("picks")
    if not isinstance(picks, list):
        return ValidationResult(False, ["'picks' must be a list"])
    if len(picks) != top_n:
        errs.append(f"expected {top_n} picks, got {len(picks)}")

    ranks = [p.get("rank") for p in picks]
    if sorted(r for r in ranks if isinstance(r, int)) != list(range(1, len(picks) + 1)):
        errs.append(f"ranks must be 1..{len(picks)} with no repeats, got {ranks}")

    picked = [p.get("ticker") for p in picks]
    if len(set(picked)) != len(picked):
        errs.append(f"duplicate tickers in picks: {picked}")

    for p in picks:
        t = p.get("ticker")
        if t not in eligible:
            errs.append(f"{t} is not an eligible ticker")
            continue
        for key in ("thesis", "main_risk"):
            if not isinstance(p.get(key), str) or not p[key].strip():
                errs.append(f"{t}: missing '{key}'")
        evidence = p.get("evidence") or []
        if len(evidence) < 2:
            errs.append(f"{t}: needs at least 2 evidence items")
        for ev in evidence:
            m, v = ev.get("metric"), ev.get("value")
            if m not in METRIC_DESCRIPTIONS:
                errs.append(f"{t}: unknown metric '{m}'")
            elif not isinstance(v, (int, float)):
                errs.append(f"{t}: value for {m} is not a number")
            elif not _close(float(v), float(metrics.at[t, m])):
                errs.append(f"{t}: cited {m}={v} but actual is {metrics.at[t, m]}")

    for a in answer.get("avoid") or []:
        t = a.get("ticker")
        if t not in eligible:
            errs.append(f"avoid: {t} is not an eligible ticker")
        elif t in picked:
            errs.append(f"{t} is both picked and avoided")

    if not isinstance(answer.get("summary"), str):
        errs.append("missing 'summary'")
    return ValidationResult(not errs, errs)


def claude_bin() -> str:
    found = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
    if not found:
        raise SystemExit("Claude Code CLI not found. Put `claude` on PATH or set CLAUDE_BIN.")
    return found


def call_claude(prompt: str, model: str | None = None) -> tuple[str, dict]:
    """Run `claude -p` with no tools. Returns (model text, run info)."""
    cmd = [claude_bin(), "-p", "--output-format", "json", "--tools", "", "--no-session-persistence"]
    if model:
        cmd += ["--model", model]
    start = time.time()
    proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=300)
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"claude -p failed (exit {proc.returncode}): {(proc.stdout or proc.stderr)[:500]}")
    if envelope.get("is_error"):
        raise RuntimeError(f"claude -p error: {envelope.get('result')}")
    info = {
        "seconds": round(time.time() - start, 1),
        "cost_usd": envelope.get("total_cost_usd"),
        "turns": envelope.get("num_turns"),
    }
    return envelope.get("result", ""), info


def parse_json(text: str) -> dict:
    """Pull the JSON object out of the reply, tolerating stray code fences."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start:end + 1])


def analyze(metrics: pd.DataFrame, risk: str, as_of: str, top_n: int = 3,
            max_attempts: int = 3, model: str | None = None, caller=call_claude) -> dict:
    """Ask the model, validate, and retry with the errors until it passes."""
    eligible = eligible_tickers(metrics, risk)
    top_n = min(top_n, len(eligible))
    if top_n == 0:
        raise SystemExit(f"No tickers pass the {risk}-risk rules as of {as_of}.")

    prompt = build_prompt(metrics, eligible, risk, as_of, top_n)
    attempts = []
    for attempt in range(1, max_attempts + 1):
        text, info = caller(prompt, model)
        try:
            answer = parse_json(text)
            result = validate(answer, metrics, eligible, top_n)
        except (ValueError, json.JSONDecodeError) as e:
            answer, result = None, ValidationResult(False, [f"unparseable reply: {e}"])
        attempts.append({"attempt": attempt, **info, "errors": result.errors})
        if result.ok:
            return {"answer": answer, "eligible": eligible, "attempts": attempts}
        prompt += ("\n\nYour previous reply was rejected by the validator for these reasons:\n- "
                   + "\n- ".join(result.errors) + "\nReply again with corrected JSON only.")
    raise RuntimeError(f"Model failed validation after {max_attempts} attempts: {attempts[-1]['errors']}")
