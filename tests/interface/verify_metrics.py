"""Synthetic timing regressions; no app, network, or real conversation reads."""
import datetime as dt
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.parse

from src.interface.statistics.collector.metrics import Measurements, SessionTail
from src.interface.statistics.collector.magpie import MagpieMeasurements, gateway_sample


EPOCH = 1792800000000


def event(m, ms, kind, **payload):
    at = dt.datetime.fromtimestamp((EPOCH + ms) / 1000, dt.timezone.utc).isoformat()
    m.feed({"type": kind, "timestamp": at, "payload": payload})


def begin(m):
    event(m, 0, "event_msg", type="task_started", turn_id="turn")


def usage(m, ms, output=100, response="response", **extra):
    event(m, ms, "token_usage_record", response_id=response, turn_id="turn",
          usage={"input_tokens": 200, "cached_input_tokens": 180,
                 "output_tokens": output, "reasoning_output_tokens": output // 2}, **extra)


def call(m, ms, call_id="call", custom=False):
    event(m, ms, "response_item", type="custom_tool_call" if custom else "function_call", call_id=call_id)


def result(m, ms, call_id="call", custom=False):
    event(m, ms, "response_item", type="custom_tool_call_output" if custom else "function_call_output", call_id=call_id)


def reasoning(m, ms):
    event(m, ms, "event_msg", type="item_completed", item={"type": "Reasoning"},
          started_at_ms=EPOCH + ms, completed_at_ms=EPOCH + ms)
    event(m, ms, "response_item", type="reasoning")


def legacy(m, ms, total, output=100):
    event(m, ms, "event_msg", type="token_count", info={
        "last_token_usage": {"input_tokens": 200, "cached_input_tokens": 180, "output_tokens": output},
        "total_token_usage": {"output_tokens": total}})


class TimingChecks(unittest.TestCase):
    def test_live_speed_can_pause_without_losing_usage_or_timing(self):
        m = Measurements(calculate_speed=False)
        with patch("src.interface.statistics.collector.metrics.request_rate", side_effect=AssertionError("local speed ran")):
            begin(m); usage(m, 12000)
        self.assertIsNone(m.last["rate"])
        self.assertEqual(m.last["duration_ms"], 12000)
        self.assertEqual(m.last["cache_percent"], 90)
        self.assertEqual(m.snapshot()["turn_first_response_id"], "response")
        tail = SessionTail("synthetic", calculate_speed=False)
        tail.reset()
        self.assertFalse(tail.measurements.calculate_speed)

    def test_screenshot_full_response_not_summary_duration(self):
        m = Measurements(); begin(m)
        call(m, 100); usage(m, 200, response="previous")
        result(m, 20651)
        reasoning(m, 35188)
        call(m, 36924, "next"); usage(m, 37462, output=532)
        self.assertAlmostEqual(m.last["rate"], 532 / 16.811)
        self.assertEqual(m.last["duration_ms"], 16811)
        self.assertEqual(m.last["basis"], "request")

    def test_parallel_tools_excluded_until_last_result(self):
        for custom in (False, True):
            m = Measurements(); begin(m)
            call(m, 9000, "a", custom); call(m, 9500, "b", custom)
            usage(m, 10000)
            result(m, 30000, "a", custom); result(m, 50000, "b", custom)
            reasoning(m, 59000); usage(m, 60000, response="next")
            self.assertEqual(m.last["rate"], 10)

    def test_steering_does_not_reset_inflight_boundary(self):
        m = Measurements(); begin(m); reasoning(m, 5000)
        event(m, 9900, "response_item", type="message", role="user")
        usage(m, 10000)
        self.assertEqual(m.last["rate"], 10)

    def test_unknown_or_duplicate_tool_result_cannot_shorten_response(self):
        m = Measurements(); begin(m)
        call(m, 9000); usage(m, 10000, response="previous"); result(m, 20000)
        reasoning(m, 21000); result(m, 29900); result(m, 29950, "unknown")
        usage(m, 30000)
        self.assertEqual(m.last["rate"], 10)

    def test_tool_finishes_before_usage_does_not_retime_own_response(self):
        m = Measurements(); begin(m)
        call(m, 9000); result(m, 9900); usage(m, 10000)
        self.assertIsNone(m.last["rate"])
        reasoning(m, 11000); usage(m, 12000, response="next")
        self.assertIsNone(m.last["rate"])

    def test_mid_response_tail_has_usage_without_invented_start(self):
        m = Measurements(); reasoning(m, 9900); usage(m, 10000)
        self.assertIsNone(m.last["rate"])
        self.assertEqual(m.last["cache_percent"], 90)

    def test_initial_restored_legacy_count_is_not_new_usage(self):
        m = Measurements(); begin(m)
        legacy(m, 2000, total=8227, output=1614)
        self.assertIsNone(m.last)
        self.assertEqual(m.turn_output, 0)

    def test_legacy_only_growth_keeps_cache_without_claiming_speed(self):
        m = Measurements(); begin(m)
        legacy(m, 1000, total=1000); legacy(m, 2000, total=1100)
        self.assertIsNone(m.last["rate"])
        self.assertEqual(m.last["cache_percent"], 90)

    def test_modern_usage_wins_over_changed_legacy_totals_and_mirrors(self):
        m = Measurements(); begin(m); usage(m, 10000)
        first = m.last
        legacy(m, 10001, total=1000); legacy(m, 10002, total=1100)
        legacy(m, 10003, total=1100)
        self.assertIs(m.last, first)
        self.assertEqual(m.sample_count, 1)

    def test_response_id_dedup_does_not_reset_next_boundary(self):
        m = Measurements(); begin(m); usage(m, 10000)
        usage(m, 19900); usage(m, 20000, response="next")
        self.assertEqual(m.last["rate"], 10)
        self.assertEqual(m.sample_count, 2)

    def test_previous_turn_record_and_terminal_late_record_are_ignored(self):
        m = Measurements(); begin(m); usage(m, 10000)
        first = m.last
        event(m, 11000, "token_usage_record", response_id="old", turn_id="old-turn", usage={"output_tokens": 1000})
        event(m, 12000, "event_msg", type="task_complete")
        usage(m, 13000, response="late")
        self.assertIs(m.last, first)
        self.assertEqual(m.stage, "idle")

    def test_new_turn_does_not_include_idle_gap(self):
        m = Measurements(); begin(m); usage(m, 10000)
        event(m, 11000, "event_msg", type="task_complete")
        event(m, 1000000, "event_msg", type="task_started", turn_id="turn")
        usage(m, 1010000, response="next")
        self.assertEqual(m.last["rate"], 10)

    def test_session_resume_clears_old_boundaries(self):
        m = Measurements(); begin(m); usage(m, 10000)
        event(m, 20000, "session_meta")
        reasoning(m, 29900); usage(m, 30000, response="resumed")
        self.assertIsNone(m.last["rate"])

    def test_compaction_completion_is_next_request_boundary(self):
        m = Measurements(); begin(m); call(m, 9000)
        event(m, 50000, "compacted")
        reasoning(m, 59000); usage(m, 60000)
        self.assertEqual(m.last["rate"], 10)

    def test_no_arbitrary_150_cap_or_reasoning_double_count(self):
        m = Measurements(); begin(m); usage(m, 10000, output=3000)
        self.assertEqual(m.last["rate"], 300)
        self.assertEqual(m.last["output_tokens"], 3000)

    def test_nonpositive_or_tiny_duration_is_missing(self):
        for at in (-100, 0, 49):
            m = Measurements(); begin(m); usage(m, at)
            self.assertIsNone(m.last["rate"])

    def test_first_response_identity_stays_with_turn_and_resets_at_next_start(self):
        m = Measurements(); begin(m); usage(m, 10000, response="first")
        usage(m, 12000, response="next")
        self.assertEqual(m.snapshot()["turn_first_response_id"], "first")
        event(m, 13000, "response_item", type="message", role="user")
        self.assertEqual(m.snapshot()["turn_first_response_id"], "first")
        event(m, 14000, "event_msg", type="task_started", turn_id="new")
        self.assertIsNone(m.snapshot()["turn_first_response_id"])

    def test_new_idle_user_clears_first_identity_and_mid_tail_cannot_invent_it(self):
        m = Measurements(); begin(m); usage(m, 10000)
        event(m, 11000, "event_msg", type="task_complete")
        event(m, 12000, "response_item", type="message", role="user")
        self.assertIsNone(m.snapshot()["turn_first_response_id"])
        self.assertEqual(m.snapshot()["turn_started_at_ms"], EPOCH + 12000)
        m = Measurements(); usage(m, 10000)
        self.assertIsNone(m.snapshot()["turn_first_response_id"])

    def test_missing_first_response_id_cannot_be_replaced_by_a_later_id(self):
        m = Measurements(); begin(m); usage(m, 10000, response=None)
        usage(m, 12000, response="later")
        self.assertIsNone(m.snapshot()["turn_first_response_id"])


class MagpieChecks(unittest.TestCase):
    def setUp(self):
        m = Measurements("group/selected"); begin(m); usage(m, 12000)
        self.native = m.snapshot()
        self.source = {"state": "ok", "path": "synthetic-rollout"}
        self.row = {"agent": "codex", "session": "thread", "native_session": "thread",
                    "response_id": "response", "status": 200,
                    "t": dt.datetime.fromtimestamp((EPOCH + 1000) / 1000, dt.timezone.utc).isoformat(),
                    "ms": 10000, "in": 20, "cache_read": 180, "cache_write": 0,
                    "out": 200, "reasoning": 80, "sent_ms": 2000, "ttft_ms": 3000, "native_speed": 25}
        self.now = EPOCH + 15000
        speed = patch.object(MagpieMeasurements, "_native_speed", side_effect=lambda thread, row: row.get("native_speed"))
        speed.start()
        self.addCleanup(speed.stop)

    def sample(self, **changes):
        return gateway_sample({**self.row, **changes}, "thread", self.native, self.now)

    def test_routed_models_use_same_request_average_and_cache_contract(self):
        for provider, model in (("codex", "gpt-6.1-sol"), ("workbuddy", "kimi-k3.1-pro"),
                                ("workbuddy-ai", "deepseek-v4.1-flash")):
            with self.subTest(model=model):
                sample = self.sample(provider=provider, model=model, req=f"{provider}/{model}", served=model)
                self.assertEqual(sample["rate"], 25)
                self.assertEqual(sample["ttft_ms"], 3000)
                self.assertEqual(sample["cache_percent"], 90)
                self.assertEqual(sample["output_tokens"], 200)  # reasoning already in out
                self.assertEqual(sample["model"], "group/selected")
                self.assertEqual(sample["turn_id"], "turn")
                self.assertEqual(sample["measured_at_ms"], EPOCH + 11000)

    def test_cache_creation_and_unknown_cache(self):
        self.assertEqual(self.sample(cache_write=100)["cache_percent"], 60)
        self.assertIsNone(self.sample(cache_unknown=True)["cache_percent"])
        self.assertIsNone(self.sample(provider="kiro", cache_read=0)["cache_percent"])
        for field in ("in", "cache_read", "cache_write"):
            self.assertIsNone(self.sample(**{field: None}))

    def test_magpie_native_speed_replaces_the_previous_custom_formula(self):
        row = {**self.row, "ms": 38550, "sent_ms": 2520, "ttft_ms": 11244,
               "out": 1621, "reasoning": 730, "reasoning_hidden": True, "native_speed": 123.4}
        sample = gateway_sample(row, "thread", self.native, EPOCH + 50000)
        self.assertEqual(sample["ttft_ms"], 11244)
        self.assertEqual(sample["rate"], 123.4)
        self.assertNotAlmostEqual(sample["rate"], 1621 / 36.03)
        self.assertNotAlmostEqual(sample["rate"], 1621 / 27.306)
        self.assertEqual(sample["output_tokens"], 1621)

    def test_native_speed_does_not_depend_on_sent_or_local_duration_math(self):
        for sent in (None, 0, -1, True, "2000", 10000, 10001, 9951):
            with self.subTest(sent=sent):
                sample = self.sample(sent_ms=sent)
                self.assertEqual(sample["rate"], 25)
                self.assertEqual(sample["cache_percent"], 90)
        self.assertEqual(self.sample(sent_ms=None)["ttft_ms"], 3000)
        self.assertEqual(self.sample(sent_ms=0)["ttft_ms"], 3000)

    def test_ttft_can_be_missing_independently_of_tps(self):
        for ttft in (None, 0, -1, True, "3000", 10001):
            with self.subTest(ttft=ttft):
                sample = self.sample(ttft_ms=ttft)
                self.assertIsNone(sample["ttft_ms"])
                self.assertEqual(sample["rate"], 25)

    def test_exact_native_identity_not_model_or_title(self):
        self.assertIsNotNone(self.sample(session="routing-session-override"))
        for changes in ({"native_session": "other"}, {"response_id": "other"},
                        {"agent": "claude"}, {"response_id": None}):
            self.assertIsNone(self.sample(**changes))
        no_id = {**self.native, "last": {**self.native["last"], "response_id": None}}
        self.assertIsNone(gateway_sample(self.row, "thread", no_id, self.now))

    def test_background_subagent_reported_and_failed_rows_are_excluded(self):
        for changes in ({"kind": "thread_title"}, {"kind": "composer_predictions"},
                        {"kind": "guardian"}, {"kind": "collab_spawn"}, {"subagent": "child"},
                        {"parent_agent": "parent"}, {"source": "log"}, {"source": "reported"},
                        {"computer": "remote"}, {"via": "remote"}, {"status": 500},
                        {"handed_on": True}, {"rejected": True}, {"err": "error"}):
            with self.subTest(changes=changes):
                self.assertIsNone(self.sample(**changes))

    def test_unknown_invalid_future_stale_and_previous_turn_timing(self):
        for changes in ({"ms": None}, {"ms": 0}, {"ms": 49}, {"ms": True}, {"out": -1},
                        {"out": "200"}, {"ms": 20000}, {"t": "bad"},
                        {"t": dt.datetime.fromtimestamp((EPOCH - 1000) / 1000, dt.timezone.utc).isoformat()}):
            self.assertIsNone(self.sample(**changes))
        self.assertIsNone(gateway_sample(self.row, "thread", self.native, EPOCH + 911000))
        newer = {**self.native, "turn_id": "next"}
        self.assertIsNone(gateway_sample(self.row, "thread", newer, self.now))

    def test_priority_fallback_failure_and_recovery(self):
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", side_effect=[[self.row], OSError(), [self.row]]), \
                patch("time.time", return_value=self.now / 1000):
            primary, source = gateway.select("thread", self.native, self.source, True)
            self.assertEqual(primary["last"]["source"], "magpie")
            self.assertEqual(source, {"state": "ok", "provider": "magpie"})
            fallback, source = gateway.select("thread", self.native, self.source, True)
            self.assertEqual(fallback["last"], self.native["last"])
            self.assertEqual(fallback["turn_ttft_ms"], 3000)
            self.assertIs(source, self.source)
            restored, _ = gateway.select("thread", self.native, self.source, True)
            self.assertEqual(restored["last"]["rate"], 25)
            self.assertEqual(self.native["last"]["source"], "response")

    def test_poll_budget_chat_switch_and_ambiguous_identity(self):
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", return_value=[self.row]) as read, \
                patch("time.time", return_value=self.now / 1000), patch("time.monotonic", return_value=10):
            gateway.select("thread", self.native, self.source)
            gateway.select("thread", self.native, self.source)
            self.assertEqual(read.call_count, 1)
            result, _ = gateway.select("other", self.native, self.source)
            self.assertEqual(read.call_count, 2)
            self.assertEqual(result["last"], self.native["last"])
            self.assertIsNone(result["turn_speed"])
            read.return_value = [self.row, self.row]
            result, _ = gateway.select("thread", self.native, self.source, True)
            self.assertEqual(result["last"], self.native["last"])
            self.assertEqual(result["turn_ttft_ms"], 3000)

    def test_turn_ttft_freezes_while_latest_tps_and_usage_continue_updating(self):
        gateway = MagpieMeasurements()
        next_native = {**self.native, "last": {**self.native["last"], "response_id": "next"}}
        following = {**self.row, "response_id": "next", "ttft_ms": 7000, "out": 400, "native_speed": 50}
        with patch.object(gateway, "_read", side_effect=[[self.row], [following], OSError()]), \
                patch("time.time", return_value=self.now / 1000):
            first, _ = gateway.select("thread", self.native, self.source, True)
            second, _ = gateway.select("thread", next_native, self.source, True)
            fallback, _ = gateway.select("thread", next_native, self.source, True)
        self.assertEqual(first["turn_ttft_ms"], 3000)
        self.assertEqual(second["turn_ttft_ms"], 3000)
        self.assertEqual(second["last"]["ttft_ms"], 7000)
        self.assertEqual(second["last"]["rate"], 50)
        self.assertEqual(fallback["turn_ttft_ms"], 3000)

    def test_new_turn_and_missing_first_response_do_not_reuse_previous_ttft(self):
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", return_value=[self.row]), patch("time.time", return_value=self.now / 1000):
            first, _ = gateway.select("thread", self.native, self.source, True)
            next_turn = {**self.native, "turn_id": "new", "turn_started_at_ms": EPOCH + 13000,
                         "turn_first_response_id": None}
            pending, _ = gateway.select("thread", next_turn, self.source, True)
        self.assertEqual(first["turn_ttft_ms"], 3000)
        self.assertIsNone(pending.get("turn_ttft_ms"))

    def test_first_response_lookup_expands_once_and_never_borrows_later_ttft(self):
        native = {**self.native, "last": {**self.native["last"], "response_id": "next"}}
        following = {**self.row, "response_id": "next", "ttft_ms": 7000}
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", return_value=[following]) as read, patch("time.time", return_value=self.now / 1000):
            result, _ = gateway.select("thread", native, self.source, True)
            self.assertIsNone(result.get("turn_ttft_ms"))
            self.assertEqual(result["last"]["ttft_ms"], 7000)
            gateway.select("thread", native, self.source, True)
            self.assertEqual(read.call_count, 3)
            self.assertEqual(read.call_args_list[1].kwargs, {"limit": 500})

    def test_long_turn_first_response_can_be_older_than_recent_sample_ttl(self):
        native = {**self.native, "last": {**self.native["last"], "response_id": "next"}}
        following = {**self.row, "response_id": "next", "ttft_ms": 7000,
                     "t": dt.datetime.fromtimestamp((EPOCH + 990000) / 1000, dt.timezone.utc).isoformat()}
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", side_effect=[[following], [self.row, following]]) as read, \
                patch("time.time", return_value=(EPOCH + 1000000) / 1000):
            result, _ = gateway.select("thread", native, self.source, True)
        self.assertEqual(result["turn_ttft_ms"], 3000)
        self.assertEqual(result["last"]["ttft_ms"], 7000)
        self.assertEqual(read.call_args.kwargs, {"limit": 500})

    def test_turn_cache_is_bounded_and_chats_keep_distinct_first_latencies(self):
        gateway = MagpieMeasurements()
        with patch("time.time", return_value=self.now / 1000):
            for n in range(10):
                thread = f"thread-{n}"
                row = {**self.row, "session": thread, "native_session": thread, "ttft_ms": 3000 + n}
                with patch.object(gateway, "_read", return_value=[row]):
                    result, _ = gateway.select(thread, self.native, self.source, True)
                self.assertEqual(result["turn_ttft_ms"], 3000 + n)
        self.assertEqual(len(gateway.turn_ttfts), 8)

    def test_read_is_local_filtered_bounded_and_drops_private_metadata(self):
        with patch.dict(os.environ, {"XDG_CONFIG_HOME": "synthetic-xdg"}):
            self.assertEqual(MagpieMeasurements().settings, Path("synthetic-xdg/magpie/settings.json"))
        with patch.dict(os.environ, {"XDG_CONFIG_HOME": ""}):
            self.assertEqual(MagpieMeasurements().settings, Path.home() / ".config/magpie/settings.json")
        gateway = MagpieMeasurements(Path("synthetic-settings.json"))
        payload = {"rows": [{**self.row, "providerAccount": "private", "body": "private"}]}
        gateway.opener = Mock()
        gateway.opener.open.return_value = io.BytesIO(json.dumps(payload).encode())
        with patch.object(Path, "read_text", return_value='{"port": 4567}'):
            rows = gateway._read("thread")
        args, kwargs = gateway.opener.open.call_args
        address = urllib.parse.urlsplit(args[0])
        self.assertEqual((address.scheme, address.netloc), ("http", "127.0.0.1:4567"))
        query = urllib.parse.parse_qs(address.query)
        self.assertEqual(query["q"], ["thread"])
        self.assertEqual(query["via"], ["through"])
        self.assertEqual(query["agent"], ["codex"])
        self.assertEqual(kwargs["timeout"], .75)
        self.assertNotIn("body", rows[0])
        self.assertNotIn("providerAccount", rows[0])
        self.assertNotIn("sent_ms", rows[0])
        self.assertEqual(rows[0]["ttft_ms"], 3000)

    def test_bad_settings_transport_and_payload_keep_native(self):
        gateway = MagpieMeasurements(Path("synthetic-settings.json"))
        gateway.opener = Mock()
        for settings in ('{}', '{"port": 0}', '{"port": true}', '[]', 'bad'):
            gateway.opener.open.side_effect = urllib.error.URLError("unreachable")
            with patch.object(Path, "read_text", return_value=settings):
                result, _ = gateway.select("thread", self.native, self.source, True)
            self.assertEqual(result["last"], self.native["last"])
            self.assertIsNone(result["turn_speed"])
        gateway.opener.open.side_effect = None
        for payload in (b'bad', b'[]', b'{"rows": {}}', b' ' * (2 * 1024 * 1024 + 1)):
            gateway.opener.open.return_value = io.BytesIO(payload)
            with patch.object(Path, "read_text", return_value='{}'):
                result, _ = gateway.select("thread", self.native, self.source, True)
            self.assertEqual(result["last"], self.native["last"])
            self.assertIsNone(result["turn_speed"])

    def test_monitor_publishes_gateway_metrics_without_frontend_changes(self):
        from src.interface.statistics.collector.metrics import monitor
        measurements = Mock()
        measurements.snapshot.return_value = self.native
        tail = SimpleNamespace(measurements=measurements, source=lambda: self.source)
        row = {"id": "thread", "title": "title", "model": "group/selected"}
        catalog = SimpleNamespace(repository=SimpleNamespace(state="ok"), rows={"thread": row},
                                  refresh=lambda **kw: None, title_matches=lambda title: [row])
        with patch("src.interface.statistics.collector.history.SessionCatalog", return_value=catalog), \
                patch("src.interface.statistics.collector.metrics.TailCache") as cache, \
                patch("src.interface.statistics.collector.metrics.read_selection",
                      return_value={"thread_id": "thread", "title": "title", "refresh_id": "refresh"}), \
                patch.object(MagpieMeasurements, "_read", return_value=[self.row]), \
                patch("time.time", return_value=self.now / 1000):
            cache.return_value.update.return_value = tail
            published = monitor(Path("synthetic-home"), Path("synthetic-runtime"), once=True)
        self.assertEqual(published["thread_id"], "thread")
        self.assertEqual(published["metrics"]["last"]["rate"], 25)
        self.assertEqual(published["metrics"]["last"]["ttft_ms"], 3000)
        self.assertEqual(published["metrics"]["turn_ttft_ms"], 3000)
        self.assertEqual(published["source"]["provider"], "magpie")
        cache.assert_called_once_with(calculate_speed=False)
        self.assertEqual(published["metrics"]["turn_speed"]["rate"], 25)
        self.assertEqual(published["refresh"]["state"], "ok")
        self.assertEqual(published["refresh"]["sample_at_ms"], EPOCH + 11000)

    def test_magpie_speed_holds_across_missing_values_and_api_failure_then_updates(self):
        gateway = MagpieMeasurements()
        following = {**self.row, "response_id": "next", "native_speed": None}
        next_native = {**self.native, "last": {**self.native["last"], "response_id": "next"}}
        with patch.object(gateway, "_read", side_effect=[[self.row], [following], OSError(),
                                                      [{**following, "native_speed": 60}]]), \
                patch("time.time", return_value=self.now / 1000):
            first, _ = gateway.select("thread", self.native, self.source, True)
            missing, _ = gateway.select("thread", next_native, self.source, True)
            failure, _ = gateway.select("thread", next_native, self.source, True)
            updated, _ = gateway.select("thread", next_native, self.source, True)
        self.assertEqual(first["turn_speed"]["rate"], 25)
        self.assertIsNone(missing["last"]["rate"])
        self.assertEqual(missing["turn_speed"]["response_id"], "response")
        self.assertEqual(failure["turn_speed"]["rate"], 25)
        self.assertEqual(updated["turn_speed"]["rate"], 60)

    def test_speed_clears_on_new_turn_and_isolates_chat_and_unknown_boundary(self):
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", return_value=[self.row]), patch("time.time", return_value=self.now / 1000):
            first, _ = gateway.select("thread", self.native, self.source, True)
            other, _ = gateway.select("other", self.native, self.source, True)
            new = {**self.native, "turn_id": "new", "turn_started_at_ms": self.now}
            following, _ = gateway.select("thread", new, self.source, True)
            unknown, _ = gateway.select("thread", {**self.native, "turn_started_at_ms": None}, self.source, True)
        self.assertEqual(first["turn_speed"]["rate"], 25)
        self.assertIsNone(other["turn_speed"])
        self.assertIsNone(following["turn_speed"])
        self.assertIsNone(unknown["turn_speed"])

    def test_connection_failure_and_recovery_switch_only_at_turn_boundary(self):
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", side_effect=[[self.row], OSError(), OSError(), OSError(),
                                                      OSError(), [self.row], [self.row]]), \
                patch("time.time", return_value=self.now / 1000):
            gateway.select("thread", self.native, self.source, True)
            for n in range(3):
                retained, _ = gateway.select("thread", self.native, self.source, True)
                self.assertEqual(retained["speed_mode"], "magpie")
                self.assertEqual(gateway.available, False if n == 2 else True)
            local_turn = {**self.native, "turn_id": "local", "last": {**self.native["last"], "turn_id": "local"}}
            local, local_source = gateway.select("thread", local_turn, self.source, True)
            recovered, _ = gateway.select("thread", local_turn, self.source, True)
            next_turn = {**self.native, "turn_id": "restored", "last": {**self.native["last"], "turn_id": "restored"}}
            restored, _ = gateway.select("thread", next_turn, self.source, True)
        self.assertEqual(local["speed_mode"], "local")
        self.assertEqual(local["turn_speed"]["rate_basis"], "response-request-average-v2")
        self.assertEqual(local["turn_speed"]["rate"], self.native["last"]["rate"])
        self.assertIs(local_source, self.source)
        self.assertEqual(recovered["speed_mode"], "local")
        self.assertEqual(restored["speed_mode"], "magpie")

    def test_unusable_speed_payload_or_http_error_never_confirms_disconnection(self):
        for error in (ValueError(), urllib.error.HTTPError("http://127.0.0.1", 500, "unavailable", {}, None)):
            gateway = MagpieMeasurements()
            with patch.object(gateway, "_read", side_effect=error):
                for n in range(4):
                    native = {**self.native, "turn_id": str(n)}
                    result, _ = gateway.select("thread", native, self.source, True)
                    self.assertEqual(result["speed_mode"], "magpie")
                self.assertIsNot(gateway.available, False)

    def test_offline_polling_backs_off_without_extra_probes(self):
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", side_effect=OSError()) as read, patch("time.monotonic", return_value=10):
            for _ in range(3):
                gateway.select("thread", self.native, self.source, True)
            self.assertEqual(gateway.next_poll, 40)
            gateway.select("thread", self.native, self.source)
            self.assertEqual(read.call_count, 3)

    def test_turn_speed_cache_is_bounded_and_retained_samples_are_immutable(self):
        gateway = MagpieMeasurements()
        with patch.object(gateway, "_read", return_value=[self.row]), patch("time.time", return_value=self.now / 1000):
            first, _ = gateway.select("thread", self.native, self.source, True)
            first["turn_speed"]["rate"] = 999
            again, _ = gateway.select("thread", self.native, self.source, True)
            self.assertEqual(again["turn_speed"]["rate"], 25)
            for n in range(10):
                gateway.select(str(n), self.native, self.source, True)
        self.assertEqual(len(gateway.turn_speeds), 8)


