"""Cross-sectional factor study on the in-sample window.

For each factor, stocks are bucketed into daily deciles and the mean forward
return in excess of that day's universe average is reported. Only the
in-sample window is used so the out-of-sample period stays untouched.

python3 -m astock.research
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .backtest import build_panel
from .run import IS_END, IS_START

FACTORS = ["pct", "ret5", "ret20", "ret60", "dist_ma20", "dist_ma60", "vol_ratio",
           "turnover", "vol20", "close_pos", "upper_shadow", "float_mcap", "amount"]
HORIZONS = (1, 3, 5)


def decile_table(p: pd.DataFrame, factor: str, h: int) -> pd.Series:
    fwd = p[f"n{h}_close"] / p["close"] - 1
    ex = fwd - fwd.groupby(p["date"]).transform("mean")
    dec = p.groupby("date")[factor].transform(
        lambda s: pd.qcut(s.rank(method="first"), 10, labels=False) if s.notna().sum() >= 50 else np.nan)
    return ex.groupby(dec).mean()


def main() -> None:
    panel = build_panel()
    p = panel[(panel["date"] >= IS_START) & (panel["date"] <= IS_END)
              & ~panel["is_st"] & (panel["listed_days"] >= 120) & (panel["amount"] >= 1e8)
              & ~panel["is_limit_up"]].copy()
    print(f"in-sample rows={len(p):,}  days={p['date'].nunique()}")
    pd.set_option("display.width", 220)
    for h in HORIZONS:
        tab = pd.DataFrame({f: decile_table(p, f, h) for f in FACTORS}).T * 1e4
        tab.columns = [f"D{int(c) + 1}" for c in tab.columns]
        tab["D10-D1"] = tab["D10"] - tab["D1"]
        print(f"\nexcess fwd {h}d return by decile (bp; D1=lowest factor value)")
        print(tab.round(1).to_string())


if __name__ == "__main__":
    main()
