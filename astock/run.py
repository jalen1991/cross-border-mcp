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
        ("hold 2 days", replace(prm, hold_days=2)),
        ("hold 5 days", replace(prm, hold_days=5)),
        ("take profit +10%", replace(prm, take_profit=0.10)),
        ("no stop-loss", replace(prm, stop_loss=-9.9)),
        ("no washout gate", replace(prm, min_washout=0.0)),
        ("washout >= 10%", replace(prm, min_washout=0.10)),
        ("washout >= 20%", replace(prm, min_washout=0.20)),
        ("breadth >= 10", replace(prm, min_breadth=10)),
        ("10 slots", replace(prm, max_positions=10, top_n=10)),
        ("pseudo-random ranking", replace(prm, rank_by="random")),
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


GRID = dict(min_washout=[0.0, 0.10, 0.15, 0.20], min_breadth=[3, 5, 10], max_positions=[10, 20],
            hold_days=[2, 3, 4])


def _grid(prm: Params):
    for vals in itertools.product(*GRID.values()):
        kw = dict(zip(GRID, vals))
        yield kw, replace(prm, top_n=kw["max_positions"], **kw)


def cmd_tune(prm: Params) -> None:
    panel = bt.build_panel()
    rows = []
    for kw, p in _grid(prm):
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
    for k in GRID:
        print(f"\nmedian by {k}:\n{df.groupby(k)[['IS_sharpe', 'OOS_sharpe', 'OOS_mdd']].median().round(3)}")


def cmd_walkforward(prm: Params) -> None:
    """Each calendar year is traded with the grid config that had the best Sharpe on
    all data before that year. Tests the selection process, not one lucky config."""
    panel = bt.build_panel()
    last = panel["date"].max().year
    parts, chosen = [], []
    for year in range(2023, last + 1):
        best, best_sr = None, -1e9
        for kw, p in _grid(prm):
            m = bt.metrics(*bt.run(panel, p, IS_START, f"{year - 1}-12-31"))
            if m.get("trades", 0) and m["sharpe"] > best_sr:
                best, best_sr = (kw, p), m["sharpe"]
        kw, p = best
        picks, daily = bt.run(panel, p, f"{year}-01-01", f"{year}-12-31")
        parts.append((picks, daily))
        m = bt.metrics(picks, daily) if len(picks) else {"trades": 0}
        chosen.append(f"  {year}: train sharpe={best_sr:.2f} {kw}\n        {bt.fmt(m)}")
    print("walk-forward (config re-chosen each year on prior data only):")
    print("\n".join(chosen))
    picks = pd.concat([x[0] for x in parts])
    daily = pd.concat([x[1] for x in parts])
    print(f"\nstitched 2023..{last}: {bt.fmt(bt.metrics(picks, daily))}")
    b = bt.benchmark("2023-01-01")
    print(f"上证指数 same period: total={b['total_return']:+.1%}  MDD={b['max_drawdown']:.1%}")


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


POSITIONS_PATH = os.path.join(data.DATA_DIR, "positions.csv")
POS_COLS = ["code", "name", "buy_date", "buy_price", "shares", "status", "sell_date", "sell_price"]


def load_positions() -> pd.DataFrame:
    if not os.path.exists(POSITIONS_PATH):
        return pd.DataFrame(columns=POS_COLS)
    return pd.read_csv(POSITIONS_PATH, dtype={"code": str})


def previous_washout(today: str) -> tuple[str | None, float]:
    """Washout share as of the last cached session before `today`."""
    if not os.path.exists(bt.MARKET_PATH):
        return None, 0.0
    m = pd.read_csv(bt.MARKET_PATH)
    m = m[m["date"].astype(str).str[:10] < today]
    if m.empty:
        return None, 0.0
    return str(m["date"].iloc[-1])[:10], float(m["washout"].iloc[-1])


def due_sells(pos: pd.DataFrame, today: str, prm: Params) -> pd.DataFrame:
    """Open positions to sell in today's closing minutes: held hold_days sessions, or below the stop."""
    open_pos = pos[pos["status"] == "open"]
    if open_pos.empty:
        return open_pos.assign(held=[], price=[], ret=[], action=[])
    sessions = data.fetch_kline("1.000001", "20250101")["date"]
    rows = []
    for r in open_pos.itertuples():
        held = int(((sessions > r.buy_date) & (sessions <= today)).sum())
        q = data.fetch_kline(f"{1 if r.code.startswith('6') else 0}.{r.code}", today.replace("-", ""))
        q = q[q["date"] == today]
        price = float(q["close"].iloc[0]) if len(q) else float("nan")
        ret = price / r.buy_price - 1
        locked = len(q) and q["high"].iloc[0] == q["low"].iloc[0] and q["pct"].iloc[0] < -4.5
        if held >= prm.hold_days or ret <= prm.stop_loss:
            action = "跌停封死，卖不出，明天再卖" if locked else ("到期卖出" if held >= prm.hold_days else "止损卖出")
        else:
            action = "继续持有"
        rows.append({**r._asdict(), "held": held, "price": price, "ret": ret, "action": action})
    return pd.DataFrame(rows)


