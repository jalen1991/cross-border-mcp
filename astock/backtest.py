"""Vectorised backtest. Entry at the T close, exits on later closes, A-share rules:
T+1, no buying at a sealed limit-up, no selling at a sealed limit-down."""
from __future__ import annotations

import glob
import os
import pickle

import numpy as np
import pandas as pd

from . import data
from .strategy import MAX_HOLD, Params, features, score, signal_mask

PANEL_PATH = os.path.join(data.DATA_DIR, "panel.pkl")

COMMISSION = 0.00025
SLIPPAGE = 0.0015                       # per side, on top of the quoted price
STAMP_CUTOVER = pd.Timestamp("2023-08-28")


def build_panel(refresh: bool = False) -> pd.DataFrame:
    if os.path.exists(PANEL_PATH) and not refresh:
        with open(PANEL_PATH, "rb") as f:
            return pickle.load(f)
    now = pd.Timestamp.now(tz="Asia/Shanghai")
    # A bar for today fetched before the close is still in progress and must not
    # serve as anyone's exit price.
    cutoff = now.strftime("%Y-%m-%d") if now.hour * 60 + now.minute < 15 * 60 + 30 else "9999"
    frames = []
    for path in glob.glob(os.path.join(data.KLINE_DIR, "*.csv")):
        code = os.path.basename(path)[:-4]
        df = pd.read_csv(path)
        df = df[df["date"] < cutoff].reset_index(drop=True)
        if len(df) < 60:
            continue
        f = features(df, code)
        # Current names would leak the future (today's ST names were not ST in 2021),
        # so the backtest relies on the price-limit proxy only.
        f["is_st"] = f.pop("st_proxy")
        frames.append(f)
    panel = pd.concat(frames, ignore_index=True)
    panel["date"] = pd.to_datetime(panel["date"])

    idx = data.index_kline()
    idx = idx[idx["date"] < cutoff]
    idx["date"] = pd.to_datetime(idx["date"])
    idx["mkt_ok"] = idx["close"] > idx["close"].rolling(20).mean()
    panel = panel.merge(idx[["date", "mkt_ok"]], on="date", how="left")
    panel["mkt_ok"] = panel["mkt_ok"].fillna(False).astype(bool)

    panel = panel.drop(columns=["amplitude", "chg"])
    for c in panel.select_dtypes("float64").columns:
        panel[c] = panel[c].astype("float32")
    with open(PANEL_PATH, "wb") as f:
        pickle.dump(panel, f)
    return panel


def simulate(t: pd.DataFrame, prm: Params) -> pd.DataFrame:
    """Per-trade exit day and net return, plus mark-to-market values per day."""
    n = len(t)
    late = prm.entry == "next_open"
    entry = t["n1_open" if late else "close"].to_numpy(float)
    buy = 1 + SLIPPAGE + COMMISSION
    stamp = np.where(t["date"] >= STAMP_CUTOVER, 0.0005, 0.001)
    sell = 1 - SLIPPAGE - COMMISSION - stamp

    exit_k = np.zeros(n, dtype=int)
    exit_px = np.full(n, np.nan)
    pending = np.zeros(n, dtype=bool)        # wanted out but locked at limit-down
    last = np.ones(n)
    values = np.full((n, MAX_HOLD + 1), np.nan)
    for k in range(1, MAX_HOLD + 2):
        ck = t[f"n{k}_close"].to_numpy(float) / entry
        gone = np.isnan(ck)                  # data ends / delisted: out at last close
        ck = np.where(gone, last, ck)
        locked = t[f"n{k}_locked"].to_numpy(bool) & ~gone
        r = ck - 1
        want = pending | (k >= prm.hold_days) | (r <= prm.stop_loss) | (r >= prm.take_profit) | gone
        if late and k == 1:
            want = gone                      # bought this morning: T+1 rule
        alive = exit_k == 0
        out = alive & want & (~locked | (k == MAX_HOLD + 1))
        exit_k[out], exit_px[out] = k, ck[out]
        pending = alive & want & ~out
        if k <= MAX_HOLD:
            values[:, k - 1] = np.where(alive, np.where(out, ck * sell, ck) / buy, np.nan)
        last = ck
    res = pd.DataFrame({"exit_k": exit_k, "ret": exit_px * sell / buy - 1}, index=t.index)
    res["values"] = list(values)
    return res


