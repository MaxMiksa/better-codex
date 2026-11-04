"""Read completed gateway measurements; retain the native collector as fallback."""
from __future__ import annotations

import collections
import http.client
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

from src.interface.statistics.collector.metrics import request_rate, timestamp_ms


def counter(row: dict, name: str) -> int | None:
    value = row.get(name)
    return value if type(value) is int and value >= 0 else None


def gateway_sample(row: dict, thread_id: str, native: dict, now: float,
                   max_age_ms: int | None = 900000) -> dict | None:
    """Join by response identity, never by model name or approximate timestamps."""
    last = native.get("last") or {}
    response_id = last.get("response_id")
    identity = row.get("native_session") or row.get("session")
    if (not response_id or row.get("response_id") != response_id or identity != thread_id
            or row.get("agent") != "codex" or row.get("source") or row.get("computer")
            or row.get("via") or row.get("subagent") or row.get("parent_agent") or row.get("kind")
            or row.get("handed_on") or row.get("rejected") or row.get("err") or row.get("err_type")
            or row.get("status") != 200):
        return None
    start = timestamp_ms(row.get("t"))
    duration = counter(row, "ms")
    output = counter(row, "out")
    if start is None or duration is None or duration < 50 or not output:
        return None
    end = start + duration
    turn_start = native.get("turn_started_at_ms")
    if (not math.isfinite(end) or end > now or max_age_ms is not None and now - end >= max_age_ms
            or turn_start is not None and start < turn_start
            or native.get("turn_id") and last.get("turn_id") != native["turn_id"]):
        return None
    inputs, cached, written = (counter(row, key) for key in ("in", "cache_read", "cache_write"))
    if inputs is None or cached is None or written is None:
        return None
    total = inputs + cached + written
    cache_unknown = row.get("cache_unknown") or row.get("provider") in ("kiro", "kiro-plugin") and not cached and not written
    ttft = counter(row, "ttft_ms")
    if ttft is None or not 0 < ttft <= duration:
        ttft = None
    rate = row.get("native_speed")
    if type(rate) not in (int, float) or not math.isfinite(rate) or rate <= 0:
        rate = None
    # magpie's out already includes counted reasoning; its in excludes both cache buckets.
    return {**last, "rate": rate, "rate_basis": "magpie-native-speed-v1", "ttft_ms": ttft,
            "duration_ms": duration,
            "basis": "request", "input_tokens": total, "cached_input_tokens": cached,
            "output_tokens": output, "reasoning_output_tokens": counter(row, "reasoning") or 0,
            "cache_percent": 100 * cached / total if total and not cache_unknown else None,
            "measured_at_ms": end, "source": "magpie"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class MagpieMeasurements:
    """Bounded local reads, with no proxy, auth lookup, redirects or model requests."""

    def __init__(self, settings: Path | None = None):
        config_home = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
        self.settings = settings if settings is not None else config_home / "magpie/settings.json"
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.key = None
        self.next_poll = 0.0
        self.rows: list[dict] = []
        self.turn_ttfts: collections.OrderedDict[tuple, int | None] = collections.OrderedDict()
        self.route_speeds: collections.OrderedDict[tuple, float | None] = collections.OrderedDict()
        self.turn_speeds: collections.OrderedDict[tuple, dict] = collections.OrderedDict()
        self.available: bool | None = None
        self.connection_failures = 0
        self.speed_retry = (None, 0.0)

    def _fetch(self, thread_id: str, limit: int = 20, route: int | None = None) -> dict:
        settings = json.loads(self.settings.read_text(encoding="utf-8-sig"))
        port = settings.get("port", 3425)
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("Invalid local gateway port")
        params = {"agent": "codex", "via": "through", "period": "all", "q": thread_id, "limit": limit}
        if route is not None:
            params["route"] = route
        query = urllib.parse.urlencode(params)
        url = f"http://127.0.0.1:{port}/v1/magpie/usage/requests?{query}"
        with self.opener.open(url, timeout=.75) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024:
            raise ValueError("Gateway response exceeds measurement budget")
        result = json.loads(data)
        if not isinstance(result, dict) or not isinstance(result.get("rows"), list):
            raise ValueError("Unsupported gateway measurements")
        return result

    def _read(self, thread_id: str, limit: int = 20) -> list[dict]:
        result = self._fetch(thread_id, limit)
        # Keep only fields used for measurements, never accounts, errors or request bodies.
        fields = ("route_id", "response_id", "native_session", "session", "agent", "source", "computer", "via",
                  "subagent", "parent_agent", "kind", "handed_on", "rejected", "status", "t", "ms",
                  "out", "in", "cache_read", "cache_write", "cache_unknown", "provider", "reasoning",
                  "ttft_ms")
        return [{**{k: r[k] for k in fields if k in r},
                 "err": bool(r.get("err") or r.get("err_type"))}
                for r in result["rows"] if isinstance(r, dict)]

    def _native_speed(self, thread_id: str, row: dict) -> float | None:
        route = counter(row, "route_id")
        if not route or not row.get("response_id"):
            return None
        key = (thread_id, route, row["response_id"])
        if key in self.route_speeds:
            self.route_speeds.move_to_end(key)
            return self.route_speeds[key]
        if self.speed_retry[0] == key and time.monotonic() < self.speed_retry[1]:
            return None
        try:
            result = self._fetch(thread_id, route=route)
        except (OSError, ValueError, TypeError, AttributeError, urllib.error.URLError, http.client.HTTPException):
            self.speed_retry = (key, time.monotonic() + 2)
            return None
        matching = [r for r in result["rows"] if isinstance(r, dict)
                    and r.get("response_id") == row["response_id"]
                    and counter(r, "route_id") == route
                    and (r.get("native_session") or r.get("session")) == thread_id]
        rate = None
        output, duration = counter(result, "decode_out"), counter(result, "decode_ms")
        if (len(result["rows"]) == len(matching) == 1 and counter(result, "calls") == 1
                and counter(result, "decode_n") == 1 and output and duration):
            # Use magpie's computed result, exactly as its Usage page's ledSpeed does.
            rate = output * 1000 / duration
        self.route_speeds[key] = rate
        while len(self.route_speeds) > 16:
            self.route_speeds.popitem(last=False)
        return rate

    def select(self, thread_id: str, native: dict | None, source: dict | None,
               force: bool = False) -> tuple[dict | None, dict | None]:
        clock = time.monotonic()
        if thread_id != self.key or force or clock >= self.next_poll:
            self.key = thread_id
            self.next_poll = clock + 2
            try:
                self.rows = self._read(thread_id)
                self.available, self.connection_failures = True, 0
            except urllib.error.HTTPError:
                self.rows = []
                self.available, self.connection_failures = True, 0
            except (OSError, urllib.error.URLError, http.client.HTTPException):
                self.rows = []
                self.connection_failures += 1
                if self.connection_failures >= 3:
                    self.available = False
            except (ValueError, TypeError, AttributeError):
                self.rows = []
                self.available, self.connection_failures = None, 0
            if self.available is False:
                self.next_poll = clock + 30
        if not native:
            return native, source
        start = native.get("turn_started_at_ms")
        scope = (thread_id, native.get("turn_id"), start)
        state = None
        if start is not None:
            if scope not in self.turn_speeds:
                for old in list(self.turn_speeds):
                    if old[0] == thread_id:
                        del self.turn_speeds[old]
                self.turn_speeds[scope] = {"mode": "local" if self.available is False else "magpie", "sample": None}
            self.turn_speeds.move_to_end(scope)
            while len(self.turn_speeds) > 8:
                self.turn_speeds.popitem(last=False)
            state = self.turn_speeds[scope]
        mode = state["mode"] if state else "magpie"
        if mode == "local":
            result, selected_source = native, source
            last = native.get("last") or {}
            rate = request_rate(last)
            sample = {**last, "rate": rate, "rate_basis": "response-request-average-v2"}
            result = {**result, "last": sample} if last else result
        else:
            result, selected_source = self._select_sample(thread_id, native, source)
            sample = result.get("last") or {}
        if state is not None:
            rate = sample.get("rate")
            valid = (type(rate) in (int, float) and math.isfinite(rate) and rate > 0
                     and sample.get("measured_at_ms", 0) >= start
                     and (not native.get("turn_id") or sample.get("turn_id") == native["turn_id"])
                     and (mode == "local" or sample.get("source") == "magpie"
                          and sample.get("rate_basis") == "magpie-native-speed-v1"))
            if mode == "local":
                state["sample"] = None
            if valid and (state["sample"] is None or sample["measured_at_ms"] >= state["sample"]["measured_at_ms"]):
                state["sample"] = {k: sample.get(k) for k in
                                   ("rate", "rate_basis", "source", "response_id", "model", "turn_id", "measured_at_ms")}
                state["sample"]["turn_started_at_ms"] = start
        return ({**result, "speed_mode": mode, "turn_speed": dict(state["sample"]) if state and state["sample"] else None},
                selected_source)

    def _select_sample(self, thread_id: str, native: dict, source: dict | None) -> tuple[dict, dict | None]:
        if not native.get("last"):
            return native, source
        first_id = native.get("turn_first_response_id")
        turn_start = native.get("turn_started_at_ms")
        if first_id and turn_start is not None:
            scope = (thread_id, native.get("turn_id"), turn_start, first_id)
            new_scope = scope not in self.turn_ttfts
            if new_scope:
                for old in list(self.turn_ttfts):
                    if old[0] == thread_id:
                        del self.turn_ttfts[old]
                self.turn_ttfts[scope] = None
            self.turn_ttfts.move_to_end(scope)
            while len(self.turn_ttfts) > 8:
                self.turn_ttfts.popitem(last=False)
            if self.turn_ttfts[scope] is None:
                if new_scope and self.rows and not any(r.get("response_id") == first_id for r in self.rows):
                    try:
                        self.rows = self._read(thread_id, limit=500)
                    except (OSError, ValueError, TypeError, AttributeError, urllib.error.URLError, http.client.HTTPException):
                        pass  # A first-response lookup must not discard the latest sample.
                first = {**native, "last": {**native["last"], "response_id": first_id,
                                            "turn_id": native.get("turn_id")}}
                samples = [sample for row in self.rows if
                           (sample := gateway_sample(row, thread_id, first, time.time() * 1000, max_age_ms=None))]
                if len(samples) == 1:
                    self.turn_ttfts[scope] = samples[0]["ttft_ms"]
            if self.turn_ttfts[scope] is not None:
                native = {**native, "turn_ttft_ms": self.turn_ttfts[scope]}
        samples = [(row, sample) for row in self.rows
                   if (sample := gateway_sample(row, thread_id, native, time.time() * 1000))]
        # Duplicated response identities are ambiguous; keep the complete native sample.
        if len(samples) != 1:
            return native, source
        row, sample = samples[0]
        sample["rate"] = self._native_speed(thread_id, row)
        return ({**native, "last": sample},
                {"state": "ok", "provider": "magpie"})
