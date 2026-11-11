"""Short-term A-share strategies. Entry is always in the closing minutes of day T
(14:50 live; the daily close is the backtest proxy), so every signal uses only
bars up to and including T.

Two rule sets live here:

* ``REBOUND`` – 超跌反弹·尾盘确认, the main strategy. A stock far below its
  60-day average that rallies hard on heavy volume has usually flushed out
  forced sellers; it is bought into the close and held a few days.
* ``CLASSIC`` – the popular 尾盘埋伏 recipe (up 3-5% on volume, closing near
  the high, bullish moving averages). Kept as a baseline: in the 2021-2026 data
  it loses money after costs, because A-share hot stocks mean-revert overnight.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

MAX_HOLD = 6


@dataclass(frozen=True)
class Params:
    name: str = "rebound"
    # universe
    min_listed_days: int = 120
    amount_min: float = 1e8           # T-day turnover in CNY
    price_min: float = 2.0
    mcap_min: float = 0.0             # float market cap, CNY
    # entry
    dist_ma60_max: float = -0.20      # close at least 20% below MA60
    pct_min: float = 3.0              # T-day gain, %
    pct_max: float = 9.5
    vol_ratio_min: float = 1.5        # T volume vs previous 5-day mean
    close_pos_min: float = 0.0        # (close-low)/(high-low)
    # classic-only filters
    turnover_min: float = 0.0
    turnover_max: float = 100.0
    require_trend: bool = False
    market_filter: bool = False
    # Only trade on days when at least this many stocks fire the entry signal:
    # isolated rebounds carry no edge after costs, market-wide washouts do.
    min_breadth: int = 10
    # "close" buys in the T closing minutes; "next_open" is a stress test that
    # buys at the T+1 open instead (late fill / missed the close).
    entry: str = "close"
    # exit
    hold_days: int = 3
    stop_loss: float = -0.10          # checked on closes; sold at that close
    take_profit: float = 9.9          # checked on closes; 9.9 = off
    top_n: int = 10                   # max new buys per day
    max_positions: int = 10           # account is split into this many equal slots
    rank_by: str = "pct"              # depth | vol_ratio | pct

    def to_dict(self) -> dict:
        return asdict(self)


REBOUND = Params()

CLASSIC = Params(
    name="classic", dist_ma60_max=9.9, pct_min=3.0, pct_max=5.0, vol_ratio_min=1.3,
    close_pos_min=0.75, turnover_min=3.0, turnover_max=12.0, mcap_min=40e8, amount_min=2e8,
    require_trend=True, market_filter=True, hold_days=1, stop_loss=-9.9, min_breadth=1,
    top_n=3, max_positions=3,
)


def limit_pct(code: str) -> float:
    return 20.0 if code.startswith(("300", "301")) else 10.0


def features(df: pd.DataFrame, code: str) -> pd.DataFrame:
    d = df.copy()
    c = d["close"]
    for n in (5, 10, 20, 60):
        d[f"ma{n}"] = c.rolling(n).mean()
    d["ma20_up"] = d["ma20"] > d["ma20"].shift(3)
    d["vol_ratio"] = d["volume"] / d["volume"].shift(1).rolling(5).mean()
    for n in (5, 20, 60):
        d[f"ret{n}"] = c / c.shift(n) - 1
    d["dist_ma20"] = c / d["ma20"] - 1
    d["dist_ma60"] = c / d["ma60"] - 1
    d["vol20"] = (d["pct"] / 100).rolling(20).std()
    rng = (d["high"] - d["low"]).replace(0, np.nan)
    d["close_pos"] = (c - d["low"]) / rng
    d["upper_shadow"] = (d["high"] - np.maximum(c, d["open"])) / c
    # turnover% = volume / float shares; volume is in lots of 100 shares
    d["float_mcap"] = np.where(d["turnover"] > 0, d["volume"] * 100 / (d["turnover"] / 100) * c, np.nan)
    d["listed_days"] = np.arange(1, len(d) + 1)

    lim = limit_pct(code)
    # Historical ST status is not in the bar data. On the main board ST names trade
    # under a 5% limit, so a 120-day window capped near 5% that touches it is a proxy.
    mx = d["pct"].abs().rolling(120, min_periods=20).max()
    d["st_proxy"] = (mx <= 5.2) & (mx >= 4.8) & (lim == 10.0)
    d["limit"] = np.where(d["st_proxy"], 5.0, lim)
    d["is_limit_up"] = d["pct"] >= d["limit"] - 0.15
    d["is_limit_down_sealed"] = (d["high"] == d["low"]) & (d["pct"] <= -(d["limit"] - 0.15))

    for k in range(1, MAX_HOLD + 2):
        d[f"n{k}_close"] = c.shift(-k)
        d[f"n{k}_locked"] = d["is_limit_down_sealed"].shift(-k, fill_value=False)
    for col in ("open", "high", "low", "pct"):
        d[f"n1_{col}"] = d[col].shift(-1)
    d["code"] = code
    return d


def signal_mask(p: pd.DataFrame, prm: Params) -> pd.Series:
    m = (
        ~p["is_st"]
        & ~p["is_limit_up"]                      # cannot be bought at a sealed limit-up
        & (p["listed_days"] >= prm.min_listed_days)
        & (p["amount"] >= prm.amount_min)
        & (p["close"] >= prm.price_min)
        & (p["float_mcap"] >= prm.mcap_min)
        & (p["dist_ma60"] <= prm.dist_ma60_max)
        & p["pct"].between(prm.pct_min, prm.pct_max)
        & (p["vol_ratio"] >= prm.vol_ratio_min)
        & (p["close_pos"] >= prm.close_pos_min)
        & p["turnover"].between(prm.turnover_min, prm.turnover_max)
    )
    if prm.require_trend:
        m &= (p["close"] > p["ma5"]) & (p["ma5"] > p["ma10"]) & (p["ma10"] > p["ma20"]) & p["ma20_up"]
    if prm.market_filter:
        m &= p["mkt_ok"]
    return m


def score(p: pd.DataFrame, prm: Params) -> pd.Series:
    """Higher is better."""
    if prm.name == "classic":
        return p["close_pos"] - (np.log(p["vol_ratio"]) - np.log(2.0)).abs()
    if prm.rank_by == "vol_ratio":
        return p["vol_ratio"]
    if prm.rank_by == "pct":
        return p["pct"]
    return -p["dist_ma60"]
