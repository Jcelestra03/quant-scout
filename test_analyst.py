"""Checks the validator and retry loop with fake model replies (no Claude needed).

    python -m unittest test_analyst
"""
import json
import unittest

import pandas as pd

import analyst

METRICS = pd.DataFrame({
    "ann_return": [0.34, 0.40, 0.10, 0.60],
    "ann_vol": [0.19, 0.21, 0.21, 0.45],
    "sharpe": [1.60, 1.73, 0.27, 1.24],
    "sortino": [2.97, 2.64, 0.49, 1.80],
    "max_drawdown": [-0.08, -0.11, -0.16, -0.40],
    "var_95": [-0.016, -0.019, -0.020, -0.045],
    "beta": [-0.27, -0.22, -0.08, 1.9],
    "mom_3m": [0.11, -0.003, 0.09, 0.20],
    "mom_6m": [0.15, 0.10, 0.05, 0.30],
    "above_sma200": [1.0, 1.0, 1.0, 1.0],
}, index=["KO", "JNJ", "PG", "NVDA"])


def pick(rank, ticker, **evidence):
    return {"rank": rank, "ticker": ticker, "thesis": "t", "main_risk": "r",
            "evidence": [{"metric": m, "value": v} for m, v in evidence.items()]}


GOOD = {"picks": [pick(1, "KO", sharpe=1.60, max_drawdown=-0.08), pick(2, "JNJ", sharpe=1.73, ann_vol=0.21)],
        "avoid": [{"ticker": "PG", "reason": "weak sharpe"}], "summary": "s"}


class ValidatorTests(unittest.TestCase):
    def setUp(self):
        self.eligible = analyst.eligible_tickers(METRICS, "low")

    def test_risk_rules_drop_volatile_names(self):
        self.assertNotIn("NVDA", self.eligible)

    def test_good_answer_passes(self):
        self.assertTrue(analyst.validate(GOOD, METRICS, self.eligible, 2).ok)

    def test_made_up_number_is_caught(self):
        bad = json.loads(json.dumps(GOOD))
        bad["picks"][0]["evidence"][0]["value"] = 2.5
        errs = analyst.validate(bad, METRICS, self.eligible, 2).errors
        self.assertTrue(any("cited sharpe=2.5" in e for e in errs), errs)

    def test_ineligible_and_duplicate_ranks_caught(self):
        bad = {"picks": [pick(1, "NVDA", sharpe=1.24, beta=1.9), pick(1, "KO", sharpe=1.6, beta=-0.27)],
               "avoid": [], "summary": "s"}
        errs = analyst.validate(bad, METRICS, self.eligible, 2).errors
        self.assertTrue(any("not an eligible" in e for e in errs))
        self.assertTrue(any("ranks must be" in e for e in errs))

    def test_retry_feeds_errors_back(self):
        bad = json.loads(json.dumps(GOOD))
        bad["picks"][0]["evidence"][0]["value"] = 9.9
        replies = iter(["```json\n" + json.dumps(bad) + "\n```", json.dumps(GOOD)])
        prompts = []

        def fake(prompt, model):
            prompts.append(prompt)
            return next(replies), {"seconds": 0, "cost_usd": 0, "turns": 1}

        out = analyst.analyze(METRICS, "low", "2026-10-23", top_n=2, caller=fake)
        self.assertEqual(len(out["attempts"]), 2)
        self.assertIn("rejected by the validator", prompts[1])


if __name__ == "__main__":
    unittest.main()
