"""CLI.

python3 -m astock.run download          # re-fetch all daily bars, rebuild the panel (after 15:30)
python3 -m astock.run backtest          # in-sample / out-of-sample report + stress tests
python3 -m astock.run tune              # parameter grid scored on the in-sample window only
python3 -m astock.run screen            # live signal; run at ~14:45-14:50 on a trading day
"""
from __future__ import annotations

import argparse
import itertools
import os
from dataclasses import replace

import pandas as pd

from . import backtest as bt
from . import data
from .strategy import CLASSIC, REBOUND, Params, features, score, signal_mask

IS_START, IS_END = "2021-07-01", "2024-06-30"
OOS_START = "2024-07-01"


def _line(panel, prm, start=IS_START, end=None) -> str:
    return bt.fmt(bt.metrics(*bt.run(panel, prm, start, end)))


def cmd_backtest(prm: Params) -> None:
    panel = bt.build_panel()
    print("params:", prm.to_dict())
    print(f"data: {panel['code'].nunique()} stocks, {panel['date'].min():%Y-%m-%d}..{panel['date'].max():%Y-%m-%d}\n")
    for label, s, e in (("in-sample ", IS_START, IS_END), ("out-sample", OOS_START, None)):
        b = bt.benchmark(s, e)
        print(f"{label} {s}..{e or 'now':10}  {_line(panel, prm, s, e)}")
        print(f"{'':33}上证指数 total={b['total_return']:+.1%}  MDD={b['max_drawdown']:.1%}")

    picks, daily = bt.run(panel, prm, IS_START)
    print("\nby year:")
    for y, g in picks.groupby(picks["date"].dt.year):
        print(f"  {y}  {bt.fmt(bt.metrics(g, daily[daily.index.year == y]))}")

    print("\nsignal days (breadth = stocks firing that day; ret = mean net return of trades taken):")
    ep = picks.groupby("date").agg(breadth=("breadth", "first"), trades=("ret", "size"), ret=("ret", "mean"))
    print(ep.assign(ret=lambda x: x["ret"].map("{:+.2%}".format)).to_string())

    print("\nstress tests (full period):")
    tests = [
        ("buy next open (late fill)", replace(prm, entry="next_open")),
        ("hold 5 days", replace(prm, hold_days=5)),
        ("no stop-loss", replace(prm, stop_loss=-9.9)),
        ("breadth >= 5", replace(prm, min_breadth=5)),
        ("breadth >= 20", replace(prm, min_breadth=20)),
        ("rank by depth", replace(prm, rank_by="depth")),
        ("float mcap >= 30亿", replace(prm, mcap_min=30e8)),
    ]
    for name, p2 in tests:
        print(f"  {name:26} {_line(panel, p2)}")
    base_slip = bt.SLIPPAGE
    try:
        bt.SLIPPAGE = 0.003
        print(f"  {'slippage 0.3% per side':26} {_line(panel, prm)}")
    finally:
        bt.SLIPPAGE = base_slip
    print(f"\nbaseline 经典尾盘埋伏 (full period): {_line(panel, CLASSIC)}")