def run(panel: pd.DataFrame, prm: Params, start: str | None = None, end: str | None = None):
    p = panel
    if start:
        p = p[p["date"] >= start]
    if end:
        p = p[p["date"] <= end]
    days = pd.Index(sorted(p["date"].unique()), name="date")
    p = p[p["n1_close"].notna()]
    cand = p[signal_mask(p, prm)].copy()
    cand["breadth"] = cand.groupby("date")["code"].transform("size")
    cand = cand[cand["breadth"] >= prm.min_breadth]
    if prm.entry == "next_open":
        sealed_up = (cand["n1_high"] == cand["n1_low"]) & (cand["n1_pct"] >= cand["limit"] - 0.15)
        cand = cand[~sealed_up & cand["n1_open"].notna()]
    cand["score"] = score(cand, prm)
    cand = (cand.sort_values(["date", "score"], ascending=[True, False])
                .groupby("date").head(prm.top_n).copy())
    if cand.empty:
        return cand, pd.Series(0.0, index=days)
    sim = simulate(cand, prm)
    cand["ret"], cand["exit_k"] = sim["ret"], sim["exit_k"]
    cand["day"] = days.get_indexer(cand["date"])
    vals = np.vstack(sim["values"].to_numpy())
    return _account(cand, vals, days, prm)


def _account(cand: pd.DataFrame, vals: np.ndarray, days: pd.Index, prm: Params):
    """Day-by-day account: equity is split into max_positions equal slots; a signal
    is taken only if a slot is free, and cash is released on the exit close."""
    by_day: dict[int, list[int]] = {}
    for i, d in enumerate(cand["day"].to_numpy()):
        by_day.setdefault(d, []).append(i)
    exit_k = cand["exit_k"].to_numpy()
    cash, open_pos = 1.0, {}                 # trade row -> (entry day, amount invested)
    taken, equity = [], np.ones(len(days))
    for d in range(len(days)):
        held = 0.0
        for i, (d0, amt) in list(open_pos.items()):
            k = d - d0
            v = vals[i, min(k, MAX_HOLD) - 1]
            if k >= exit_k[i] or np.isnan(v):
                v = vals[i, min(exit_k[i], MAX_HOLD) - 1]
                cash += amt * (v if not np.isnan(v) else 1.0)
                del open_pos[i]
            else:
                held += amt * v
        eq = cash + held
        for i in by_day.get(d, []):
            if len(open_pos) >= prm.max_positions:
                break
            amt = min(eq / prm.max_positions, cash)
            if amt <= 0:
                break
            cash -= amt
            open_pos[i] = (d, amt)
            taken.append(i)
            held += amt                       # bought at today's close, valued at cost
        equity[d] = cash + held
    daily = pd.Series(equity, index=days).pct_change().fillna(0.0)
    return cand.iloc[sorted(taken)].copy(), daily


def metrics(picks: pd.DataFrame, daily: pd.Series) -> dict:
    if picks.empty:
        return {"trades": 0}
    eq = (1 + daily).cumprod()
    years = max(len(daily) / 244, 1e-9)
    dd = eq / eq.cummax() - 1
    r = picks["ret"]
    loss = -r[r <= 0].sum()
    return {
        "trades": int(len(r)),
        "win_rate": float((r > 0).mean()),
        "avg_trade": float(r.mean()),
        "median_trade": float(r.median()),
        "profit_factor": float(r[r > 0].sum() / loss) if loss > 0 else np.inf,
        "total_return": float(eq.iloc[-1] - 1),
        "cagr": float(eq.iloc[-1] ** (1 / years) - 1),
        "max_drawdown": float(dd.min()),
        "sharpe": float(daily.mean() / daily.std() * np.sqrt(244)) if daily.std() > 0 else 0.0,
        "exposure": float((daily != 0).mean()),
    }


def fmt(m: dict) -> str:
    if not m.get("trades"):
        return "no trades"
    return (f"trades={m['trades']:5d}  win={m['win_rate']:.1%}  avg={m['avg_trade']:+.2%}  "
            f"med={m['median_trade']:+.2%}  PF={m['profit_factor']:.2f}  total={m['total_return']:+.1%}  "
            f"CAGR={m['cagr']:+.1%}  MDD={m['max_drawdown']:.1%}  sharpe={m['sharpe']:.2f}")


def benchmark(start: str, end: str | None = None) -> dict:
    idx = data.index_kline()
    idx["date"] = pd.to_datetime(idx["date"])
    s = idx[(idx["date"] >= start) & ((idx["date"] <= end) if end else True)].set_index("date")["close"]
    eq = s / s.iloc[0]
    return {"total_return": float(eq.iloc[-1] - 1), "max_drawdown": float((eq / eq.cummax() - 1).min())}
