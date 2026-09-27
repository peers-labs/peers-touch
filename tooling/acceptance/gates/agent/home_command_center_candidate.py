#!/usr/bin/env python3
"""Produce the exact-source 33-tuple Home Command Center candidate."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    source_identity,
    workspace_id,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2CandidateError,
    AgentV2RuntimeAttestation,
    AgentV2RuntimeTuple,
    AgentV2TupleObservation,
)
from tooling.acceptance.gates.agent.foundation_mobile_contract_adapter import (
    _parse_vitest_report,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
    FoundationRuntimeClient,
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.foundation_scenario_runner import (
    _build_client_manifest,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_HOME_GATE,
    HomeStationProvisioner,
)


PROFILE = "two"
ACTOR_ACCOUNT = "bob@p.t"
WORK_ITEM_ID = "MCA-A02-PR112"
MOBILE_MARKER = "[home-mobile-cell:AS-15-V2-H01]"
MOBILE_TEST_PATH = Path("apps/mobile/src/contracts/agentV2Contract.test.ts")
MOBILE_SOURCE_PATHS = (
    MOBILE_TEST_PATH,
    Path("apps/mobile/src/gen/proto/domain/agent/home_pb.ts"),
)
MOBILE_TEST_COMMAND = (
    "pnpm",
    "--dir",
    "apps/mobile",
    "test:agent-contract",
    "--reporter=json",
)


class HomeCommandCenterCandidateError(RuntimeError):
    """The Home Journey cannot produce runtime-truthful candidate evidence."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise HomeCommandCenterCandidateError(message)


