"""A-share daily data from Eastmoney public endpoints, cached as CSV.

The Eastmoney board listing still carries stocks delisted in recent years
(names ending in 退 / *ST), so the universe is not survivorship-biased as long
as nothing is filtered out by its *current* name.
"""
from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
KLINE_DIR = os.path.join(DATA_DIR, "kline")

LIST_URL = "https://push2delay.eastmoney.com/api/qt/clist/get"
KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"}

# 沪主板, 深主板, 创业板. 科创板/北交所 need separate account permissions and are excluded.
BOARDS = "m:1+t:2,m:0+t:6,m:0+t:80"

KLINE_COLS = ["date", "open", "close", "high", "low", "volume", "amount",
              "amplitude", "pct", "chg", "turnover"]

SNAPSHOT_FIELDS = {
    "f12": "code", "f14": "name", "f13": "market", "f2": "price", "f3": "pct",
    "f5": "volume", "f6": "amount", "f8": "turnover", "f10": "vol_ratio",
    "f15": "high", "f16": "low", "f17": "open", "f18": "prev_close", "f21": "float_mcap",
}


def _get(url: str, params: dict, retries: int = 4) -> dict:
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return {}


def snapshot(min_pct: float | None = None) -> pd.DataFrame:
    """Realtime (delayed) quotes. With `min_pct`, pages are pulled in descending
    order of today's gain and paging stops once gains fall below it."""
    rows, page = [], 1
    while True:
        js = _get(LIST_URL, {
            "pn": page, "pz": 100, "po": 1, "np": 1, "fltt": 2, "invt": 2,
            "fid": "f12" if min_pct is None else "f3", "fs": BOARDS,
            "fields": ",".join(SNAPSHOT_FIELDS),
        })
        d = js.get("data") or {}
        diff = d.get("diff") or []
        rows.extend(diff)
        if not diff or len(rows) >= d.get("total", 0):
            break
        if min_pct is not None and pd.to_numeric(diff[-1].get("f3"), errors="coerce") < min_pct:
            break
        page += 1
    df = pd.DataFrame(rows).rename(columns=SNAPSHOT_FIELDS)
    for c in df.columns:
        if c not in ("code", "name"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def stock_list(refresh: bool = False) -> pd.DataFrame:
    path = os.path.join(DATA_DIR, "stock_list.csv")
    if os.path.exists(path) and not refresh:
        return pd.read_csv(path, dtype={"code": str})
    os.makedirs(DATA_DIR, exist_ok=True)
    df = snapshot()[["code", "name", "market"]]
    df.to_csv(path, index=False)
    return df


def fetch_kline(secid: str, beg: str = "20210101", end: str = "20500101") -> pd.DataFrame:
    """Forward-adjusted (前复权) daily bars. During a session the last bar is today's, in progress."""
    js = _get(KLINE_URL, {
        "secid": secid, "klt": 101, "fqt": 1, "beg": beg, "end": end,
        "fields1": "f1,f2,f3", "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    })
    lines = ((js.get("data") or {}).get("klines")) or []
    df = pd.DataFrame([l.split(",") for l in lines], columns=KLINE_COLS)
    for c in KLINE_COLS[1:]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def kline(code: str, market: int, refresh: bool = False) -> pd.DataFrame:
    path = os.path.join(KLINE_DIR, f"{code}.csv")
    if os.path.exists(path) and not refresh:
        return pd.read_csv(path)
    os.makedirs(KLINE_DIR, exist_ok=True)
    df = fetch_kline(f"{market}.{code}")
    df.to_csv(path, index=False)
    return df


def index_kline(secid: str = "1.000001", refresh: bool = False) -> pd.DataFrame:
    path = os.path.join(DATA_DIR, f"index_{secid}.csv")
    if os.path.exists(path) and not refresh:
        return pd.read_csv(path)
    os.makedirs(DATA_DIR, exist_ok=True)
    df = fetch_kline(secid)
    df.to_csv(path, index=False)
    return df


def download_all(workers: int = 8, refresh: bool = False) -> None:
    lst = stock_list(refresh=refresh)
    todo = [r for r in lst.itertuples()
            if refresh or not os.path.exists(os.path.join(KLINE_DIR, f"{r.code}.csv"))]
    print(f"universe={len(lst)} to_download={len(todo)}")
    failed = []
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(kline, r.code, r.market, True): r.code for r in todo}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                f.result()
            except Exception:
                failed.append(futs[f])
            if i % 500 == 0:
                print(f"  {i}/{len(todo)}", flush=True)
    index_kline(refresh=True)
    print(f"done, failed={len(failed)} {failed[:20]}")
