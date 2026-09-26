from __future__ import annotations

import unittest
from types import SimpleNamespace
from typing import Any, Mapping

from tooling.development.secure_content.run import RunnerError
from tooling.development.secure_content.scenarios import mobile_matrix


class _Manifest:
    def __init__(self, clients: Mapping[str, Mapping[str, str]]) -> None:
        self.clients = dict(clients)

    def client(self, client_id: str) -> Mapping[str, str]:
        return self.clients[client_id]

    def service_for_client(
        self,
        _client_id: str,
        _role: str,
    ) -> tuple[str, Mapping[str, str]]:
        return "station-four", {"profile_id": "four"}


def _clients(*, platform: str, include_eve: bool = True) -> dict[str, dict[str, str]]:
    runtime_kind = (
        "tauri-ios-simulator"
        if platform == "ios"
        else "tauri-android-emulator"
    )
    roles = ("alice", "bob", "eve") if include_eve else ("alice", "bob")
    return {
        f"{platform}_{role}": {
            "actor_role": role,
            "runtime_kind": runtime_kind,
        }
        for role in roles
    }


class _Context:
    runtime = "mobile"
    profile = "four"
    profiles = ("four",)
    journey_id = "sc-dj-mobile-matrix"
    required_fixture_capabilities = frozenset(
        {mobile_matrix.FIXTURE_CAPABILITY}
    )

    def __init__(self, clients: tuple[str, ...]) -> None:
        self.clients = clients
        manifest_clients = {
            **_clients(platform="ios"),
            **_clients(platform="android"),
        }
        self._manifest = _Manifest(manifest_clients)
        self.operations: list[str] = []

    def require_runtime_manifest(self) -> _Manifest:
        return self._manifest

    def invoke_fixture_action(
        self,
        capability: str,
        operation: str,
        payload: Mapping[str, object],
    ) -> Mapping[str, Any]:
        self.assert_equal(capability, mobile_matrix.FIXTURE_CAPABILITY)
        self.assert_equal(payload["variant"], mobile_matrix._variant_for_clients(
            self.runtime,
            self.clients,
        ))
        self.operations.append(operation)
        if operation == "cross-platform-receivers":
            outcome: dict[str, Any] = {
                "completed": True,
                "variant": "cross-platform",
                "directions": sorted(mobile_matrix.CROSS_PLATFORM_DIRECTIONS),
                "exactContentMatch": True,
                "portableCoreShared": True,
            }
        else:
            outcome = {
                "completed": True,
                "variant": mobile_matrix._variant_for_clients(
                    self.runtime,
                    self.clients,
                ),
                "observedStates": sorted(
                    mobile_matrix.PLATFORM_OPERATIONS[operation]
                ),
            }
        outcome.update(
            {
                "partialPlaintextBytes": 0,
                "publicFallbackUsed": False,
                "receiverObservationDigests": ["a" * 64],
            }
        )
        return {"outcome": outcome}

    @staticmethod
    def assert_equal(left: object, right: object) -> None:
        if left != right:
            raise AssertionError(f"{left!r} != {right!r}")


class MobileMatrixScenarioTest(unittest.TestCase):
    def test_platform_variants_are_exact_and_disjoint(self) -> None:
        self.assertEqual(
            "ios",
            mobile_matrix._variant_for_clients(
                "mobile",
                ("ios_alice", "ios_bob", "ios_eve"),
            ),
        )
        self.assertEqual(
            "android",
            mobile_matrix._variant_for_clients(
                "mobile",
                ("android_alice", "android_bob", "android_eve"),
            ),
        )
        self.assertEqual(
            "cross-platform",
            mobile_matrix._variant_for_clients(
                "mobile",
                (
                    "ios_alice",
                    "ios_bob",
                    "android_alice",
                    "android_bob",
                ),
            ),
        )
        with self.assertRaisesRegex(
            RunnerError,
            "exactly one declared",
        ):
            mobile_matrix._variant_for_clients(
                "mobile",
                ("ios_alice", "android_bob"),
            )

    def test_ios_executes_every_required_state_family(self) -> None:
        context = _Context(("ios_alice", "ios_bob", "ios_eve"))

        result = mobile_matrix._execute(context)  # type: ignore[arg-type]

        self.assertEqual("ios", result["platformVariant"])
        self.assertEqual(
            list(mobile_matrix.PLATFORM_OPERATIONS),
            context.operations,
        )
        self.assertEqual(
            set(mobile_matrix.PLATFORM_OPERATIONS),
            set(result["observations"]),
        )

    def test_cross_platform_requires_both_directions(self) -> None:
        context = _Context(
            ("ios_alice", "ios_bob", "android_alice", "android_bob")
        )

        result = mobile_matrix._execute(context)  # type: ignore[arg-type]

        self.assertEqual(["cross-platform-receivers"], context.operations)
        self.assertEqual(
            sorted(mobile_matrix.CROSS_PLATFORM_DIRECTIONS),
            result["observations"]["cross-platform-receivers"]["directions"],
        )

    def test_rejects_partial_state_coverage(self) -> None:
        context = _Context(("android_alice", "android_bob", "android_eve"))
        original = context.invoke_fixture_action

        def incomplete(
            capability: str,
            operation: str,
            payload: Mapping[str, object],
        ) -> Mapping[str, Any]:
            result = dict(original(capability, operation, payload))
            if operation == "publish-states":
                outcome = dict(result["outcome"])
                outcome["observedStates"] = ["PUBLISHED"]
                result["outcome"] = outcome
            return result

        context.invoke_fixture_action = incomplete  # type: ignore[method-assign]
        with self.assertRaisesRegex(
            RunnerError,
            "state coverage is incomplete",
        ):
            mobile_matrix._execute(context)  # type: ignore[arg-type]

    def test_rejects_public_fallback_or_partial_plaintext(self) -> None:
        for field, value, message in (
            ("publicFallbackUsed", True, "PUBLIC fallback"),
            ("partialPlaintextBytes", 1, "partial plaintext"),
        ):
            with self.subTest(field=field):
                context = _Context(("ios_alice", "ios_bob", "ios_eve"))
                original = context.invoke_fixture_action

                def invalid(
                    capability: str,
                    operation: str,
                    payload: Mapping[str, object],
                    *,
                    field: str = field,
                    value: object = value,
                ) -> Mapping[str, Any]:
                    result = dict(original(capability, operation, payload))
                    outcome = dict(result["outcome"])
                    outcome[field] = value
                    result["outcome"] = outcome
                    return result

                context.invoke_fixture_action = invalid  # type: ignore[method-assign]
                with self.assertRaisesRegex(RunnerError, message):
                    mobile_matrix._execute(context)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
