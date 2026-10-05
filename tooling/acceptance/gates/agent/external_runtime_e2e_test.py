#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.gates.agent.external_runtime_e2e import (
    _restart_external_runtime_station,
)
from tooling.acceptance.gates.agent.external_runtime_fixture import (
    external_runtime_environment,
)
from tooling.acceptance.gates.agent.external_runtime_oracle import (
    EXPECTED_ASSERTIONS,
    ExternalRuntimeEvidenceError,
    evaluate_external_runtime_capture,
)


def binding(session: str, epoch: int, home: str, state: int = 1) -> dict:
    return {
        "runtime_kind": 2,
        "provider_id": "external-agent",
        "model_id": "default",
        "runtime_profile_id": "modern-chat-agent-v1",
        "external_session_id": session,
        "external_session_epoch": epoch,
        "runtime_home_ref": home,
        "state": state,
    }


def conversation(
    session: str,
    epoch: int,
    home: str,
    version: int,
    state: int = 1,
) -> dict:
    return {
        "conversation_id": f"conversation-{home}",
        "version": version,
        "runtime_binding": binding(session, epoch, home, state),
    }


def activity(
    processes: int,
    sessions: int,
    bindings: int = 0,
    homes: int = 0,
) -> dict:
    return {
        "owner": "desktop-rust",
        "counters": {
            "runtime_bindings_created": bindings,
            "external_sessions_created": sessions,
            "runtime_homes_created": homes,
            "processes_started": processes,
            "workspaces_created": 0,
        },
    }


def passing_capture() -> dict:
    primary = binding("session-primary", 1, "runtime-home-primary")
    secondary = binding("session-secondary", 1, "runtime-home-secondary")
    failed = conversation(
        "session-primary",
        1,
        "runtime-home-primary",
        8,
        2,
    )
    reset_after = conversation("", 2, "runtime-home-primary-next", 9)
    retry_before = conversation(
        "session-secondary",
        1,
        "runtime-home-secondary",
        6,
        2,
    )
    return {
        "preparation": {
            "fixture": {
                "primarySessionId": "session-primary",
                "secondarySessionId": "session-secondary",
                "primaryHomeRef": "runtime-home-primary",
                "secondaryHomeRef": "runtime-home-secondary",
                "epoch": 1,
            },
            "profile": {
                "runtimes": [
                    {
                        "runtime_id": "external-agent",
                        "state": "RUNTIME_ADVERTISEMENT_STATE_READY",
                    }
                ]
            },
            "activityBefore": activity(0, 0),
            "activityAfter": activity(4, 2, 2, 2),
            "primaryStart": {"binding": primary},
            "primaryFollowUp": {"binding": primary},
            "secondaryStart": {"binding": secondary},
        },
        "restart": {
            "stationRestarted": True,
            "turn": {"binding": primary},
        },
        "secondaryFailure": {
            "before": conversation(
                "session-primary",
                1,
                "runtime-home-primary",
                8,
            ),
            "after": failed,
            "turn": {
                "assistant": {
                    "typedError": {
                        "details": {
                            "runtime_profile_id": "modern-chat-agent-v1",
                            "reason_code": "session_not_found",
                        }
                    }
                }
            },
            "receiver": {
                "visible": True,
                "locale": "zh-CN",
                "errorType": "RUNTIME_RESUME_UNAVAILABLE",
                "localeKey": "agent.errors.resumeUnavailable",
                "retryable": True,
                "terminal": True,
                "resolutionType": "confirmReset",
                "recoveryText": "确认重置",
                "expectedRecoveryText": "确认重置",
                "errorText": "无法恢复",
                "expectedErrorText": "无法恢复",
            },
            "localActivityBefore": activity(0, 0),
            "localActivityAfter": activity(0, 0),
        },
        "nativeReceiver": {
            "visible": True,
            "locale": "en",
            "recoveryText": "Confirm reset",
            "expectedRecoveryText": "Confirm reset",
            "errorText": "Unable to resume",
            "expectedErrorText": "Unable to resume",
        },
        "reset": {
            "before": failed,
            "after": reset_after,
            "concurrentReplay": {
                "replayed": False,
                "closed_external_session_epoch": 1,
                "conversation": reset_after,
            },
            "replay": {
                "replayed": True,
                "closed_external_session_epoch": 1,
                "conversation": reset_after,
            },
            "conflictCode": "ADMISSION_DUPLICATE_CONFLICT",
            "confirmationVisible": True,
            "confirmationText": "确认重置",
            "expectedConfirmationText": "确认重置",
        },
        "cleanupRetry": {
            "before": retry_before,
            "failed": conversation(
                "session-secondary",
                1,
                "runtime-home-secondary",
                6,
                4,
            ),
            "retry": {
                "replayed": False,
                "conversation": conversation(
                    "",
                    2,
                    "runtime-home-secondary-next",
                    7,
                ),
            },
            "firstFailureCode": "RUNTIME_UNAVAILABLE",
        },
        "fresh": {
            "binding": binding(
                "session-primary-fresh",
                2,
                "runtime-home-primary-next",
            )
        },
        "cancellation": {
            "turnId": "turn-cancelled",
            "bindingPreserved": True,
            "receiverVisible": True,
        },
        "productCleanup": {"status": "clean", "failures": []},
        "adapterAudit": {
            "entries": [
                {"successCount": 1, "failureCount": 0},
                {"successCount": 1, "failureCount": 1},
                {"successCount": 1, "failureCount": 0},
            ],
            "runtimeHomeCount": 0,
            "unexpectedEntryCount": 0,
        },
    }


