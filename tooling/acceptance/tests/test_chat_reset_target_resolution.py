"""Multi-Station Fixture resolution must not depend on the active Profile."""

from __future__ import annotations

from contextlib import ExitStack
import copy
import json
import os
import subprocess
import unittest
from unittest.mock import patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.fixtures import chat_native_reset as reset
from tooling.acceptance.fixtures import chat_reset_targets as targets


class ChatResetTargetResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profiles = {
            "chat-native-disposable": {
                "profile": "chat-native-disposable",
                "resetPolicy": "agent-resettable",
                "environment": "chat-station",
                "stationUrl": "http://192.0.2.40:18132",
            },
            "fiveArm": {
                "profile": "fiveArm",
                "resetPolicy": "agent-resettable",
                "environment": "five-station",
                "stationUrl": "http://192.0.2.50:18080",
            },
        }
        bindings = {
            target["environment"]: profile
            for profile, target in self.profiles.items()
        }
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ, {
            targets.PROFILE_BINDINGS_ENV: json.dumps(bindings),
            "PT_MACHINE_LEASE_RESET_SCOPE": "chat-native-actors",
        }, clear=True))
        self.authority = stack.enter_context(patch.object(
            targets, "require_station_reset_authority",
        ))
        self.registry = stack.enter_context(patch.object(
            targets, "_reviewed_profile", side_effect=self.profiles.__getitem__,
        ))
        stack.enter_context(patch.object(
            reset, "active_profile_environment", return_value={
                "PT_STATION_MODE": "remote", "PT_DEV_PROFILE": "fiveArm",
                "PT_STATION_DEPLOY_ENV": "five-station",
                "PT_STATION_URL": self.profiles["fiveArm"]["stationUrl"],
            },
        ))
        self.active = stack.enter_context(patch.object(
            reset, "active_deployment_environment",
            side_effect=AssertionError("bound URL must resolve before active fallback"),
        ))
        self.deployment = stack.enter_context(patch.object(
            reset, "deploy_environment", side_effect=self.deploy_environment,
        ))

    def deploy_environment(self, environment: str) -> dict[str, str]:
        target = next(
            target for target in self.profiles.values()
            if target["environment"] == environment
        )
        return {
            "PT_DEPLOY_HOST": target["stationUrl"].split("//")[1].split(":")[0],
            "PT_DEPLOY_USER": "acceptance",
            "PT_DEPLOY_RESTART_CMD": f"docker compose -p {environment} up -d station",
        }

    def assert_diagnostic(self, error: BlockedError) -> dict:
        self.assertIsNotNone(error.diagnostic)
        error.diagnostic.require_resource(error.resource)
        diagnostic = error.diagnostic.to_dict()
        self.assertEqual(diagnostic["owner"], "chat-fixture-target")
        self.assertTrue(diagnostic["recoveryAction"])
        self.assertEqual(diagnostic["resourceChecks"][0]["state"], "OBSERVED")
        return diagnostic["resourceChecks"][0]

    def test_both_implicit_urls_resolve_with_secondary_active(self) -> None:
        for target in self.profiles.values():
            with self.subTest(profile=target["profile"]):
                self.authority.reset_mock()
                self.registry.reset_mock()
                resolved = reset.acceptance_station_environment(target["stationUrl"] + "/")
                self.assertEqual(
                    resolved["PT_ACCEPTANCE_STATION_URL"], target["stationUrl"],
                )
                self.assertEqual(
                    resolved["PT_ACCEPTANCE_COMPOSE_PROJECT"], target["environment"],
                )
                self.deployment.assert_called_with(target["environment"])
                self.authority.assert_called_once_with("chat-native-actors")
                self.assertEqual(
                    [call.args[0] for call in self.registry.call_args_list],
                    list(self.profiles),
                )
        self.active.assert_not_called()
        self.authority.assert_called_with("chat-native-actors")

    def test_explicit_target_resolves_only_its_profile_once(self) -> None:
        resolved = reset.acceptance_station_environment(
            self.profiles["chat-native-disposable"]["stationUrl"], "chat-station",
        )
        self.assertEqual(resolved["PT_ACCEPTANCE_ENVIRONMENT"], "chat-station")
        self.registry.assert_called_once_with("chat-native-disposable")
        self.authority.assert_called_once_with("chat-native-actors")
        self.deployment.assert_called_once_with("chat-station")
        self.active.assert_not_called()

    def test_bound_remote_targets_ignore_unrelated_active_profile_failure(self) -> None:
        with patch.object(
            reset, "active_profile_environment",
            side_effect=subprocess.TimeoutExpired("machine-dev profile", 10),
        ) as active_profile:
            for target in self.profiles.values():
                for environment in (None, target["environment"]):
                    with self.subTest(profile=target["profile"], environment=environment):
                        self.authority.reset_mock()
                        self.registry.reset_mock()
                        self.deployment.reset_mock()
                        resolved = reset.acceptance_station_environment(
                            target["stationUrl"] + "/", environment,
                        )
                        self.assertEqual(
                            resolved["PT_ACCEPTANCE_STATION_URL"], target["stationUrl"],
                        )
                        self.assertEqual(
                            resolved["PT_ACCEPTANCE_ENVIRONMENT"], target["environment"],
                        )
                        self.authority.assert_called_once_with("chat-native-actors")
                        self.assertEqual(
                            [call.args[0] for call in self.registry.call_args_list],
                            list(self.profiles) if environment is None else [target["profile"]],
                        )
                        self.deployment.assert_called_once_with(target["environment"])
                        active_profile.assert_not_called()
        self.active.assert_not_called()

    def test_explicit_secondary_environment_rejects_primary_url(self) -> None:
        with self.assertRaises(BlockedError) as caught:
            reset.acceptance_station_environment(
                self.profiles["chat-native-disposable"]["stationUrl"], "five-station",
            )
        check = self.assert_diagnostic(caught.exception)
        self.assertEqual(check["expected"], self.profiles["fiveArm"])
        self.assertEqual(check["observed"]["environment"], "five-station")
        self.active.assert_not_called()

    def test_unbound_explicit_environment_rejects_without_fallback(self) -> None:
        with self.assertRaises(BlockedError) as caught:
            targets.bound_reset_target("unknown-station", "")
        check = self.assert_diagnostic(caught.exception)
        self.assertEqual(check["observed"]["environment"], "unknown-station")

    def test_unknown_or_nonexact_urls_reject_before_deployment(self) -> None:
        primary = self.profiles["chat-native-disposable"]["stationUrl"]
        for url in ("", "http://192.0.2.60:18132", primary + "/path",
                    primary + "?x=1", primary.replace("http:", "https:")):
            with self.subTest(url=url), self.assertRaises(BlockedError) as caught:
                reset.acceptance_station_environment(url)
            check = self.assert_diagnostic(caught.exception)
            self.assertEqual(check["observed"]["matchingTargetCount"], 0)
        self.deployment.assert_not_called()
        self.active.assert_not_called()

    def test_ambiguous_url_rejects_before_deployment(self) -> None:
        primary = self.profiles["chat-native-disposable"]["stationUrl"]
        self.profiles["fiveArm"]["stationUrl"] = primary
        with self.assertRaises(BlockedError) as caught:
            reset.acceptance_station_environment(primary)
        check = self.assert_diagnostic(caught.exception)
        self.assertEqual(check["observed"]["matchingTargetCount"], 2)
        self.deployment.assert_not_called()

    def test_profile_deployment_drift_rejects(self) -> None:
        self.profiles["fiveArm"]["environment"] = "drifted"
        with self.assertRaises(BlockedError) as caught:
            targets.bound_reset_target("", self.profiles["fiveArm"]["stationUrl"])
        check = self.assert_diagnostic(caught.exception)
        self.assertEqual(check["expected"]["environment"], "drifted")
        self.assertEqual(check["observed"]["environment"], "five-station")

    def test_invalid_binding_payloads_reject_with_observation(self) -> None:
        for raw in ("invalid-json", "[]", "{}", '{"five-station": null}'):
            with self.subTest(raw=raw), patch.dict(os.environ, {
                targets.PROFILE_BINDINGS_ENV: raw,
            }), self.assertRaises(BlockedError) as caught:
                targets.bound_reset_target("", self.profiles["fiveArm"]["stationUrl"])
            self.assertFalse(self.assert_diagnostic(caught.exception)["observed"]["validMapping"])

    def test_missing_scope_rejects_before_profile_lookup(self) -> None:
        os.environ.pop("PT_MACHINE_LEASE_RESET_SCOPE")
        with self.assertRaises(BlockedError) as caught:
            targets.bound_reset_target("", self.profiles["fiveArm"]["stationUrl"])
        self.assertFalse(self.assert_diagnostic(caught.exception)["observed"]["resetScopePresent"])
        self.registry.assert_not_called()

    def test_rejected_lease_preserves_actual_reason(self) -> None:
        self.authority.side_effect = BlockedError(
            "actual held-lease verification rejected", "station.reset:chat-native-actors",
        )
        with self.assertRaises(BlockedError) as caught:
            targets.bound_reset_target("", self.profiles["fiveArm"]["stationUrl"])
        check = self.assert_diagnostic(caught.exception)
        self.assertEqual(check["observed"]["reason"], "actual held-lease verification rejected")
        self.registry.assert_not_called()

    def test_stable_registry_target_remains_protected(self) -> None:
        response = subprocess.CompletedProcess([], 0, stdout=json.dumps({
            **self.profiles["fiveArm"], "resetPolicy": "stable-protected",
        }))
        with patch.object(targets.subprocess, "run", return_value=response):
            with self.assertRaises(BlockedError) as caught:
                self.original_reviewed_profile("fiveArm")
        check = self.assert_diagnostic(caught.exception)
        self.assertEqual(check["observed"]["resetPolicy"], "stable-protected")

    original_reviewed_profile = staticmethod(targets._reviewed_profile)

    def test_unbound_calls_retain_active_profile_resolution(self) -> None:
        os.environ.pop(targets.PROFILE_BINDINGS_ENV)
        self.active.side_effect = None
        self.active.return_value = "five-station"
        with patch.object(reset, "_authorized_reset_environment", return_value=(
            self.profiles["fiveArm"]["stationUrl"], {
                **self.deploy_environment("five-station"),
                "PT_ACCEPTANCE_DISPOSABLE": "1",
                "PT_ACCEPTANCE_STATION_URL": self.profiles["fiveArm"]["stationUrl"],
                "PT_ACCEPTANCE_COMPOSE_PROJECT": "five-station",
                "PT_ACCEPTANCE_STATION_CONTAINER": "five-station-station-1",
                "PT_ACCEPTANCE_POSTGRES_CONTAINER": "five-station-postgres-1",
                "PT_ACCEPTANCE_POSTGRES_VOLUME": "five-station_pg_data",
            },
        )):
            reset.acceptance_station_environment(self.profiles["fiveArm"]["stationUrl"])
        self.active.assert_called_once_with()


class GroupSfuRestartTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = {
            "kind": "station", "endpoint": "http://192.0.2.50:18132",
            "deploymentEnvironment": "secondary-station",
        }
        self.url = "ws://192.0.2.50:7880"
        self.environment = {
            "PT_DEPLOY_HOST": "192.0.2.50", "PT_ACCEPTANCE_COMPOSE_PROJECT": "pt-secondary",
            "PT_ACCEPTANCE_STATION_CONTAINER": "pt-secondary-station-1",
            "PT_ACCEPTANCE_ENVIRONMENT": "secondary-station",
        }
        self.before = {
            "container": "/pt-secondary-livekit-1", "imageId": "sha256:" + "a" * 64,
            "labels": {
                "com.docker.compose.project": "pt-secondary",
                "com.docker.compose.service": "livekit",
                "org.opencontainers.image.source": "https://github.com/livekit/livekit",
                "org.opencontainers.image.revision": reset.GROUP_SFU_SOURCE_REVISION,
                "net.peers-touch.group-admission": reset.GROUP_SFU_ADMISSION_CONTRACT,
            },
            "state": {"Running": True, "StartedAt": "before", "Health": {"Status": "healthy"}},
            "ports": {"7880/tcp": [{"HostIp": "0.0.0.0", "HostPort": "7880"}]},
        }
        self.after = copy.deepcopy(self.before)
        self.after["state"]["StartedAt"] = "after"
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ, {"CHAT_ACCEPTANCE_ALLOW_SFU_RESTART": "1"}))
        self.target = stack.enter_context(patch.object(
            reset, "acceptance_station_environment", return_value=self.environment,
        ))
        stack.enter_context(patch.object(
            reset, "verify_disposable_station_runtime", return_value={"composeProject": "pt-secondary"},
        ))
        self.remote = stack.enter_context(patch.object(reset, "_remote_command"))

    def responses(self, before: dict | None = None, after: dict | None = None) -> None:
        self.remote.side_effect = [
            self.url, json.dumps(before or self.before), "pt-secondary-livekit-1",
            json.dumps(after or self.after),
        ]

    def test_restart_preserves_image_and_reads_new_healthy_runtime(self) -> None:
        self.responses()
        result = reset.restart_acceptance_group_sfu(self.service, self.url)
        self.target.assert_called_once_with(self.service["endpoint"], "secondary-station")
        self.assertEqual(result["before"]["imageId"], result["after"]["imageId"])
        self.assertNotEqual(result["before"]["startedAt"], result["after"]["startedAt"])
        self.assertEqual(result["after"]["health"], "healthy")
        commands = [call.args[1] for call in self.remote.call_args_list]
        self.assertEqual(commands[2], "docker restart pt-secondary-livekit-1")
        self.assertNotIn("postgres", "\n".join(commands))
        self.assertNotIn("LIVEKIT_API_SECRET", json.dumps(result))

    def test_restart_rejects_foreign_targets_before_mutation(self) -> None:
        for url in (
            "ws://192.0.2.60:7880", self.url + "/path", self.url + "?token=secret",
            "ws://user:secret@192.0.2.50:7880", self.url.replace(":7880", ":7882"),
        ):
            with self.subTest(url=url):
                self.responses()
                # Keep the Station declaration equal to the candidate so the
                # real host/path/port guard, rather than the URL readback, rejects.
                self.remote.side_effect = [
                    url, json.dumps(self.before), "pt-secondary-livekit-1", json.dumps(self.after),
                ]
                with self.assertRaises(RuntimeError):
                    reset.restart_acceptance_group_sfu(self.service, url)
                self.assertFalse(any("docker restart" in c.args[1] for c in self.remote.call_args_list))
                self.remote.reset_mock()

    def test_restart_rejects_unapproved_container_source_and_health(self) -> None:
        variants = []
        for label, value in (
            ("com.docker.compose.project", "production"),
            ("com.docker.compose.service", "station"),
            ("org.opencontainers.image.revision", "stock"),
            ("net.peers-touch.group-admission", "unknown"),
        ):
            candidate = copy.deepcopy(self.before)
            candidate["labels"][label] = value
            variants.append(candidate)
        unhealthy = copy.deepcopy(self.before)
        unhealthy["state"]["Health"]["Status"] = "unhealthy"
        variants.append(unhealthy)
        for candidate in variants:
            with self.subTest(candidate=candidate):
                self.responses(before=candidate)
                with self.assertRaises(RuntimeError):
                    reset.restart_acceptance_group_sfu(self.service, self.url)
                self.assertFalse(any("docker restart" in c.args[1] for c in self.remote.call_args_list))
                self.remote.reset_mock()

    def test_restart_rejects_image_drift_and_unchanged_process(self) -> None:
        for field in ("imageId", "startedAt"):
            candidate = copy.deepcopy(self.after)
            if field == "imageId":
                candidate["imageId"] = "sha256:" + "b" * 64
            else:
                candidate["state"]["StartedAt"] = "before"
            with self.subTest(field=field):
                self.responses(after=candidate)
                with self.assertRaisesRegex(RuntimeError, "image changed|timestamp did not change"):
                    reset.restart_acceptance_group_sfu(self.service, self.url)

    def test_restart_requires_authorization_and_declared_station_url(self) -> None:
        with patch.dict(os.environ, {"CHAT_ACCEPTANCE_ALLOW_SFU_RESTART": "0"}):
            with self.assertRaisesRegex(RuntimeError, "ALLOW_SFU_RESTART"):
                reset.restart_acceptance_group_sfu(self.service, self.url)
        self.remote.assert_not_called()
        self.remote.return_value = "ws://192.0.2.50:7882"
        with self.assertRaisesRegex(RuntimeError, "Station declaration"):
            reset.restart_acceptance_group_sfu(self.service, self.url)
        self.assertEqual(self.remote.call_count, 1)

    def test_restart_health_deadline_is_bounded(self) -> None:
        candidate = copy.deepcopy(self.after)
        candidate["state"]["Health"]["Status"] = "starting"
        self.responses(after=candidate)
        with patch.object(reset.time, "monotonic", side_effect=[0, 1, 121]), \
                patch("threading.Event.wait") as wait:
            with self.assertRaisesRegex(RuntimeError, "did not become healthy"):
                reset.restart_acceptance_group_sfu(self.service, self.url)
        wait.assert_called_once_with(1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
