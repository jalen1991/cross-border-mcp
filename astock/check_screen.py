"""Replay past signal days through the live screener and compare with the backtest.

The live path builds today's bar from a quote snapshot and appends it to cached
history; the backtest computes everything from stored bars. Both must agree on
which stocks fire, otherwise the backtest is not testing what gets traded.

python3 -m astock.check_screen 2024-02-06 2026-11-05
"""
from __future__ import annotations

import glob
import os
import sys

import pandas as pd

from . import backtest as bt
from . import data
from .run import live_signals
from .strategy import REBOUND, signal_mask


def fake_snapshot(day: str) -> pd.DataFrame:
    # Names are left blank: today's names (e.g. a later *ST tag) did not apply on `day`.
    rows = []
    for path in glob.glob(os.path.join(data.KLINE_DIR, "*.csv")):
        code = os.path.basename(path)[:-4]
        k = pd.read_csv(path)
        bar = k[k["date"] == day]
        if bar.empty:
            continue
        b = bar.iloc[0]
        rows.append({"code": code, "name": "", "price": b["close"], "pct": b["pct"],
                     "open": b["open"], "high": b["high"], "low": b["low"], "volume": b["volume"],
                     "amount": b["amount"], "turnover": b["turnover"]})
    return pd.DataFrame(rows)


def main(days: list[str]) -> int:
    panel = bt.build_panel()
    bad = 0
    for day in days:
        live = set(live_signals(fake_snapshot(day), day, REBOUND)["code"])
        p = panel[panel["date"] == day]
        back = set(p[signal_mask(p, REBOUND)]["code"])
        only_live, only_back = live - back, back - live
        print(f"{day}: live={len(live)} backtest={len(back)} common={len(live & back)} "
              f"only_live={sorted(only_live)} only_backtest={sorted(only_back)}")
        bad += len(only_live) + len(only_back)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["2024-02-06", "2026-11-05"]))