class ExternalRuntimeE2ETest(unittest.TestCase):
    @patch(
        "tooling.acceptance.gates.agent.external_runtime_e2e."
        "_station_container_id",
        side_effect=("container-before", "container-after"),
    )
    @patch(
        "tooling.acceptance.gates.agent.external_runtime_e2e._station_version",
        return_value={"build_commit": "a" * 40},
    )
    @patch(
        "tooling.acceptance.gates.agent.external_runtime_e2e.subprocess.run",
        return_value=subprocess.CompletedProcess(
            args=["make", "station"],
            returncode=0,
            stdout="",
            stderr="",
        ),
    )
    def test_station_restart_reuses_provisioner_source_lease(
        self,
        run: Mock,
        _version: Mock,
        _container: Mock,
    ) -> None:
        result = _restart_external_runtime_station(
            {
                "runId": "run-1",
                "services": {
                    "station": {
                        "endpoint": "http://station.example",
                        "deploymentEnvironment": "station-two",
                    }
                },
            },
            {},
        )

        self.assertTrue(result["stationRestarted"])
        environment = run.call_args.kwargs["env"]
        self.assertEqual(environment["PT_SOURCE_LEASE_HELD"], "1")

    def test_fixture_argv_is_bounded_json_without_newlines(self) -> None:
        environment = external_runtime_environment("run-1")
        self.assertEqual(
            environment["PT_AGENT_EXTERNAL_RUNTIME_ROOT"],
            "/app/data/acceptance-external-runtimes/run-1",
        )
        for name, value in environment.items():
            if not name.endswith("_ARGV_JSON"):
                continue
            argv = json.loads(value)
            self.assertEqual(argv[0:2], ["/bin/sh", "-c"])
            self.assertNotIn("\n", argv[2])
            self.assertLessEqual(len(argv), 64)

    def test_fixture_executes_start_resume_failure_and_retryable_reset(
        self,
    ) -> None:
        environment = external_runtime_environment("run-1")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / "runtime-home-0123456789abcdef0123456789abcdef"
            home.mkdir()
            process_env = {
                **os.environ,
                "PEERS_TOUCH_AGENT_ID": "agent-1",
                "PEERS_TOUCH_CONVERSATION_ID": "conversation-1",
                "PEERS_TOUCH_RUNTIME_PROFILE_ID": "modern-chat-agent-v1",
                "PEERS_TOUCH_EXTERNAL_SESSION_EPOCH": "1",
                "PEERS_TOUCH_EXTERNAL_RUNTIME_HOME": str(home),
            }
            start = json.loads(
                environment["PT_AGENT_EXTERNAL_START_ARGV_JSON"]
            )
            start[-1] = str(home)
            started = subprocess.run(
                start,
                input="first",
                text=True,
                capture_output=True,
                env=process_env,
                check=False,
            )
            self.assertEqual(started.returncode, 0)
            session_id = (home / "session-id").read_text()
            self.assertIn('"type":"session.started"', started.stdout)

            resume = json.loads(
                environment["PT_AGENT_EXTERNAL_RESUME_ARGV_JSON"]
            )
            resume[-2:] = [session_id, str(home)]
            resumed = subprocess.run(
                resume,
                input="follow-up",
                text=True,
                capture_output=True,
                env=process_env,
                check=False,
            )
            self.assertEqual(resumed.returncode, 0)
            self.assertIn("external-resume-ok", resumed.stdout)

            armed = subprocess.run(
                resume,
                input="P12_ARM_RESET_FAILURE",
                text=True,
                capture_output=True,
                env=process_env,
                check=False,
            )
            self.assertEqual(armed.returncode, 0)
            unavailable = subprocess.run(
                resume,
                input="P12_FORCE_RESUME_UNAVAILABLE",
                text=True,
                capture_output=True,
                env=process_env,
                check=False,
            )
            self.assertEqual(unavailable.returncode, 7)
            self.assertIn("resume_unavailable", unavailable.stdout)

            reset = json.loads(
                environment["PT_AGENT_EXTERNAL_RESET_ARGV_JSON"]
            )
            reset[-2:] = [session_id, str(home)]
            failed = subprocess.run(
                reset,
                text=True,
                capture_output=True,
                env=process_env,
                check=False,
            )
            succeeded = subprocess.run(
                reset,
                text=True,
                capture_output=True,
                env=process_env,
                check=False,
            )
            self.assertEqual(failed.returncode, 9)
            self.assertEqual(succeeded.returncode, 0)
            audit = root / "audit" / f"{home.name}.reset"
            self.assertEqual(audit.read_text().splitlines(), ["failed", "success"])

    def test_oracle_accepts_complete_lifecycle(self) -> None:
        assertions = evaluate_external_runtime_capture(passing_capture())
        self.assertEqual(set(assertions), set(EXPECTED_ASSERTIONS))
        self.assertTrue(all(assertions.values()))

    def test_oracle_rejects_duplicate_cleanup(self) -> None:
        capture = passing_capture()
        capture["adapterAudit"]["entries"][0]["successCount"] = 2
        with self.assertRaisesRegex(
            ExternalRuntimeEvidenceError,
            "externalCleanupExecutedExactlyOnce",
        ):
            evaluate_external_runtime_capture(capture)

    def test_oracle_rejects_binding_mutation_before_confirmation(self) -> None:
        capture = passing_capture()
        capture["secondaryFailure"]["after"]["runtime_binding"][
            "external_session_epoch"
        ] = 2
        with self.assertRaisesRegex(
            ExternalRuntimeEvidenceError,
            "bindingPreservedBeforeConfirmation",
        ):
            evaluate_external_runtime_capture(capture)


if __name__ == "__main__":
    unittest.main()