def cmd_tune(prm: Params) -> None:
    panel = bt.build_panel()
    grid = dict(min_breadth=[5, 10, 20], max_positions=[5, 10], hold_days=[3, 5], rank_by=["depth", "pct"])
    rows = []
    for vals in itertools.product(*grid.values()):
        kw = dict(zip(grid, vals))
        p = replace(prm, top_n=kw["max_positions"], **kw)
        a = bt.metrics(*bt.run(panel, p, IS_START, IS_END))
        b = bt.metrics(*bt.run(panel, p, OOS_START))
        rows.append({**kw, "IS_sharpe": a.get("sharpe", 0), "IS_cagr": a.get("cagr", 0),
                     "IS_mdd": a.get("max_drawdown", 0), "OOS_sharpe": b.get("sharpe", 0),
                     "OOS_cagr": b.get("cagr", 0), "OOS_mdd": b.get("max_drawdown", 0)})
    df = pd.DataFrame(rows).sort_values("IS_sharpe", ascending=False)
    pd.set_option("display.width", 200)
    print("ranked by IN-SAMPLE sharpe; OOS columns are for checking, not for choosing")
    print(df.to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    print(f"\nconfigs with OOS CAGR > 0: {(df['OOS_cagr'] > 0).mean():.0%}")


def live_signals(snap: pd.DataFrame, today: str, prm: Params) -> pd.DataFrame:
    """Evaluate the entry rule on today's quotes appended to the cached history
    (which must end at the previous session)."""
    snap = snap[~snap["name"].str.upper().str.contains("ST|退", na=False) & (snap["price"] > 0)]
    pre = snap[snap["pct"].between(prm.pct_min, prm.pct_max) & (snap["amount"] >= prm.amount_min)]
    rows = []
    for r in pre.itertuples():
        path = os.path.join(data.KLINE_DIR, f"{r.code}.csv")
        if not os.path.exists(path):
            continue
        hist = pd.read_csv(path)
        hist = hist[hist["date"] < today].tail(150)
        if len(hist) < prm.min_listed_days:
            continue
        bar = {"date": today, "open": r.open, "close": r.price, "high": r.high, "low": r.low,
               "volume": r.volume, "amount": r.amount, "amplitude": 0.0, "pct": r.pct,
               "chg": 0.0, "turnover": r.turnover}
        f = features(pd.concat([hist, pd.DataFrame([bar])], ignore_index=True), r.code).iloc[[-1]].copy()
        f["is_st"], f["mkt_ok"], f["name"] = False, True, r.name
        if signal_mask(f, prm).iloc[0]:
            rows.append(f)
    if not rows:
        return pd.DataFrame()
    out = pd.concat(rows)
    out["score"] = score(out, prm)
    return out.sort_values("score", ascending=False)


def cmd_screen(prm: Params) -> None:
    """Live signal. Run `download` after each close so the cache ends at the previous session."""
    now = pd.Timestamp.now(tz="Asia/Shanghai")
    snap = data.snapshot(min_pct=prm.pct_min)
    out = live_signals(snap, now.strftime("%Y-%m-%d"), prm)
    breadth = len(out)
    print(f"{now:%Y-%m-%d %H:%M} 北京时间  涨幅>={prm.pct_min}%: {int((snap['pct'] >= prm.pct_min).sum())} 只  "
          f"超跌放量反弹信号={breadth}  (开仓门槛 >= {prm.min_breadth})")
    if breadth == 0:
        print("今天没有信号，空仓。")
        return
    cols = ["code", "name", "close", "pct", "dist_ma60", "vol_ratio", "turnover", "float_mcap"]
    show = out[cols].assign(dist_ma60=lambda x: x["dist_ma60"].map("{:+.1%}".format),
                            float_mcap=lambda x: (x["float_mcap"] / 1e8).round(1))
    print(show.head(max(prm.top_n, 20)).to_string(index=False))
    if breadth < prm.min_breadth:
        print(f"\n信号数 {breadth} < {prm.min_breadth}：属于零星超跌反弹，回测中扣费后没有优势，今天不开仓。")
        return
    print(f"\n触发：尾盘买入前 {prm.top_n} 只，每只 1/{prm.max_positions} 仓位（已有持仓占用的仓位不再补）。")
    print(f"卖出：持有 {prm.hold_days} 个交易日后尾盘卖出；期间收盘跌破 {prm.stop_loss:.0%} 提前尾盘止损。")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["download", "backtest", "tune", "screen"])
    a = ap.parse_args()
    prm = REBOUND
    if a.cmd == "download":
        data.download_all(refresh=True)
        bt.build_panel(refresh=True)
    elif a.cmd == "backtest":
        cmd_backtest(prm)
    elif a.cmd == "tune":
        cmd_tune(prm)
    else:
        cmd_screen(prm)


if __name__ == "__main__":
    main()
