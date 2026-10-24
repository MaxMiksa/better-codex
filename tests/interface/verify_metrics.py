"""Synthetic timing regressions; no app, network, or real conversation reads."""
import datetime as dt
import json
import unittest

from src.interface.statistics.collector.metrics import Measurements


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


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TimingChecks)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    print(json.dumps({"checks": result.testsRun, "passed": result.wasSuccessful()}))
    raise SystemExit(not result.wasSuccessful())