class NativeSpeedChecks(unittest.TestCase):
    def setUp(self):
        self.gateway = MagpieMeasurements()
        self.row = {"route_id": 12, "response_id": "response", "native_session": "thread"}
        self.result = {"calls": 1, "decode_n": 1, "decode_out": 240, "decode_ms": 2000, "rows": [self.row]}

    def test_single_route_uses_magpie_computed_speed_and_caches_it(self):
        with patch.object(self.gateway, "_fetch", return_value=self.result) as fetch:
            self.assertEqual(self.gateway._native_speed("thread", self.row), 120)
            self.assertEqual(self.gateway._native_speed("thread", self.row), 120)
        fetch.assert_called_once_with("thread", route=12)

    def test_missing_speed_or_mixed_routes_are_never_recomputed_locally(self):
        for changed in ({"decode_n": 0}, {"decode_ms": None}, {"decode_out": None},
                        {"calls": 2}, {"calls": True}, {"decode_n": 2}, {"rows": []},
                        {"rows": [self.row, {**self.row, "response_id": "other"}]},
                        {"rows": [{**self.row, "route_id": 13}]},
                        {"rows": [{**self.row, "response_id": "other"}]},
                        {"rows": [{**self.row, "native_session": "other"}]}):
            gateway = MagpieMeasurements()
            with patch.object(gateway, "_fetch", return_value={**self.result, **changed}):
                self.assertIsNone(gateway._native_speed("thread", {**self.row, "out": 10000, "ms": 1}))

    def test_route_api_failure_can_recover_without_poisoning_the_cache(self):
        with patch.object(self.gateway, "_fetch", side_effect=[OSError(), self.result]) as fetch, \
                patch("time.monotonic", return_value=10) as clock:
            self.assertIsNone(self.gateway._native_speed("thread", self.row))
            self.assertIsNone(self.gateway._native_speed("thread", self.row))
            self.assertEqual(fetch.call_count, 1)
            clock.return_value = 13
            self.assertEqual(self.gateway._native_speed("thread", self.row), 120)
        self.assertEqual(fetch.call_count, 2)

    def test_missing_route_does_not_make_a_request(self):
        with patch.object(self.gateway, "_fetch") as fetch:
            self.assertIsNone(self.gateway._native_speed("thread", {"response_id": "response"}))
        fetch.assert_not_called()


if __name__ == "__main__":
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(case)
                               for case in (TimingChecks, MagpieChecks, NativeSpeedChecks))
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    print(json.dumps({"checks": result.testsRun, "passed": result.wasSuccessful()}))
    raise SystemExit(not result.wasSuccessful())