def cmd_screen(prm: Params, record: bool = False, capital: float | None = None) -> None:
    """Live run at ~14:45-14:50. Needs `download` after the previous close."""
    now = pd.Timestamp.now(tz="Asia/Shanghai")
    today = now.strftime("%Y-%m-%d")
    pos = load_positions()

    sells = due_sells(pos, today, prm)
    if len(sells):
        print("== 持仓 ==")
        print(sells[["code", "name", "buy_date", "buy_price", "held", "price", "ret", "action"]]
              .assign(ret=lambda x: x["ret"].map("{:+.2%}".format)).to_string(index=False))
    selling = sells[sells["action"].isin(["到期卖出", "止损卖出"])] if len(sells) else sells
    still_open = int((pos["status"] == "open").sum()) - len(selling)
    free = prm.max_positions - still_open

    wdate, washout = previous_washout(today)
    snap = data.snapshot(min_pct=prm.pct_min)
    out = live_signals(snap, today, prm)
    breadth = len(out)
    print(f"\n{now:%Y-%m-%d %H:%M} 北京时间")
    print(f"恐慌广度（{wdate} 收盘，跌破 MA60 两成的股票占比）= {washout:.1%}  门槛 >= {prm.min_washout:.0%}")
    print(f"今日超跌放量反弹信号 = {breadth} 只  门槛 >= {prm.min_breadth}；空余仓位 {free}/{prm.max_positions}")
    if wdate is None or (pd.Timestamp(today) - pd.Timestamp(wdate)).days > 4:
        print("警告：本地数据不是上一个交易日的，先在收盘后运行 `python3 -m astock.run download`。")

    buys = pd.DataFrame()
    if breadth:
        cols = ["code", "name", "close", "pct", "dist_ma60", "vol_ratio", "float_mcap"]
        print(out[cols].head(30).assign(dist_ma60=lambda x: x["dist_ma60"].map("{:+.1%}".format),
                                        float_mcap=lambda x: (x["float_mcap"] / 1e8).round(1)).to_string(index=False))
    if washout < prm.min_washout or breadth < prm.min_breadth:
        print("\n结论：开仓条件不满足，今天不买。")
    elif free <= 0:
        print("\n结论：信号触发，但仓位已满，今天不买。")
    else:
        held_codes = set(pos.loc[pos["status"] == "open", "code"])
        buys = out[~out["code"].isin(held_codes)].head(min(prm.top_n, free)).copy()
        slot = (capital / prm.max_positions) if capital else None
        buys["shares"] = ((slot / buys["close"]) // 100 * 100).astype(int) if slot else 0
        print(f"\n结论：触发。尾盘买入以下 {len(buys)} 只，每只 1/{prm.max_positions} 仓位：")
        print(buys[["code", "name", "close", "shares"]].to_string(index=False))
        print(f"卖出规则：持有 {prm.hold_days} 个交易日后尾盘卖出；期间收盘亏损超过 {-prm.stop_loss:.0%} 当天尾盘止损。")

    if record:
        for i in selling.index:
            m = pos["code"].eq(selling.at[i, "code"]) & pos["status"].eq("open")
            pos.loc[m, ["status", "sell_date", "sell_price"]] = ["closed", today, selling.at[i, "price"]]
        new = pd.DataFrame({"code": buys.get("code", []), "name": buys.get("name", []), "buy_date": today,
                            "buy_price": buys.get("close", []), "shares": buys.get("shares", []),
                            "status": "open", "sell_date": "", "sell_price": float("nan")})
        pos = pd.concat([pos, new], ignore_index=True) if len(new) else pos
        os.makedirs(data.DATA_DIR, exist_ok=True)
        pos[POS_COLS].to_csv(POSITIONS_PATH, index=False)
        print(f"\n已记录：卖出 {len(selling)} 只，买入 {len(buys)} 只 -> {POSITIONS_PATH}")
    elif len(buys) or len(selling):
        print("\n（按上面成交后，加 --record 再运行一次，把买卖记入持仓文件。）")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["download", "backtest", "tune", "walkforward", "screen"])
    ap.add_argument("--record", action="store_true", help="screen: write today's buys/sells to the journal")
    ap.add_argument("--capital", type=float, help="screen: account size in CNY, to size orders in lots")
    a = ap.parse_args()
    prm = REBOUND
    if a.cmd == "download":
        data.download_all(refresh=True)
        bt.build_panel(refresh=True)
    elif a.cmd == "backtest":
        cmd_backtest(prm)
    elif a.cmd == "tune":
        cmd_tune(prm)
    elif a.cmd == "walkforward":
        cmd_walkforward(prm)
    else:
        cmd_screen(prm, record=a.record, capital=a.capital)


if __name__ == "__main__":
    main()
