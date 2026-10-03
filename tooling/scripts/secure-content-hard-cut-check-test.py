from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("secure-content-hard-cut-check.py")
SPEC = importlib.util.spec_from_file_location(
    "secure_content_hard_cut_check",
    SCRIPT,
)
assert SPEC is not None and SPEC.loader is not None
CHECK = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CHECK
SPEC.loader.exec_module(CHECK)


class SecureContentHardCutCheckTest(unittest.TestCase):
    def aliases(self, text: str) -> list[str]:
        return [
            alias
            for _offset, alias in CHECK.retired_audience_target_aliases(text)
        ]

    def test_detects_retired_audience_aliases_across_consumers(self) -> None:
        fixtures = (
            "value := &model.Audience{Kind: model.Audience_CIRCLE, TargetId: 7}",
            "target := audience.GetTargetId()",
            "target := snapshot.Audience.TargetId",
            "const value = draft.audience.targetId;",
            "create(AudienceSchema, { kind, targetId });",
            "const audienceTargetId = intent.value;",
            "pub audience_target_id: Option<String>,",
            "AudienceTargetID string",
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                self.assertTrue(self.aliases(fixture))

    def test_allows_typed_targets_and_unrelated_target_fields(self) -> None:
        fixtures = (
            """
            type Audience struct {
                Target isAudience_Target
            }
            func (x *Audience) GetCircleId() uint64 { return 0 }
            func (x *Audience) GetGroupConversationId() string { return "" }
            """,
            """
            export type Audience =
              Message<"peers_touch.model.social.v1.Audience"> & {
                target: { case: "circleId"; value: bigint }
                  | { case: "groupConversationId"; value: string };
              };
            export const AudienceSchema = {};
            """,
            """
            export type AudienceExplanation = {
              targetId: string;
            };
            const notification = { targetId: "post-1" };
            """,
            """
            let legacy = serde_json::json!({
                "audience_target_id": "42"
            });
            """,
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                self.assertEqual([], self.aliases(fixture))

    def test_audience_requires_both_retired_name_reservations(self) -> None:
        message = CHECK.ProtoMessage(
            fields=frozenset(
                {
                    ("circle_id", 2),
                    ("group_conversation_id", 6),
                }
            ),
            reserved_names=frozenset({"key_envelopes", "target_id"}),
            reserved_ranges=((5, 6),),
        )
        self.assertTrue(
            CHECK.reserved_field(
                message,
                name="key_envelopes",
                number=5,
            )
        )
        self.assertTrue(
            CHECK.reserved_field(
                message,
                name="target_id",
                number=5,
            )
        )


if __name__ == "__main__":
    unittest.main()