def _load_script(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise HomeCommandCenterCandidateError(f"cannot load script: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _positive_integer(value: Any, label: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError) as error:
        raise HomeCommandCenterCandidateError(
            f"{label} is not an integer"
        ) from error
    require(result > 0, f"{label} must be positive")
    return result


def _mapping(value: Any, label: str) -> dict[str, Any]:
    require(isinstance(value, Mapping), f"{label} must be an object")
    return dict(value)


def _string(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(value), f"{label} is missing")
    return value


def resolve_machine_profile() -> tuple[str, Path, int, dict[str, str]]:
    completed = subprocess.run(
        ["node", "tooling/scripts/local-dev/machine-dev.mjs", "resolve"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    require(
        completed.returncode == 0,
        "machine control plane did not resolve the active profile",
    )
    try:
        resolved = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise HomeCommandCenterCandidateError(
            "machine control plane returned invalid JSON"
        ) from error
    binding = _mapping(resolved.get("binding"), "machine binding")
    profile = _mapping(resolved.get("profile"), "machine profile")
    ports = _mapping(resolved.get("ports"), "machine ports")
    require(
        resolved.get("authority") == "machine-control-plane",
        "machine profile has no canonical authority",
    )
    require(
        binding.get("workspaceId") == workspace_id(ROOT)
        and binding.get("canonicalRoot") == str(ROOT)
        and binding.get("head") == source_identity(ROOT)["commit"],
        "machine control plane worktree identity mismatch",
    )
    require(
        profile.get("sourceState") == "tracked-clean",
        "Home candidate requires a tracked-clean source snapshot",
    )
    profile_name = _string(binding.get("profile"), "active profile")
    profile_file = Path(
        _string(profile.get("profileFile"), "profile file")
    ).resolve()
    slot = int(binding.get("slot"))
    values = load_env_file(profile_file)
    values.update(
        {
            "PT_DEV_PROFILE": profile_name,
            "PT_DEV_SLOT": str(slot),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(ports["desktopAppGateway"]),
            "PT_DESKTOP_APP_WEB_PORT": str(ports["desktopAppWeb"]),
            "PT_DESKTOP_WEB_GATEWAY_PORT": str(ports["desktopWebGateway"]),
            "PT_DESKTOP_WEB_WEB_PORT": str(ports["desktopWebWeb"]),
        }
    )
    return profile_name, profile_file, slot, values


def _authenticate(
    client: FoundationRuntimeClient,
    profile_env: Mapping[str, str],
) -> str:
    for attempt in range(60):
        try:
            client.configure_station(timeout=60)
            break
        except FoundationClientError as error:
            if (
                "Another Station switch is already in progress" not in str(error)
                or attempt == 59
            ):
                raise
            time.sleep(0.25)
    login = client.harness(
        "loginWithPassword",
        {
            "account": ACTOR_ACCOUNT,
            "password": profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
        },
        timeout=120,
    )
    login = _mapping(login, f"{client.spec.runtime} login")
    require(login.get("authenticated") is True, "Home client login failed")
    actor_id = _string(login.get("actorId"), "Home actor identity")
    health = client.harness("getAcceptanceHarnessStatus", {}, timeout=30)
    require(
        isinstance(health, Mapping) and health.get("ready") is True,
        f"{client.spec.runtime} Agent Harness is unavailable",
    )
    return actor_id


def _role_payloads(
    capture: Mapping[str, Any],
    cleanup: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    require(cleanup.get("status") == "clean", "Home fixture cleanup failed")
    roles = _mapping(capture.get("roles"), "Home role observations")
    result = {
        role: _mapping(payload, f"Home role {role}")
        for role, payload in roles.items()
    }
    result["cleanup"] = dict(cleanup)
    return result


def observation_from_home_capture(
    runtime_tuple: AgentV2RuntimeTuple,
    capture: Mapping[str, Any],
    cleanup: Mapping[str, Any],
    *,
    actor_identity_hash: str,
    machine: str,
) -> AgentV2TupleObservation:
    runtime = _mapping(capture.get("runtime"), "Home runtime capture")
    state = _mapping(capture.get("state"), "Home scenario state")
    scenario_execution_id = _string(
        runtime.get("scenarioExecutionId"),
        "Home scenario execution ID",
    )
    require(
        state.get("scenarioExecutionId") == scenario_execution_id
        and state.get("cell") == runtime_tuple.cell
        and state.get("locale") == runtime_tuple.locale
        and state.get("ordering") == runtime_tuple.ordering
        and state.get("sampleId") == runtime_tuple.sample_id,
        "Home capture tuple identity mismatch",
    )
    require(
        state.get("actorPtid") == runtime.get("actorPtid")
        and runtime.get("actorPtid")
        and _hash_text(str(runtime["actorPtid"])) == actor_identity_hash,
        "Home capture actor differs from the authenticated actor",
    )
    object_ids = runtime.get("objectIds")
    require(
        isinstance(object_ids, list)
        and object_ids
        and all(isinstance(item, str) and item for item in object_ids),
        "Home command object IDs are missing",
    )
    assertions = _mapping(capture.get("assertions"), "Home assertions")
    require(
        bool(assertions)
        and all(value is True for value in assertions.values()),
        "Home Harness assertions did not all pass",
    )
    if runtime_tuple.cell in {"AS-02", "AS-13"}:
        recovery = _mapping(capture.get("recovery"), "Home recovery capture")
        require(
            recovery.get("recovered") is True,
            "Home restart recovery evidence is missing",
        )
    if runtime_tuple.cell == "R-11":
        barrier = _mapping(capture.get("barrier"), "Home R-11 barrier")
        orderings = barrier.get("orderings")
        require(
            isinstance(orderings, list)
            and len(orderings) == 2
            and {
                item.get("kind")
                for item in orderings
                if isinstance(item, Mapping)
            }
            == {
                "home-chat-idempotency",
                "home-task-idempotency",
            }
            and all(
                isinstance(item, Mapping)
                and item.get("ordering") == runtime_tuple.ordering
                for item in orderings
            ),
            "Home R-11 barrier evidence is incomplete",
        )
    attestation = AgentV2RuntimeAttestation(
        "station_command",
        {
            "scenarioExecutionId": scenario_execution_id,
            "actorIdentityHash": actor_identity_hash,
            "commandAttestation": {
                "commandId": _string(
                    runtime.get("commandId"),
                    "Home command ID",
                ),
                "commandKind": _string(
                    runtime.get("commandKind"),
                    "Home command kind",
                ),
                "idempotencyKeyHash": _string(
                    runtime.get("idempotencyKeyHash"),
                    "Home idempotency hash",
                ),
                "objectIds": object_ids,
                "projectionRevision": _positive_integer(
                    runtime.get("projectionRevision"),
                    "Home projection revision",
                ),
            },
            "stationProfile": PROFILE,
            "desktopMode": runtime_tuple.platform,
            "networkPath": "desktop-home->station-command",
            "machine": machine,
            "coldWarmState": "neutral",
            "observedAt": _string(
                runtime.get("observedAt"),
                "Home observation time",
            ),
        },
    )
    roles = _role_payloads(capture, cleanup)
    require(
        set(roles) == runtime_tuple.role_policy.adapter_roles,
        "Home role applicability differs from the reviewed matrix",
    )
    receiver = roles["receiver-dom"]
    require(
        receiver.get("scenarioId") == runtime_tuple.cell
        and receiver.get("cellId") == runtime_tuple.cell
        and receiver.get("locale") == runtime_tuple.locale,
        "Home receiver evidence tuple identity mismatch",
    )
    commands = roles["command-ids"]
    require(
        commands.get("commandId") == runtime["commandId"]
        and commands.get("idempotencyKeyHash")
        == runtime["idempotencyKeyHash"]
        and commands.get("objectIds") == object_ids,
        "Home command evidence differs from runtime attestation",
    )
    station = roles["station-readback"]
    require(
        str(station.get("revision")) == str(runtime["projectionRevision"]),
        "Home Station revision differs from runtime attestation",
    )
    for role in ("station-readback", "projection-revisions"):
        payload = roles.get(role)
        require(payload is not None, f"Home {role} evidence is missing")
        for field in (
            ("revision",)
            if role == "station-readback"
            else ("beforeRevision", "afterRevision")
        ):
            payload[field] = _positive_integer(
                payload.get(field),
                f"Home {role}.{field}",
            )
    return AgentV2TupleObservation(
        tuple_key=runtime_tuple.key,
        observed=True,
        passed=True,
        runtime_attestation=attestation,
        role_observations=roles,
    )


class HomeRuntimeAdapter:
    """Execute one fresh Home fixture for each Desktop or Browser tuple."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        profile_env: Mapping[str, str],
    ) -> None:
        self._runtime_pair = runtime_pair
        self._profile_env = dict(profile_env)
        self._actors = {
            "desktop_app": _authenticate(runtime_pair.native, profile_env),
            "browser": _authenticate(runtime_pair.browser, profile_env),
        }
        require(
            len(set(self._actors.values())) == 1,
            "Native and Browser clients authenticated different actors",
        )
        self.actor_identity_hash = _hash_text(
            next(iter(self._actors.values()))
        )
        self.machine = socket.gethostname()

    def _client(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> FoundationRuntimeClient:
        if runtime_tuple.platform == "desktop_app":
            return self._runtime_pair.native
        if runtime_tuple.platform == "browser":
            return self._runtime_pair.browser
        raise HomeCommandCenterCandidateError(
            f"Home runtime adapter rejects platform {runtime_tuple.platform}"
        )

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        require(
            runtime_tuple.runtime_attestation_profile == "station_command",
            "Home runtime tuple must use station_command attestation",
        )
        client = self._client(runtime_tuple)
        locale = client.harness(
            "setFoundationLocale",
            {"locale": runtime_tuple.locale},
            timeout=30,
        )
        require(
            isinstance(locale, Mapping)
            and locale.get("locale") == runtime_tuple.locale,
            "Home locale did not converge",
        )
        capture: dict[str, Any] | None = None
        state: dict[str, Any] | None = None
        cleanup: dict[str, Any] = {
            "resourceKind": "home-fixture",
            "resourceIdHash": _hash_text(runtime_tuple.key),
            "status": "failed",
        }
        primary_error: BaseException | None = None
        try:
            value = client.harness(
                "prepareHomeCommandCenterScenario",
                {
                    "cell": runtime_tuple.cell,
                    "locale": runtime_tuple.locale,
                    "ordering": runtime_tuple.ordering,
                    "sampleId": runtime_tuple.sample_id,
                },
                timeout=300,
            )
            capture = _mapping(value, "Home Harness capture")
            state = _mapping(capture.get("state"), "Home scenario state")
            if capture.get("requiresRestart") is True:
                client.restart()
                _authenticate(client, self._profile_env)
                client.harness(
                    "setFoundationLocale",
                    {"locale": runtime_tuple.locale},
                    timeout=30,
                )
                recovery = client.harness(
                    "recoverHomeCommandCenterScenario",
                    state,
                    timeout=120,
                )
                recovery = _mapping(recovery, "Home recovery capture")
                require(
                    recovery.get("recovered") is True,
                    "Home restart recovery did not restore accepted work",
                )
                capture["recovery"] = recovery
                roles = _mapping(
                    capture.get("roles"),
                    "Home recovered role observations",
                )
                receiver = _mapping(
                    roles.get("receiver-dom"),
                    "Home recovered receiver",
                )
                receiver["textHash"] = _string(
                    recovery.get("receiverTextHash"),
                    "Home recovered receiver hash",
                )
                station = _mapping(
                    roles.get("station-readback"),
                    "Home recovered Station readback",
                )
                station["revision"] = _positive_integer(
                    recovery.get("revision"),
                    "Home recovered revision",
                )
                station["stateHash"] = _string(
                    recovery.get("stateHash"),
                    "Home recovered state hash",
                )
                projection = _mapping(
                    roles.get("projection-revisions"),
                    "Home recovered projection revisions",
                )
                projection["afterRevision"] = station["revision"]
                roles["receiver-dom"] = receiver
                roles["station-readback"] = station
                roles["projection-revisions"] = projection
                capture["roles"] = roles
                runtime = _mapping(
                    capture.get("runtime"),
                    "Home recovered runtime capture",
                )
                runtime["projectionRevision"] = station["revision"]
                capture["runtime"] = runtime
        except BaseException as error:
            primary_error = error
        finally:
            if state is not None:
                try:
                    cleanup = _mapping(
                        client.harness(
                            "cleanupHomeCommandCenterScenario",
                            state,
                            timeout=180,
                        ),
                        "Home cleanup",
                    )
                except BaseException as error:
                    if primary_error is None:
                        primary_error = error
        if primary_error is not None:
            raise HomeCommandCenterCandidateError(
                f"{runtime_tuple.key}: Home execution failed: {primary_error}"
            ) from primary_error
        require(capture is not None, "Home Harness returned no capture")
        require(
            cleanup.get("status") == "clean",
            f"Home fixture cleanup failed: {cleanup}",
        )
        return observation_from_home_capture(
            runtime_tuple,
            capture,
            cleanup,
            actor_identity_hash=self.actor_identity_hash,
            machine=self.machine,
        )


class HomeMobileContractAdapter:
    """Bind the labeled Mobile Home protobuf assertion to current source."""

    def __init__(
        self,
        *,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._runner = runner
        self._now = now
        self._result: dict[str, Any] | None = None

    def _run_once(self) -> dict[str, Any]:
        if self._result is not None:
            return self._result
        completed = self._runner(
            MOBILE_TEST_COMMAND,
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
        require(
            completed.returncode == 0,
            "Mobile Home contract suite failed",
        )
        report = _parse_vitest_report(completed.stdout)
        assertions = [
            assertion
            for test_result in report.get("testResults", [])
            if isinstance(test_result, Mapping)
            for assertion in test_result.get("assertionResults", [])
            if isinstance(assertion, Mapping)
            and MOBILE_MARKER in str(assertion.get("fullName") or "")
        ]
        require(
            len(assertions) == 1
            and assertions[0].get("status") == "passed",
            "Mobile Home contract assertion is missing or failed",
        )
        source_hashes = {
            path.as_posix(): hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
            for path in MOBILE_SOURCE_PATHS
        }
        contract_hash = _hash_text(
            json.dumps(source_hashes, sort_keys=True, separators=(",", ":"))
        )
        observed_at = self._now()
        require(
            observed_at.tzinfo is not None,
            "Mobile Home observation time has no timezone",
        )
        self._result = {
            "contractHash": contract_hash,
            "sourceHashes": source_hashes,
            "observedAt": observed_at.isoformat(timespec="microseconds"),
        }
        return self._result

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        require(
            runtime_tuple.row == "home-mobile-contract"
            and runtime_tuple.cell == "AS-15-V2-H01"
            and runtime_tuple.runtime_attestation_profile == "contract_only",
            "Mobile Home tuple identity differs from the reviewed matrix",
        )
        result = self._run_once()
        execution_id = str(uuid.uuid4())
        contract_run_id = f"home-mobile-{execution_id}"
        contract_hash = str(result["contractHash"])
        return AgentV2TupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=AgentV2RuntimeAttestation(
                "contract_only",
                {
                    "scenarioExecutionId": execution_id,
                    "contractAttestation": {
                        "contractId": runtime_tuple.cell,
                        "contractRunId": contract_run_id,
                        "contractHash": contract_hash,
                        "platform": runtime_tuple.platform,
                        "toolchain": "vitest-generated-protobuf",
                        "roundTripStatus": "passed",
                    },
                    "stationProfile": "contract-only",
                    "networkPath": "generated-protobuf-contract",
                    "machine": socket.gethostname(),
                    "coldWarmState": "contract",
                    "observedAt": result["observedAt"],
                },
            ),
            role_observations={
                "contract-evidence": {
                    "contractId": runtime_tuple.cell,
                    "contractHash": contract_hash,
                    "platform": runtime_tuple.platform,
                    "status": "passed",
                    "roundTripEqual": True,
                    "assertionMarker": MOBILE_MARKER,
                    "sourceFiles": [
                        {"path": path, "sha256": digest}
                        for path, digest in result["sourceHashes"].items()
                    ],
                },
                "cleanup": {
                    "resourceKind": "mobile-contract-test-process",
                    "resourceIdHash": _hash_text(" ".join(MOBILE_TEST_COMMAND)),
                    "status": "clean",
                },
            },
        )


class HomeCommandCenterCandidateProducer:
    def __init__(
        self,
        runtime_adapter: HomeRuntimeAdapter,
        mobile_adapter: HomeMobileContractAdapter,
    ) -> None:
        self.assembler = AgentV2CandidateAssembler(AGENT_V2_HOME_GATE)
        self.runtime_adapter = runtime_adapter
        self.mobile_adapter = mobile_adapter

    def collect(
        self,
    ) -> tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ]:
        collected = []
        for runtime_tuple in self.assembler.runtime_tuples:
            observation = (
                self.mobile_adapter.observe(runtime_tuple)
                if runtime_tuple.runtime_attestation_profile == "contract_only"
                else self.runtime_adapter.observe(runtime_tuple)
            )
            collected.append((runtime_tuple, observation))
        require(
            len(collected) == 33
            and len({observation.tuple_key for _, observation in collected})
            == 33,
            "Home candidate observations are incomplete",
        )
        return tuple(collected)


def _candidate_root() -> Path:
    configured = os.environ.get("PT_ACCEPTANCE_ARTIFACT_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / workspace_id(ROOT)
        / "workflow"
        / WORK_ITEM_ID
        / "artifacts"
        / run_id
        / "home-candidate"
    )


def main() -> int:
    activation = subprocess.run(
        ["make", "profile", f"PROFILE={PROFILE}"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    require(activation.returncode == 0, "failed to activate Profile two")
    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "Home candidate requires Profile two")
    require(
        bool(profile_env.get("CHAT_NATIVE_DEMO_PASSWORD")),
        "Profile two has no Home actor credential",
    )
    os.environ.update(profile_env)
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE

    artifact_root = _candidate_root()
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(artifact_root)
    store = EvidenceStore(artifact_root, worktree=ROOT)
    run = store.begin_run(
        AGENT_V2_HOME_GATE,
        source=source_identity(ROOT),
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_HOME_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = run.run_id

    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
    )
    provisioner._resolve_active_profile = lambda: (
        profile_name,
        profile_file,
        slot,
        dict(profile_env),
    )
    runtime_pair: FoundationRuntimePair | None = None
    run_closed = False
    try:
        manifest = provisioner.provision(AGENT_V2_HOME_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            "Home provisioning blocked: "
            f"{manifest.blocked_reason or manifest.state.value}",
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        cleanup_failures: list[str] = []
        try:
            runtime_pair.start()
            producer = HomeCommandCenterCandidateProducer(
                HomeRuntimeAdapter(runtime_pair, profile_env),
                HomeMobileContractAdapter(),
            )
            observations = producer.collect()
        finally:
            if runtime_pair is not None:
                try:
                    client_cleanup = runtime_pair.stop()
                    if client_cleanup.get("status") != "clean":
                        cleanup_failures.append(
                            f"client cleanup failed: {client_cleanup}"
                        )
                except BaseException as error:
                    cleanup_failures.append(
                        f"client cleanup failed: {error}"
                    )
            try:
                provisioner.cleanup()
            except BaseException as error:
                cleanup_failures.append(
                    f"provisioner cleanup failed: {error}"
                )
        require(not cleanup_failures, "; ".join(cleanup_failures))

        assembler = AgentV2CandidateAssembler(AGENT_V2_HOME_GATE)
        candidate_path = assembler.produce(
            run,
            observations,
            candidate_name="home-command-center-candidate",
        )
        acceptance_run = _load_script(
            ROOT / "tooling/scripts/acceptance-run.py",
            "_home_candidate_acceptance_run",
        )
        acceptance_run.emit_agent_v2_candidate_metadata(
            run,
            AGENT_V2_HOME_GATE,
            source_identity(ROOT),
        )
        run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "CANDIDATE",
            }
        )
        candidate_ref = run.manifest_ref
        run.close()
        run_closed = True

        validator = _load_script(
            ROOT / "tooling/scripts/acceptance-validate.py",
            "_home_candidate_validator",
        )
        validator.validate_candidate(
            store,
            candidate_ref,
            candidate_ref.sha256,
        )
        print(
            json.dumps(
                {
                    "candidate": str(candidate_path),
                    "manifest": str(store.resolve(candidate_ref)),
                    "proofStatus": "CANDIDATE",
                    "tupleCount": len(observations),
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    except AgentV2CandidateError as error:
        raise HomeCommandCenterCandidateError(str(error)) from error
    finally:
        if not run_closed:
            run.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except HomeCommandCenterCandidateError as error:
        print(f"Home candidate failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
