# Backtest: low risk, top 3, hold 21 trading days, 12 months

> Small sample, no trading costs, and the model may remember real prices. Treat as a sanity check, not proof.

## Summary

|                |   avg_monthly |   worst_month |   months_beating_spy |   compounded |
|:---------------|--------------:|--------------:|---------------------:|-------------:|
| spy            |        0.01   |       -0.0499 |                    0 |       0.1186 |
| eligible_eq_wt |        0.0179 |       -0.0366 |                    7 |       0.2251 |
| baseline       |        0.0276 |       -0.0516 |                    8 |       0.368  |

## By month

| as_of      |     spy |   eligible_eq_wt |   baseline | baseline_picks   |
|:-----------|--------:|-----------------:|-----------:|:-----------------|
| 2025-10-01 |  0.017  |           0.0022 |     0.0233 | GLD JNJ TLT      |
| 2025-11-03 |  0.0008 |           0.0329 |     0.0692 | GLD JNJ KO       |
| 2025-12-01 |  0.0054 |          -0.0086 |    -0.0012 | GLD KO JNJ       |
| 2026-01-02 |  0.0093 |           0.12   |     0.1257 | GLD JNJ KO       |
| 2026-02-02 | -0.0148 |           0.0692 |     0.07   | JNJ KO GLD       |
| 2026-03-02 | -0.0499 |          -0.0167 |    -0.0315 | JNJ KO TLT       |
| 2026-04-01 |  0.0998 |           0.0141 |     0.0062 | JNJ KO WMT       |
| 2026-05-01 |  0.054  |          -0.0366 |    -0.0516 | JNJ KO WMT       |
| 2026-06-01 | -0.0143 |           0.0221 |     0.0603 | JNJ KO TLT       |
| 2026-07-01 |  0.0017 |           0.0385 |     0.0454 | JNJ KO AAPL      |
| 2026-08-03 |  0.0054 |           0.0132 |     0.0303 | JNJ KO JPM       |
| 2026-09-01 |  0.0054 |          -0.0353 |    -0.0153 | KO JNJ AAPL      |
