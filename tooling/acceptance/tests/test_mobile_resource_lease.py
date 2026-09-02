#!/usr/bin/env python3
"""Deterministic tests for Mobile physical resource lease ownership."""

from __future__ import annotations

import hashlib
import json
import multiprocessing
import os
import pickle
import tempfile
import threading
import time
import unittest
from unittest import mock
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core import (
    REPO_ROOT,
    ArtifactRef,
    EvidenceStore,
    workspace_id,
)
from tooling.acceptance.core.redaction import redact_value
from tooling.acceptance.fixtures import mobile_resource_lease
from tooling.acceptance.fixtures.mobile_resource_lease import (
    BaselineRestoreResult,
    BrowserBaselineVerificationResult,
    CLIENT_PLATFORM,
    CLIENT_PROVIDER,
    LeaseBaselineMismatch,
    LeaseConflict,
    LeaseFenceStale,
    LeaseIdentity,
    LeaseHeartbeatExpired,
    MobileResourceLeaseError,
    MobileResourceLeaseBroker,
    ResourceLeaseLedger,
    ResolvedPhysicalDeviceHandle,
    RunScopedCorrelationSecret,
    contains_sensitive_lease_material,
)
from tooling.acceptance.gates.mobile.proof_contracts import GATE_ID


RUN_ID = "20260829T120000000000Z-0123456789abcdef0123456789abcdef"
NOW = datetime(2999, 8, 29, 12, 0, tzinfo=timezone.utc)
PHYSICAL_IDENTITY_KEY = b"d" * 32
PROVIDER_SUBJECTS = {
    "github": "github-secret-subject",
    "google": "google-secret-subject",
}
PROCESS_TIMEOUT_SECONDS = 30


def verified_browser_baseline(
    _device_lease: LeaseIdentity,
    _account_lease: LeaseIdentity,
) -> BrowserBaselineVerificationResult:
    return BrowserBaselineVerificationResult(
        expected_identity_matched=True,
        authorization_in_progress=False,
        mobile_oauth_state_absent=True,
        station_run_state_absent=True,
    )


class MemoryArtifactWriter:
    gate_id = GATE_ID

    def __init__(self, run_id: str = RUN_ID) -> None:
        self.run_id = run_id
        self.values: dict[str, dict[str, Any]] = {}
        self.encoded_values: dict[str, bytes] = {}
        self.roles: dict[str, str | None] = {}

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        payload = dict(value)
        artifact_role = role or relative_path
        if relative_path in self.values:
            if (
                self.values[relative_path] != payload
                or self.roles[relative_path] != artifact_role
            ):
                raise AssertionError(
                    f"artifact path reused with different bytes: {relative_path}"
                )
        else:
            self.values[relative_path] = payload
            self.roles[relative_path] = artifact_role
        persisted_payload = redact_value(payload) if redact else payload
        encoded = (
            json.dumps(
                persisted_payload,
                indent=2,
                sort_keys=True,
                default=str,
            )
            + "\n"
        ).encode("utf-8")
        self.encoded_values.setdefault(relative_path, encoded)
        digest = hashlib.sha256(encoded).hexdigest()
        return ArtifactRef(
            workspace_id=workspace_id(REPO_ROOT),
            gate_id=self.gate_id,
            run_id=self.run_id,
            path=relative_path,
            sha256=digest,
            media_type="application/json",
        )

    def read_bytes(self, reference: ArtifactRef) -> bytes:
        if (
            reference.workspace_id != workspace_id(REPO_ROOT)
            or reference.gate_id != self.gate_id
            or reference.run_id != self.run_id
        ):
            raise MobileResourceLeaseError(
                "memory artifact reference identity is invalid"
            )
        try:
            return self.encoded_values[reference.path]
        except KeyError as error:
            raise MobileResourceLeaseError(
                f"memory artifact is unavailable: {reference.path}"
            ) from error


class CorruptingArtifactWriter(MemoryArtifactWriter):
    def __init__(
        self,
        *,
        corrupt_field: str,
        corrupt_value: str,
        path_prefix: str = "",
        run_id: str = RUN_ID,
    ) -> None:
        super().__init__(run_id)
        self.corrupt_field = corrupt_field
        self.corrupt_value = corrupt_value
        self.path_prefix = path_prefix

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        reference = super().write_json(
            relative_path,
            value,
            role=role,
            redact=redact,
        )
        if self.path_prefix and not relative_path.startswith(self.path_prefix):
            return reference
        fields = {
            "workspace_id": reference.workspace_id,
            "gate_id": reference.gate_id,
            "run_id": reference.run_id,
            "path": reference.path,
            "sha256": reference.sha256,
            "media_type": reference.media_type,
            "artifact_kind": reference.artifact_kind,
        }
        fields[self.corrupt_field] = self.corrupt_value
        return ArtifactRef(**fields)


class DirectoryArtifactWriter:
    gate_id = GATE_ID

    def __init__(self, root: Path, run_id: str) -> None:
        self.root = root
        self.run_id = run_id

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        del role
        payload = dict(value)
        persisted_payload = redact_value(payload) if redact else payload
        encoded = (
            json.dumps(
                persisted_payload,
                indent=2,
                sort_keys=True,
                default=str,
            )
            + "\n"
        ).encode("utf-8")
        destination = self.root / self.run_id / relative_path
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if destination.exists():
            if destination.read_bytes() != encoded:
                raise AssertionError(
                    f"artifact path reused with different bytes: {relative_path}"
                )
        else:
            descriptor = os.open(
                destination,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
        return ArtifactRef(
            workspace_id=workspace_id(REPO_ROOT),
            gate_id=self.gate_id,
            run_id=self.run_id,
            path=relative_path,
            sha256=hashlib.sha256(encoded).hexdigest(),
            media_type="application/json",
        )

    def read_bytes(self, reference: ArtifactRef) -> bytes:
        if (
            reference.workspace_id != workspace_id(REPO_ROOT)
            or reference.gate_id != self.gate_id
        ):
            raise MobileResourceLeaseError(
                "directory artifact reference identity is invalid"
            )
        return (self.root / reference.run_id / reference.path).read_bytes()


class ImmutableArtifactReader:
    def __init__(self, values: Mapping[str, Mapping[str, Any]]) -> None:
        self.values = {
            path: dict(payload) for path, payload in values.items()
        }

    def read_bytes(self, reference: ArtifactRef) -> bytes:
        try:
            payload = self.values[reference.path]
        except KeyError as error:
            raise MobileResourceLeaseError(
                f"immutable test artifact is unavailable: {reference.path}"
            ) from error
        return (
            json.dumps(
                payload,
                indent=2,
                sort_keys=True,
                default=str,
            )
            + "\n"
        ).encode("utf-8")


class ReadOnlyDirectoryArtifactReader:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.read_count = 0

    def read_bytes(self, reference: ArtifactRef) -> bytes:
        self.read_count += 1
        return (self.root / reference.run_id / reference.path).read_bytes()


def _process_crash_after_acquisition_artifact_write(
    storage_root: str,
    artifact_root: str,
    artifact_written: Any,
) -> None:
    class HardCrashWriter(DirectoryArtifactWriter):
        def write_json(
            self,
            relative_path: str,
            value: Mapping[str, Any],
            *,
            role: str | None = None,
            redact: bool = True,
        ) -> ArtifactRef:
            reference = super().write_json(
                relative_path,
                value,
                role=role,
                redact=redact,
            )
            artifact_written.set()
            os._exit(61)

    broker = MobileResourceLeaseBroker(
        run_handle=HardCrashWriter(Path(artifact_root), RUN_ID),
        correlation_secret=RunScopedCorrelationSecret(b"c" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda reference: DirectoryArtifactWriter(
            Path(artifact_root),
            reference.run_id,
        ),
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=ResourceLeaseLedger(Path(storage_root)),
        now=lambda: NOW,
    )
    broker.acquire_provider_account("github")


def _process_acquire_provider(
    storage_root: str,
    artifact_root: str,
    run_id: str,
    start_event: Any,
    finish_event: Any,
    result_queue: Any,
) -> None:
    broker = MobileResourceLeaseBroker(
        run_handle=DirectoryArtifactWriter(Path(artifact_root), run_id),
        correlation_secret=RunScopedCorrelationSecret(b"p" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda reference: DirectoryArtifactWriter(
            Path(artifact_root),
            reference.run_id,
        ),
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=ResourceLeaseLedger(Path(storage_root)),
        now=lambda: NOW,
    )
    start_event.wait()
    try:
        lease = broker.acquire_provider_account("github")
        result_queue.put(
            {
                "status": "acquired",
                "runId": run_id,
                "fenceToken": lease["fenceToken"],
            }
        )
        finish_event.wait(timeout=PROCESS_TIMEOUT_SECONDS)
    except LeaseConflict:
        result_queue.put({"status": "conflict", "runId": run_id})


def _process_acquire_physical_device(
    storage_root: str,
    artifact_root: str,
    run_id: str,
    client_id: str,
    start_event: Any,
    finish_event: Any,
    result_queue: Any,
) -> None:
    broker = MobileResourceLeaseBroker(
        run_handle=DirectoryArtifactWriter(Path(artifact_root), run_id),
        correlation_secret=RunScopedCorrelationSecret(b"p" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda reference: DirectoryArtifactWriter(
            Path(artifact_root),
            reference.run_id,
        ),
        physical_device_resolver=lambda client_id: ResolvedPhysicalDeviceHandle(
            "shared-raw-physical-identity",
            CLIENT_PLATFORM[client_id],
            True,
            True,
            False,
        ),
        ledger=ResourceLeaseLedger(Path(storage_root)),
        now=lambda: NOW,
    )
    start_event.wait()
    try:
        lease = broker.acquire_physical_device(client_id)
        result_queue.put(
            {
                "status": "acquired",
                "runId": run_id,
                "resourceKey": lease["resourceKey"],
            }
        )
        finish_event.wait(timeout=PROCESS_TIMEOUT_SECONDS)
    except LeaseConflict:
        result_queue.put({"status": "conflict", "runId": run_id})


def _process_authorize_provider(
    storage_root: str,
    lease: Mapping[str, Any],
    acquisition_payloads: Mapping[str, Mapping[str, Any]],
    start_event: Any,
    active: Any,
    maximum: Any,
    counter_lock: Any,
    result_queue: Any,
) -> None:
    artifact_reader = ImmutableArtifactReader(acquisition_payloads)
    broker = MobileResourceLeaseBroker(
        run_handle=MemoryArtifactWriter(str(lease["runId"])),
        correlation_secret=RunScopedCorrelationSecret(b"o" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda _: artifact_reader,
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=ResourceLeaseLedger(Path(storage_root)),
        now=lambda: NOW,
    )

    def operation() -> None:
        with counter_lock:
            active.value += 1
            maximum.value = max(maximum.value, active.value)
        time.sleep(0.05)
        with counter_lock:
            active.value -= 1

    start_event.wait()
    broker.authorize_provider(
        lease,
        client_id="alice-ios",
        operation=operation,
    )
    result_queue.put("completed")


def _process_reentrant_provider_callback(
    storage_root: str,
    lease: Mapping[str, Any],
    acquisition_payloads: Mapping[str, Mapping[str, Any]],
    result_queue: Any,
) -> None:
    artifact_reader = ImmutableArtifactReader(acquisition_payloads)
    outer_ledger = ResourceLeaseLedger(Path(storage_root))
    broker = MobileResourceLeaseBroker(
        run_handle=MemoryArtifactWriter(str(lease["runId"])),
        correlation_secret=RunScopedCorrelationSecret(b"o" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda _: artifact_reader,
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=outer_ledger,
        now=lambda: NOW,
    )

    def operation() -> None:
        nested_ledger = ResourceLeaseLedger(Path(storage_root))
        try:
            nested_broker = MobileResourceLeaseBroker(
                run_handle=MemoryArtifactWriter(str(lease["runId"])),
                correlation_secret=RunScopedCorrelationSecret(b"o" * 32),
                physical_identity_key=PHYSICAL_IDENTITY_KEY,
                artifact_writer_resolver=lambda _: artifact_reader,
                provider_expected_subjects=PROVIDER_SUBJECTS,
                ledger=nested_ledger,
                now=lambda: NOW,
            )
            nested_broker.heartbeat(lease)
            nested_broker.current_acquisition(str(lease["resourceKey"]))
        finally:
            nested_ledger.close()

    try:
        broker.authorize_provider(
            lease,
            client_id="alice-ios",
            operation=operation,
        )
        result_queue.put("completed")
    finally:
        outer_ledger.close()


def _process_crash_during_provider_authorization(
    storage_root: str,
    lease: Mapping[str, Any],
    acquisition_payloads: Mapping[str, Mapping[str, Any]],
    intent_persisted: Any,
) -> None:
    artifact_reader = ImmutableArtifactReader(acquisition_payloads)
    ledger = ResourceLeaseLedger(Path(storage_root))
    broker = MobileResourceLeaseBroker(
        run_handle=MemoryArtifactWriter(str(lease["runId"])),
        correlation_secret=RunScopedCorrelationSecret(b"o" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda _: artifact_reader,
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=ledger,
        now=lambda: NOW,
    )

    def crash() -> None:
        durable = json.loads(ledger.state_path.read_text(encoding="utf-8"))
        record = durable["records"][str(lease["resourceKey"])]
        intent = record["operationIntent"]
        if (
            record["operationOwnerPid"] == os.getpid()
            and intent["ownerPid"] == os.getpid()
            and intent["resourceKey"] == lease["resourceKey"]
            and intent["holderRunId"] == lease["holderRunId"]
            and intent["fenceToken"] == lease["fenceToken"]
            and intent["runId"] == lease["runId"]
        ):
            intent_persisted.set()
            os._exit(23)
        os._exit(24)

    broker.authorize_provider(
        lease,
        client_id="alice-ios",
        operation=crash,
    )


def _process_crash_during_resource_operation(
    storage_root: str,
    lease: Mapping[str, Any],
    acquisition_payloads: Mapping[str, Mapping[str, Any]],
    operation_kind: str,
    physical_identifier: str,
    intent_persisted: Any,
) -> None:
    artifact_reader = ImmutableArtifactReader(acquisition_payloads)
    ledger = ResourceLeaseLedger(Path(storage_root))
    broker = MobileResourceLeaseBroker(
        run_handle=MemoryArtifactWriter(str(lease["runId"])),
        correlation_secret=RunScopedCorrelationSecret(b"o" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda _: artifact_reader,
        physical_device_resolver=lambda client_id: ResolvedPhysicalDeviceHandle(
            physical_identifier,
            CLIENT_PLATFORM[client_id],
            True,
            True,
            False,
        ),
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=ledger,
        now=lambda: NOW,
    )

    def crash() -> None:
        durable = json.loads(ledger.state_path.read_text(encoding="utf-8"))
        intent = durable["records"][str(lease["resourceKey"])][
            "operationIntent"
        ]
        if (
            intent["operationKind"] == operation_kind
            and intent["resourceKey"] == lease["resourceKey"]
            and intent["holderRunId"] == lease["holderRunId"]
            and intent["fenceToken"] == lease["fenceToken"]
            and intent["runId"] == lease["runId"]
        ):
            intent_persisted.set()
            os._exit(31)
        os._exit(32)

    if operation_kind == "physical-device-callback":
        broker.with_physical_device(lease, lambda _: crash())
    else:
        broker.operate_browser_session(lease, crash)


def _process_crash_during_cleanup(
    storage_root: str,
    lease: Mapping[str, Any],
    acquisition_payloads: Mapping[str, Mapping[str, Any]],
    intent_persisted: Any,
) -> None:
    artifact_reader = ImmutableArtifactReader(acquisition_payloads)
    ledger = ResourceLeaseLedger(Path(storage_root))
    broker = MobileResourceLeaseBroker(
        run_handle=MemoryArtifactWriter(str(lease["runId"])),
        correlation_secret=RunScopedCorrelationSecret(b"o" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda _: artifact_reader,
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=ledger,
        now=lambda: NOW,
    )

    def crash() -> BaselineRestoreResult:
        durable = json.loads(ledger.state_path.read_text(encoding="utf-8"))
        intent = durable["records"][str(lease["resourceKey"])][
            "operationIntent"
        ]
        if intent["operationKind"] == "baseline-restore-callback":
            intent_persisted.set()
            os._exit(41)
        os._exit(42)

    broker.release(lease, restore=crash)


def _process_crash_during_recovery(
    storage_root: str,
    resource_key: str,
    acquisition_payloads: Mapping[str, Mapping[str, Any]],
    audit_persisted: Any,
) -> None:
    artifact_reader = ImmutableArtifactReader(acquisition_payloads)
    ledger = ResourceLeaseLedger(Path(storage_root))
    broker = MobileResourceLeaseBroker(
        run_handle=MemoryArtifactWriter(),
        correlation_secret=RunScopedCorrelationSecret(b"o" * 32),
        physical_identity_key=PHYSICAL_IDENTITY_KEY,
        artifact_writer_resolver=lambda _: artifact_reader,
        provider_expected_subjects=PROVIDER_SUBJECTS,
        ledger=ledger,
        now=lambda: NOW,
    )

    def crash(
        _: LeaseIdentity,
        recovery_id: str,
    ) -> BaselineRestoreResult:
        durable = json.loads(ledger.state_path.read_text(encoding="utf-8"))
        audit = durable["recoveryAudit"][-1]
        if (
            audit["state"] == "STARTED"
            and audit["recoveryId"] == recovery_id
            and audit["ownerPid"] == os.getpid()
        ):
            audit_persisted.set()
            os._exit(51)
        os._exit(52)

    broker.recover_quarantined(
        resource_key,
        restore_and_reverify=crash,
    )


class MutableClock:
    def __init__(self) -> None:
        self.value = NOW

    def __call__(self) -> datetime:
        return self.value

    def advance(self, duration: timedelta) -> None:
        self.value += duration


class MobileResourceLeaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.temp_root = Path(self.temporary.name).resolve()
        self.ledger_root = self.temp_root / "lease-ledger"
        self.writer = MemoryArtifactWriter()
        self.clock = MutableClock()
        self.secret = RunScopedCorrelationSecret(b"k" * 32)
        self.device_identifiers = {
            client_id: f"secret-device-{client_id}"
            for client_id in (
                "alice-ios",
                "bob-ios",
                "alice-android",
                "bob-android",
            )
        }
        self.device_facts = {
            client_id: {
                "platform": CLIENT_PLATFORM[client_id],
                "connected": True,
                "physical": True,
                "simulator": False,
            }
            for client_id in self.device_identifiers
        }
        self.ledger = ResourceLeaseLedger(self.ledger_root)
        self.broker = MobileResourceLeaseBroker(
            run_handle=self.writer,
            correlation_secret=self.secret,
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=self._resolve_artifact_writer,
            physical_device_resolver=self._resolve_device,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=self.ledger,
            now=self.clock,
        )

    def tearDown(self) -> None:
        self.ledger.close()
        self.temporary.cleanup()

    def _resolve_device(
        self,
        client_id: str,
    ) -> ResolvedPhysicalDeviceHandle:
        facts = self.device_facts[client_id]
        return ResolvedPhysicalDeviceHandle(
            self.device_identifiers[client_id],
            facts["platform"],
            facts["connected"],
            facts["physical"],
            facts["simulator"],
        )

    def _resolve_artifact_writer(
        self,
        reference: ArtifactRef,
    ) -> MemoryArtifactWriter | None:
        if reference.run_id == self.writer.run_id:
            return self.writer
        return None

    def _broker_for_run(
        self,
        run_id: str,
    ) -> tuple[MemoryArtifactWriter, MobileResourceLeaseBroker]:
        writer = MemoryArtifactWriter(run_id)
        broker = MobileResourceLeaseBroker(
            run_handle=writer,
            correlation_secret=RunScopedCorrelationSecret(b"n" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda reference: (
                writer if reference.run_id == writer.run_id else self.writer
            ),
            physical_device_resolver=self._resolve_device,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=self.ledger,
            now=self.clock,
        )
        return writer, broker

    def _assert_ledger_rejected(
        self,
        message: str,
    ) -> None:
        reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
        try:
            with self.assertRaisesRegex(
                MobileResourceLeaseError,
                message,
            ):
                MobileResourceLeaseBroker(
                    run_handle=self.writer,
                    correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                    physical_identity_key=PHYSICAL_IDENTITY_KEY,
                    artifact_writer_resolver=self._resolve_artifact_writer,
                    physical_device_resolver=self._resolve_device,
                    provider_expected_subjects=PROVIDER_SUBJECTS,
                    ledger=reconstructed_ledger,
                    now=self.clock,
                )
        finally:
            reconstructed_ledger.close()

    def _acquire_client(
        self,
        client_id: str,
        provider: str,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        account_key = f"provider-account/{provider}/disposable"
        acquired_account = False
        try:
            account = self.broker.acquire_provider_account(provider)
            acquired_account = True
        except LeaseConflict:
            account = self.broker.current_acquisition(account_key)
        if acquired_account:
            self.broker.provider_identity_assertion(
                account,
                observed_subject=PROVIDER_SUBJECTS[provider],
            )
        device = self.broker.acquire_physical_device(client_id)
        browser = self.broker.acquire_browser_session(
            client_id,
            physical_device_lease=device,
            provider_account_lease=account,
            verify_baseline=verified_browser_baseline,
        )
        return account, device, browser

    def test_acquires_two_accounts_four_devices_and_four_browser_profiles(
        self,
    ) -> None:
        accounts: dict[str, dict[str, Any]] = {}
        devices = []
        browsers = []
        for client_id, provider in (
            ("alice-ios", "github"),
            ("bob-ios", "google"),
            ("alice-android", "google"),
            ("bob-android", "github"),
        ):
            account, device, browser = self._acquire_client(client_id, provider)
            accounts[provider] = account
            devices.append(device)
            browsers.append(browser)

        self.assertEqual(len(accounts), 2)
        self.assertEqual(len({item["resourceKey"] for item in devices}), 4)
        self.assertEqual(len({item["resourceKey"] for item in browsers}), 4)
        self.assertTrue(
            all(not contains_sensitive_lease_material(item) for item in devices)
        )
        self.assertTrue(
            all(not contains_sensitive_lease_material(item) for item in browsers)
        )
        self.assertEqual(
            {item["destinationClassRef"] for item in devices},
            {"ios-physical", "android-physical"},
        )
        self.assertTrue(
            all(
                item["checks"]
                == {
                    "connected": True,
                    "physical": True,
                    "simulator": False,
                    "platformMatched": True,
                }
                for item in devices
            )
        )

    def test_acquisition_and_outcome_paths_match_frozen_catalog(self) -> None:
        account, device, browser = self._acquire_client(
            "alice-ios",
            "github",
        )
        self.assertEqual(
            {
                path: self.writer.roles[path]
                for path in self.writer.values
            },
            {
                "runtime/mobile/leases/accounts/github.json": (
                    "runtime/mobile/leases/accounts/github.json"
                ),
                "runtime/mobile/identities/providers/github.json": (
                    "runtime/mobile/identities/providers/github.json"
                ),
                "runtime/mobile/leases/devices/alice-ios.json": (
                    "runtime/mobile/leases/devices/alice-ios.json"
                ),
                "runtime/mobile/leases/browsers/alice-ios.json": (
                    "runtime/mobile/leases/browsers/alice-ios.json"
                ),
            },
        )
        self.broker.authorize_provider(
            account,
            client_id="alice-ios",
            operation=lambda: None,
        )
        for lease in (browser, device, account):
            outcome = self.broker.release(
                lease,
                restore=lambda: BaselineRestoreResult(True, True, True),
            )
            outcome_path = (
                "evidence/mobile/cleanup/leases/"
                f"{lease['leaseId']}.json"
            )
            self.assertEqual(
                self.writer.roles[outcome_path],
                outcome_path,
            )
            self.assertEqual(
                outcome["acquisition"]["path"],
                next(
                    path
                    for path, payload in self.writer.values.items()
                    if payload.get("leaseId") == lease["leaseId"]
                    and payload.get("artifactKind") != "mobile-lease-outcome"
                ),
            )

    def test_real_run_handle_publishes_all_lease_cardinalities(self) -> None:
        artifact_root = self.temp_root / "real-evidence"
        store = EvidenceStore(artifact_root, worktree=REPO_ROOT)
        run = store.begin_run(GATE_ID, source={"test": "lease-cardinality"})
        ledger = ResourceLeaseLedger(self.temp_root / "real-run-ledger")
        broker = MobileResourceLeaseBroker(
            run_handle=run,
            correlation_secret=RunScopedCorrelationSecret(b"h" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda reference: (
                run if reference.run_id == run.run_id else None
            ),
            physical_device_resolver=self._resolve_device,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=ledger,
            now=self.clock,
        )
        accounts: dict[str, dict[str, Any]] = {}
        devices: list[dict[str, Any]] = []
        browsers: list[dict[str, Any]] = []
        acquisition_refs: list[ArtifactRef] = []
        restarted_ledger: ResourceLeaseLedger | None = None
        try:
            for provider in ("github", "google"):
                account = broker.acquire_provider_account(provider)
                accounts[provider] = account
                broker.provider_identity_assertion(
                    account,
                    observed_subject=PROVIDER_SUBJECTS[provider],
                )
            for client_id in (
                "alice-ios",
                "bob-ios",
                "alice-android",
                "bob-android",
            ):
                device = broker.acquire_physical_device(client_id)
                browser = broker.acquire_browser_session(
                    client_id,
                    physical_device_lease=device,
                    provider_account_lease=accounts[CLIENT_PROVIDER[client_id]],
                    verify_baseline=verified_browser_baseline,
                )
                devices.append(device)
                browsers.append(browser)
            for record in ledger.records.values():
                if record.acquisition_ref is not None:
                    acquisition_refs.append(record.acquisition_ref)
            restarted_ledger = ResourceLeaseLedger(
                self.temp_root / "real-run-ledger"
            )
            restarted_broker = MobileResourceLeaseBroker(
                run_handle=run,
                correlation_secret=RunScopedCorrelationSecret(b"h" * 32),
                physical_identity_key=PHYSICAL_IDENTITY_KEY,
                artifact_writer_resolver=lambda _: run,
                physical_device_resolver=self._resolve_device,
                provider_expected_subjects=PROVIDER_SUBJECTS,
                ledger=restarted_ledger,
                now=self.clock,
            )
            restarted_broker.authorize_provider(
                accounts["github"],
                client_id="alice-ios",
                operation=lambda: None,
            )
            restarted_broker.authorize_provider(
                accounts["google"],
                client_id="bob-ios",
                operation=lambda: None,
            )
            outcomes = [
                restarted_broker.release(
                    lease,
                    restore=lambda: BaselineRestoreResult(True, True, True),
                )
                for lease in [
                    *reversed(browsers),
                    *reversed(devices),
                    *accounts.values(),
                ]
            ]
            manifest = run.finalize(result={"status": "passed"})
        finally:
            if restarted_ledger is not None:
                restarted_ledger.close()
            ledger.close()
            run.close()

        self.assertEqual(len(acquisition_refs), 10)
        self.assertEqual(len(outcomes), 10)
        self.assertEqual(len(manifest["artifacts"]), 22)
        self.assertEqual(
            set(manifest["artifacts"]),
            {
                reference.path for reference in acquisition_refs
            }
            | {
                "runtime/mobile/identities/providers/github.json",
                "runtime/mobile/identities/providers/google.json",
            }
            | {
                f"evidence/mobile/cleanup/leases/{outcome['leaseId']}.json"
                for outcome in outcomes
            },
        )
        self.assertTrue(
            all(
                role == reference["path"]
                for role, reference in manifest["artifacts"].items()
            )
        )

    def test_acquisition_reference_returns_immutable_real_run_handle_ref(
        self,
    ) -> None:
        artifact_root = self.temp_root / "real-reference-evidence"
        store = EvidenceStore(artifact_root, worktree=REPO_ROOT)
        run = store.begin_run(GATE_ID, source={"test": "acquisition-reference"})
        ledger = ResourceLeaseLedger(self.temp_root / "real-reference-ledger")
        broker = MobileResourceLeaseBroker(
            run_handle=run,
            correlation_secret=RunScopedCorrelationSecret(b"j" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda reference: (
                run if reference.run_id == run.run_id else None
            ),
            physical_device_resolver=self._resolve_device,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=ledger,
            now=self.clock,
        )
        try:
            lease = broker.acquire_physical_device("alice-ios")
            reference = broker.acquisition_reference(lease)
            manifest = run.finalize(result={"status": "passed"})
        finally:
            ledger.close()
            run.close()

        self.assertIsInstance(reference, ArtifactRef)
        self.assertEqual(reference.run_id, run.run_id)
        self.assertEqual(
            reference.path,
            "runtime/mobile/leases/devices/alice-ios.json",
        )
        self.assertEqual(
            manifest["artifacts"][reference.path],
            reference.to_dict(),
        )
        with self.assertRaises(FrozenInstanceError):
            setattr(
                reference,
                "path",
                "runtime/mobile/leases/devices/changed.json",
            )

    def test_acquisition_reference_rejects_foreign_and_stale_leases_without_mutation(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        expected_reference = self.broker.acquisition_reference(lease)

        stale = dict(lease)
        stale["fenceToken"] += 1
        with self.assertRaises(LeaseFenceStale):
            self.broker.acquisition_reference(stale)

        _, foreign_broker = self._broker_for_run(
            "20260829T120011000000Z-99999999999999999999999999999999"
        )
        with self.assertRaisesRegex(LeaseConflict, "another holder run"):
            foreign_broker.acquisition_reference(lease)

        self.assertEqual(
            self.broker.acquisition_reference(lease),
            expected_reference,
        )
        self.assertIsNone(self.broker.terminal_outcome(lease["resourceKey"]))

    def test_acquisition_reference_requires_completed_publication(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        resource_key = lease["resourceKey"]
        expected_reference = self.broker.acquisition_reference(lease)

        with self.ledger.lock:
            self.ledger.records[resource_key].state = "PENDING_PUBLICATION"
        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "publication is incomplete",
        ):
            self.broker.acquisition_reference(lease)

        with self.ledger.lock:
            record = self.ledger.records[resource_key]
            record.state = str(record.acquisition["state"])
            record.acquisition_ref = None
        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "publication is incomplete",
        ):
            self.broker.acquisition_reference(lease)

        with self.ledger.lock:
            record = self.ledger.records[resource_key]
            record.acquisition_ref = expected_reference
            record.state = "PENDING_TERMINAL_PUBLICATION"
        with self.assertRaisesRegex(LeaseConflict, "terminal outcome is pending"):
            self.broker.acquisition_reference(lease)

    def test_acquisition_reference_rejects_expired_quarantined_and_released_leases(
        self,
    ) -> None:
        expired = self.broker.acquire_physical_device("alice-ios")
        quarantined = self.broker.acquire_physical_device("bob-ios")
        released = self.broker.acquire_physical_device("alice-android")

        self.broker.quarantine(
            quarantined,
            "LEASE_IDENTITY_MISMATCH",
        )
        self.broker.release(
            released,
            restore=lambda: BaselineRestoreResult(True, True, True),
        )
        self.clock.advance(timedelta(minutes=11))

        with self.assertRaises(LeaseHeartbeatExpired):
            self.broker.acquisition_reference(expired)
        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            self.broker.acquisition_reference(quarantined)
        with self.assertRaises(LeaseFenceStale):
            self.broker.acquisition_reference(released)

    def test_atomic_acquire_blocks_a_second_holder(self) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.assertEqual(lease["holderRunId"], RUN_ID)
        with self.assertRaises(LeaseConflict):
            self.broker.acquire_provider_account("github")

    def test_acquisition_reservation_is_durable_before_artifact_publication(
        self,
    ) -> None:
        ledger_path = self.ledger.state_path

        class PublishThenFailWriter(MemoryArtifactWriter):
            reservation_state_before_write = ""

            def write_json(
                self,
                relative_path: str,
                value: Mapping[str, Any],
                *,
                role: str | None = None,
                redact: bool = True,
            ) -> ArtifactRef:
                durable = json.loads(ledger_path.read_text(encoding="utf-8"))
                self.reservation_state_before_write = durable["records"][
                    "provider-account/github/disposable"
                ]["state"]
                super().write_json(
                    relative_path,
                    value,
                    role=role,
                    redact=redact,
                )
                raise RuntimeError("synthetic crash after publication")

        crashing_writer = PublishThenFailWriter()
        crashing_broker = MobileResourceLeaseBroker(
            run_handle=crashing_writer,
            correlation_secret=RunScopedCorrelationSecret(b"c" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda _: None,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=self.ledger,
            now=self.clock,
        )
        with self.assertRaisesRegex(RuntimeError, "after publication"):
            crashing_broker.acquire_provider_account("github")
        self.assertEqual(
            crashing_writer.reservation_state_before_write,
            "PENDING_PUBLICATION",
        )

        durable = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        reservation = durable["records"][
            "provider-account/github/disposable"
        ]
        self.assertEqual(reservation["state"], "QUARANTINED")
        self.assertIsNone(reservation["acquisitionRef"])
        self.assertEqual(
            reservation["quarantineReason"],
            "ACQUISITION_ARTIFACT_PUBLICATION_FAILED",
        )
        self.assertIn(
            "runtime/mobile/leases/accounts/github.json",
            crashing_writer.values,
        )

        reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
        try:
            MobileResourceLeaseBroker(
                run_handle=self.writer,
                correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                physical_identity_key=PHYSICAL_IDENTITY_KEY,
                artifact_writer_resolver=self._resolve_artifact_writer,
                provider_expected_subjects=PROVIDER_SUBJECTS,
                ledger=reconstructed_ledger,
                now=self.clock,
            )
            with reconstructed_ledger.lock:
                reconstructed = reconstructed_ledger.records[
                    "provider-account/github/disposable"
                ]
                self.assertEqual(reconstructed.state, "QUARANTINED")
                self.assertIsNone(reconstructed.acquisition_ref)
        finally:
            reconstructed_ledger.close()

    def test_hard_crash_after_acquisition_write_recovers_exact_reference(
        self,
    ) -> None:
        storage_root = self.temp_root / "hard-crash-ledger"
        artifact_root = self.temp_root / "hard-crash-artifacts"
        context = multiprocessing.get_context("spawn")
        artifact_written = context.Event()
        process = context.Process(
            target=_process_crash_after_acquisition_artifact_write,
            args=(
                str(storage_root),
                str(artifact_root),
                artifact_written,
            ),
        )
        process.start()
        self.assertTrue(
            artifact_written.wait(timeout=PROCESS_TIMEOUT_SECONDS)
        )
        process.join(timeout=PROCESS_TIMEOUT_SECONDS)
        self.assertEqual(process.exitcode, 61)

        artifact_path = (
            artifact_root
            / RUN_ID
            / "runtime/mobile/leases/accounts/github.json"
        )
        artifact_before = artifact_path.read_bytes()
        modified_before = artifact_path.stat().st_mtime_ns
        durable_before = json.loads(
            (storage_root / "ledger.json").read_text(encoding="utf-8")
        )
        pending = durable_before["records"][
            "provider-account/github/disposable"
        ]
        self.assertEqual(pending["state"], "PENDING_PUBLICATION")
        self.assertIsNone(pending["acquisitionRef"])

        reader = ReadOnlyDirectoryArtifactReader(artifact_root)
        run_handle = MemoryArtifactWriter()
        reconstructed_ledger = ResourceLeaseLedger(storage_root)
        try:
            MobileResourceLeaseBroker(
                run_handle=run_handle,
                correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                physical_identity_key=PHYSICAL_IDENTITY_KEY,
                artifact_writer_resolver=lambda _: reader,
                provider_expected_subjects=PROVIDER_SUBJECTS,
                ledger=reconstructed_ledger,
                now=self.clock,
            )
        finally:
            reconstructed_ledger.close()

        durable_after = json.loads(
            (storage_root / "ledger.json").read_text(encoding="utf-8")
        )
        recovered = durable_after["records"][
            "provider-account/github/disposable"
        ]
        self.assertEqual(recovered["state"], "LEASED")
        self.assertEqual(
            recovered["acquisitionRef"],
            {
                "artifactKind": "acceptance-artifact-ref",
                "workspaceId": workspace_id(REPO_ROOT),
                "gateId": GATE_ID,
                "runId": RUN_ID,
                "path": "runtime/mobile/leases/accounts/github.json",
                "sha256": hashlib.sha256(artifact_before).hexdigest(),
                "mediaType": "application/json",
            },
        )
        self.assertGreaterEqual(reader.read_count, 1)
        self.assertEqual(run_handle.values, {})
        self.assertEqual(artifact_path.read_bytes(), artifact_before)
        self.assertEqual(artifact_path.stat().st_mtime_ns, modified_before)

    def test_missing_or_mismatched_crash_artifact_quarantines_without_bricking(
        self,
    ) -> None:
        for failure in ("missing", "mismatched"):
            with self.subTest(failure=failure):
                storage_root = self.temp_root / f"{failure}-crash-ledger"
                artifact_root = self.temp_root / f"{failure}-crash-artifacts"
                context = multiprocessing.get_context("spawn")
                artifact_written = context.Event()
                process = context.Process(
                    target=_process_crash_after_acquisition_artifact_write,
                    args=(
                        str(storage_root),
                        str(artifact_root),
                        artifact_written,
                    ),
                )
                process.start()
                self.assertTrue(
                    artifact_written.wait(timeout=PROCESS_TIMEOUT_SECONDS)
                )
                process.join(timeout=PROCESS_TIMEOUT_SECONDS)
                self.assertEqual(process.exitcode, 61)

                artifact_path = (
                    artifact_root
                    / RUN_ID
                    / "runtime/mobile/leases/accounts/github.json"
                )
                if failure == "missing":
                    artifact_path.unlink()
                    expected_reason = (
                        "ACQUISITION_ARTIFACT_RECOVERY_UNAVAILABLE"
                    )
                else:
                    artifact_path.write_bytes(b'{"mismatched":true}\n')
                    expected_reason = "ACQUISITION_ARTIFACT_RECOVERY_MISMATCH"

                reader = ReadOnlyDirectoryArtifactReader(artifact_root)
                reconstructed_ledger = ResourceLeaseLedger(storage_root)
                try:
                    broker = MobileResourceLeaseBroker(
                        run_handle=MemoryArtifactWriter(),
                        correlation_secret=RunScopedCorrelationSecret(
                            b"r" * 32
                        ),
                        physical_identity_key=PHYSICAL_IDENTITY_KEY,
                        artifact_writer_resolver=lambda _: reader,
                        physical_device_resolver=self._resolve_device,
                        provider_expected_subjects=PROVIDER_SUBJECTS,
                        ledger=reconstructed_ledger,
                        now=self.clock,
                    )
                    with reconstructed_ledger.lock:
                        quarantined = reconstructed_ledger.records[
                            "provider-account/github/disposable"
                        ]
                        self.assertEqual(quarantined.state, "QUARANTINED")
                        self.assertEqual(
                            quarantined.quarantine_reason,
                            expected_reason,
                        )
                        self.assertIsNone(quarantined.acquisition_ref)
                    unrelated = broker.acquire_physical_device("alice-ios")
                    self.assertEqual(
                        unrelated["resourceKey"],
                        "physical-device/alice-ios",
                    )
                finally:
                    reconstructed_ledger.close()

    def test_acquisition_rejects_every_invalid_artifact_reference_field(
        self,
    ) -> None:
        corruptions = {
            "workspace_id": "0" * 16,
            "gate_id": "foreign-gate",
            "run_id": (
                "20260829T120099000000Z-"
                "ffffffffffffffffffffffffffffffff"
            ),
            "path": "runtime/mobile/leases/devices/foreign.json",
            "sha256": "0" * 64,
            "media_type": "text/plain",
            "artifact_kind": "foreign-artifact-ref",
        }
        for field, value in corruptions.items():
            with self.subTest(field=field):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    ledger = ResourceLeaseLedger(root / "ledger")
                    writer = CorruptingArtifactWriter(
                        corrupt_field=field,
                        corrupt_value=value,
                    )
                    broker = MobileResourceLeaseBroker(
                        run_handle=writer,
                        correlation_secret=RunScopedCorrelationSecret(
                            b"a" * 32
                        ),
                        physical_identity_key=PHYSICAL_IDENTITY_KEY,
                        artifact_writer_resolver=lambda _: writer,
                        physical_device_resolver=lambda client_id: (
                            ResolvedPhysicalDeviceHandle(
                                "physical-device",
                                CLIENT_PLATFORM[client_id],
                                True,
                                True,
                                False,
                            )
                        ),
                        provider_expected_subjects=PROVIDER_SUBJECTS,
                        ledger=ledger,
                        now=self.clock,
                    )
                    with self.assertRaisesRegex(
                        MobileResourceLeaseError,
                        "invalid reference",
                    ):
                        broker.acquire_physical_device("alice-ios")
                    durable = json.loads(
                        ledger.state_path.read_text(encoding="utf-8")
                    )
                    record = durable["records"]["physical-device/alice-ios"]
                    self.assertEqual(record["state"], "QUARANTINED")
                    self.assertIsNone(record["acquisitionRef"])
                    ledger.close()

    def test_provider_acquisition_requires_broker_owned_expected_identity(
        self,
    ) -> None:
        broker = MobileResourceLeaseBroker(
            run_handle=self.writer,
            correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=self._resolve_artifact_writer,
            ledger=self.ledger,
            now=self.clock,
        )
        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "expected identity is unavailable",
        ):
            broker.acquire_provider_account("github")
        self.assertEqual(self.ledger.records, {})

    def test_reconstruction_rejects_changed_expected_provider_identity(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")
        durable = self.ledger.state_path.read_text(encoding="utf-8")
        self.assertNotIn(PROVIDER_SUBJECTS["github"], durable)
        self.assertRegex(
            json.loads(durable)["records"][lease["resourceKey"]][
                "providerExpectedIdentityHmac"
            ],
            r"^sha256:[0-9a-f]{64}$",
        )
        changed_subjects = dict(PROVIDER_SUBJECTS)
        changed_subjects["github"] = "changed-secret-subject"
        reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
        try:
            with self.assertRaisesRegex(
                LeaseBaselineMismatch,
                "expected identity binding changed",
            ):
                MobileResourceLeaseBroker(
                    run_handle=self.writer,
                    correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                    physical_identity_key=PHYSICAL_IDENTITY_KEY,
                    artifact_writer_resolver=self._resolve_artifact_writer,
                    provider_expected_subjects=changed_subjects,
                    ledger=reconstructed_ledger,
                    now=self.clock,
                )
        finally:
            reconstructed_ledger.close()
        self.assertNotIn(
            "runtime/mobile/identities/providers/github.json",
            self.writer.values,
        )

    def test_restart_rejects_mutated_provider_authority_before_callback(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")
        mutations = {
            "allowed-clients": lambda record: record["acquisition"].__setitem__(
                "allowedClientIds",
                ["bob-ios"],
            ),
            "provider": lambda record: record["acquisition"].__setitem__(
                "provider",
                "google",
            ),
            "resource-key": lambda record: record["acquisition"].__setitem__(
                "resourceKey",
                "provider-account/google/disposable",
            ),
            "kind": lambda record: record.__setitem__(
                "kind",
                "physical-device",
            ),
            "state": lambda record: record.__setitem__(
                "state",
                "QUARANTINED",
            ),
            "provider-hmac": lambda record: record.__setitem__(
                "providerExpectedIdentityHmac",
                "sha256:" + ("0" * 64),
            ),
        }
        original = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        for name, mutate in mutations.items():
            with self.subTest(mutation=name):
                tampered = json.loads(json.dumps(original))
                mutate(tampered["records"][lease["resourceKey"]])
                self.ledger.state_path.write_text(
                    json.dumps(tampered, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                callback_called = False

                def resolve_device(
                    client_id: str,
                ) -> ResolvedPhysicalDeviceHandle:
                    nonlocal callback_called
                    callback_called = True
                    return ResolvedPhysicalDeviceHandle(
                        "must-not-resolve",
                        CLIENT_PLATFORM[client_id],
                        True,
                        True,
                        False,
                    )

                reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
                try:
                    with self.assertRaises(MobileResourceLeaseError):
                        MobileResourceLeaseBroker(
                            run_handle=self.writer,
                            correlation_secret=RunScopedCorrelationSecret(
                                b"r" * 32
                            ),
                            physical_identity_key=PHYSICAL_IDENTITY_KEY,
                            artifact_writer_resolver=(
                                self._resolve_artifact_writer
                            ),
                            physical_device_resolver=resolve_device,
                            provider_expected_subjects=PROVIDER_SUBJECTS,
                            ledger=reconstructed_ledger,
                            now=self.clock,
                        )
                finally:
                    reconstructed_ledger.close()
                self.assertFalse(callback_called)
        self.ledger.state_path.write_text(
            json.dumps(original, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def test_ledger_hmac_rejects_complete_mutable_state_tampering(self) -> None:
        account = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            account,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        device = self.broker.acquire_physical_device("alice-ios")
        self.broker.heartbeat(device)
        self.broker.quarantine(device, "LEASE_BASELINE_RESTORE_FAILED")
        with self.assertRaises(LeaseBaselineMismatch):
            self.broker.recover_quarantined(
                device["resourceKey"],
                restore_and_reverify=lambda _, __: BaselineRestoreResult(
                    True,
                    False,
                    True,
                ),
            )
        original = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        mutations = {
            "record-deletion": lambda payload: payload["records"].pop(
                account["resourceKey"]
            ),
            "fence-deletion": lambda payload: payload["fences"].pop(
                account["resourceKey"]
            ),
            "acquisition-order-deletion": lambda payload: payload[
                "acquisitionOrder"
            ].pop(),
            "forged-provider-verification": lambda payload: payload["records"][
                account["resourceKey"]
            ].__setitem__("providerIdentityVerified", False),
            "forged-provider-assertion": lambda payload: payload["records"][
                account["resourceKey"]
            ]["providerIdentityAssertion"].__setitem__(
                "identityMatched",
                False,
            ),
            "heartbeat-history-deletion": lambda payload: payload["records"][
                device["resourceKey"]
            ].__setitem__("heartbeatHistory", []),
            "recovery-history-deletion": lambda payload: payload[
                "recoveryAudit"
            ].clear(),
        }
        try:
            for name, mutate in mutations.items():
                with self.subTest(mutation=name):
                    tampered = json.loads(json.dumps(original))
                    mutate(tampered)
                    self.ledger.state_path.write_text(
                        json.dumps(tampered, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8",
                    )
                    self._assert_ledger_rejected("authentication failed")
        finally:
            self.ledger.state_path.write_text(
                json.dumps(original, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

    def test_nonempty_unsigned_ledger_fails_closed(self) -> None:
        self.broker.acquire_physical_device("alice-ios")
        unsigned = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        unsigned.pop("authentication")
        self.ledger.state_path.write_text(
            json.dumps(unsigned, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self._assert_ledger_rejected("nonempty resource lease ledger is unsigned")

    def test_fresh_empty_unsigned_ledger_is_initialized_and_authenticated(
        self,
    ) -> None:
        root = self.temp_root / "fresh-empty-ledger"
        root.mkdir(mode=0o700)
        state_path = root / "ledger.json"
        state_path.write_text(
            json.dumps(
                {
                    "schema": "peers-mobile-resource-lease-ledger",
                    "version": 1,
                    "workspaceId": workspace_id(REPO_ROOT),
                    "physicalIdentityKeyId": "",
                    "fences": {},
                    "acquisitionOrder": [],
                    "recoveryAudit": [],
                    "records": {},
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        ledger = ResourceLeaseLedger(root)
        try:
            MobileResourceLeaseBroker(
                run_handle=self.writer,
                correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                physical_identity_key=PHYSICAL_IDENTITY_KEY,
                artifact_writer_resolver=self._resolve_artifact_writer,
                physical_device_resolver=self._resolve_device,
                provider_expected_subjects=PROVIDER_SUBJECTS,
                ledger=ledger,
                now=self.clock,
            )
            initialized = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(initialized["version"], 1)
            self.assertEqual(
                initialized["authentication"]["algorithm"],
                "HMAC-SHA256",
            )
            self.assertTrue((root / "ledger.anchor.json").is_file())
        finally:
            ledger.close()

    def test_replayed_authenticated_ledger_fails_closed(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        previous_generation = self.ledger.state_path.read_bytes()
        self.clock.advance(timedelta(minutes=1))
        self.broker.heartbeat(lease)

        self.ledger.state_path.write_bytes(previous_generation)
        self._assert_ledger_rejected("deleted or replayed")

    def test_synchronized_ledger_and_head_rollback_fails_closed(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        rolled_back_ledger = self.ledger.state_path.read_bytes()
        anchor_head = self.ledger_root / "ledger.anchor.json"
        rolled_back_head = anchor_head.read_bytes()

        self.clock.advance(timedelta(minutes=1))
        self.broker.heartbeat(lease)
        current_ledger = self.ledger.state_path.read_bytes()
        current_head = anchor_head.read_bytes()

        self.ledger.state_path.write_bytes(rolled_back_ledger)
        anchor_head.write_bytes(rolled_back_head)
        try:
            self._assert_ledger_rejected("deleted or replayed")
        finally:
            self.ledger.state_path.write_bytes(current_ledger)
            anchor_head.write_bytes(current_head)

    def test_generation_anchor_deletion_and_gap_fail_closed(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        self.clock.advance(timedelta(minutes=1))
        self.broker.heartbeat(lease)
        generation_directory = self.ledger_root / "ledger.generations"
        generation_names = sorted(
            path.name for path in generation_directory.glob("*.json")
        )
        self.assertGreaterEqual(len(generation_names), 3)

        deleted = generation_directory / generation_names[1]
        deleted_bytes = deleted.read_bytes()
        deleted.unlink()
        try:
            self._assert_ledger_rejected("deletion or gap")
        finally:
            deleted.write_bytes(deleted_bytes)

        latest = generation_directory / generation_names[-1]
        latest_bytes = latest.read_bytes()
        latest.unlink()
        try:
            self._assert_ledger_rejected("deleted or replayed")
        finally:
            latest.write_bytes(latest_bytes)

    def test_generation_anchors_are_append_only_and_never_overwritten(
        self,
    ) -> None:
        generation_directory = self.ledger_root / "ledger.generations"
        first_anchor = generation_directory / "00000000000000000001.json"
        first_bytes = first_anchor.read_bytes()
        first_inode = first_anchor.stat().st_ino

        lease = self.broker.acquire_physical_device("alice-ios")
        self.clock.advance(timedelta(minutes=1))
        self.broker.heartbeat(lease)

        self.assertEqual(first_anchor.read_bytes(), first_bytes)
        self.assertEqual(first_anchor.stat().st_ino, first_inode)
        generations = sorted(generation_directory.glob("*.json"))
        self.assertEqual(
            [path.name for path in generations],
            [
                f"{generation:020d}.json"
                for generation in range(1, len(generations) + 1)
            ],
        )

    def test_interrupted_persist_recovers_from_authenticated_pending_state(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        generation_before = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )["authentication"]["generation"]
        original_append = mobile_resource_lease._write_generation_anchor_at

        with mock.patch.object(
            mobile_resource_lease,
            "_write_generation_anchor_at",
            side_effect=MobileResourceLeaseError(
                "synthetic interruption before generation anchor append"
            ),
        ):
            self.clock.advance(timedelta(minutes=1))
            with self.assertRaisesRegex(
                MobileResourceLeaseError,
                "synthetic interruption",
            ):
                self.broker.heartbeat(lease)

        pending_path = self.ledger_root / "ledger.pending.json"
        self.assertTrue(pending_path.is_file())
        interrupted = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        self.assertEqual(
            interrupted["authentication"]["generation"],
            generation_before + 1,
        )

        with mock.patch.object(
            mobile_resource_lease,
            "_write_generation_anchor_at",
            wraps=original_append,
        ) as append:
            reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
            try:
                MobileResourceLeaseBroker(
                    run_handle=self.writer,
                    correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                    physical_identity_key=PHYSICAL_IDENTITY_KEY,
                    artifact_writer_resolver=self._resolve_artifact_writer,
                    physical_device_resolver=self._resolve_device,
                    provider_expected_subjects=PROVIDER_SUBJECTS,
                    ledger=reconstructed_ledger,
                    now=self.clock,
                )
            finally:
                reconstructed_ledger.close()
        self.assertGreaterEqual(append.call_count, 1)
        self.assertFalse(pending_path.exists())
        recovered = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        recovered_generation = recovered["authentication"]["generation"]
        generation_names = sorted(
            path.name
            for path in (self.ledger_root / "ledger.generations").glob(
                "*.json"
            )
        )
        self.assertEqual(
            generation_names[-1],
            f"{recovered_generation:020d}.json",
        )

    def test_missing_authentication_anchor_fails_closed(self) -> None:
        self.broker.acquire_physical_device("alice-ios")
        (self.ledger_root / "ledger.anchor.json").unlink()
        self._assert_ledger_rejected("authentication anchor is missing")

    def test_restart_rejects_fence_map_advance_and_regression(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        original = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        for name, fence in (
            ("advance", lease["fenceToken"] + 1),
            ("regression", lease["fenceToken"] - 1),
        ):
            with self.subTest(mutation=name):
                tampered = json.loads(json.dumps(original))
                tampered["fences"][lease["resourceKey"]] = fence
                self.ledger.state_path.write_text(
                    json.dumps(tampered, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
                try:
                    with self.assertRaisesRegex(
                        MobileResourceLeaseError,
                        "authentication failed",
                    ):
                        MobileResourceLeaseBroker(
                            run_handle=self.writer,
                            correlation_secret=RunScopedCorrelationSecret(
                                b"r" * 32
                            ),
                            physical_identity_key=PHYSICAL_IDENTITY_KEY,
                            artifact_writer_resolver=(
                                self._resolve_artifact_writer
                            ),
                            physical_device_resolver=self._resolve_device,
                            provider_expected_subjects=PROVIDER_SUBJECTS,
                            ledger=reconstructed_ledger,
                            now=self.clock,
                        )
                finally:
                    reconstructed_ledger.close()
        self.ledger.state_path.write_text(
            json.dumps(original, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def test_restart_rejects_mutable_expiry_extension_and_regression(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        original = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        immutable_expiry = datetime.fromisoformat(
            lease["expiresAt"].replace("Z", "+00:00")
        )
        for name, expires_at in (
            ("extension", immutable_expiry + timedelta(days=1)),
            ("regression", immutable_expiry - timedelta(seconds=1)),
        ):
            with self.subTest(mutation=name):
                tampered = json.loads(json.dumps(original))
                tampered["records"][lease["resourceKey"]]["expiresAt"] = (
                    expires_at.isoformat().replace("+00:00", "Z")
                )
                self.ledger.state_path.write_text(
                    json.dumps(tampered, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
                try:
                    with self.assertRaisesRegex(
                        MobileResourceLeaseError,
                        "authentication failed",
                    ):
                        MobileResourceLeaseBroker(
                            run_handle=self.writer,
                            correlation_secret=RunScopedCorrelationSecret(
                                b"r" * 32
                            ),
                            physical_identity_key=PHYSICAL_IDENTITY_KEY,
                            artifact_writer_resolver=(
                                self._resolve_artifact_writer
                            ),
                            physical_device_resolver=self._resolve_device,
                            provider_expected_subjects=PROVIDER_SUBJECTS,
                            ledger=reconstructed_ledger,
                            now=self.clock,
                        )
                finally:
                    reconstructed_ledger.close()
        self.ledger.state_path.write_text(
            json.dumps(original, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def test_restart_rejects_noncanonical_immutable_lease_timing(self) -> None:
        lease = self.broker.acquire_provider_account("github")
        reference = self.broker.acquisition_reference(lease)
        payload = dict(self.writer.values[reference.path])
        heartbeat_at = datetime.fromisoformat(
            payload["heartbeatAt"].replace("Z", "+00:00")
        )
        payload["renewBefore"] = (
            heartbeat_at + timedelta(minutes=6)
        ).isoformat().replace("+00:00", "Z")
        encoded = (
            json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"
        ).encode("utf-8")
        tampered_reference = ArtifactRef(
            workspace_id=reference.workspace_id,
            gate_id=reference.gate_id,
            run_id=reference.run_id,
            path=reference.path,
            sha256=hashlib.sha256(encoded).hexdigest(),
            media_type=reference.media_type,
        )
        durable = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        record = durable["records"][lease["resourceKey"]]
        record["acquisition"] = payload
        record["acquisitionRef"] = tampered_reference.to_dict()
        self.ledger.state_path.write_text(
            json.dumps(durable, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        reader = ImmutableArtifactReader({reference.path: payload})
        reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
        try:
            with self.assertRaisesRegex(
                MobileResourceLeaseError,
                "authentication failed",
            ):
                MobileResourceLeaseBroker(
                    run_handle=self.writer,
                    correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                    physical_identity_key=PHYSICAL_IDENTITY_KEY,
                    artifact_writer_resolver=lambda _: reader,
                    provider_expected_subjects=PROVIDER_SUBJECTS,
                    ledger=reconstructed_ledger,
                    now=self.clock,
                )
        finally:
            reconstructed_ledger.close()

    def test_restart_rejects_immutable_acquisition_bytes_mismatch(self) -> None:
        lease = self.broker.acquire_provider_account("github")
        reference = self.broker.acquisition_reference(lease)

        class MutatingReader:
            def read_bytes(
                nested_self,
                observed: ArtifactRef,
            ) -> bytes:
                payload = json.loads(self.writer.read_bytes(observed))
                payload["allowedClientIds"] = ["bob-ios"]
                return (
                    json.dumps(payload, indent=2, sort_keys=True) + "\n"
                ).encode("utf-8")

        reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
        try:
            with self.assertRaisesRegex(
                MobileResourceLeaseError,
                "immutable acquisition hash does not match",
            ):
                MobileResourceLeaseBroker(
                    run_handle=self.writer,
                    correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                    physical_identity_key=PHYSICAL_IDENTITY_KEY,
                    artifact_writer_resolver=lambda observed: (
                        MutatingReader()
                        if observed == reference
                        else self.writer
                    ),
                    provider_expected_subjects=PROVIDER_SUBJECTS,
                    ledger=reconstructed_ledger,
                    now=self.clock,
                )
        finally:
            reconstructed_ledger.close()

    def test_restart_rejects_every_mutated_acquisition_reference_field(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        original = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        record = original["records"][lease["resourceKey"]]
        mutations = {
            "artifactKind": "foreign-artifact-ref",
            "workspaceId": "0" * 16,
            "gateId": "foreign-gate",
            "runId": (
                "20260829T120099000000Z-"
                "ffffffffffffffffffffffffffffffff"
            ),
            "path": "runtime/mobile/leases/devices/bob-ios.json",
            "sha256": "0" * 64,
            "mediaType": "text/plain",
        }
        for field, value in mutations.items():
            with self.subTest(field=field):
                tampered = json.loads(json.dumps(original))
                tampered["records"][lease["resourceKey"]][
                    "acquisitionRef"
                ][field] = value
                self.ledger.state_path.write_text(
                    json.dumps(tampered, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                reconstructed_ledger = ResourceLeaseLedger(self.ledger_root)
                try:
                    with self.assertRaises(MobileResourceLeaseError):
                        MobileResourceLeaseBroker(
                            run_handle=self.writer,
                            correlation_secret=RunScopedCorrelationSecret(
                                b"r" * 32
                            ),
                            physical_identity_key=PHYSICAL_IDENTITY_KEY,
                            artifact_writer_resolver=(
                                self._resolve_artifact_writer
                            ),
                            physical_device_resolver=self._resolve_device,
                            provider_expected_subjects=PROVIDER_SUBJECTS,
                            ledger=reconstructed_ledger,
                            now=self.clock,
                        )
                finally:
                    reconstructed_ledger.close()
        self.assertEqual(
            record["acquisitionRef"]["path"],
            "runtime/mobile/leases/devices/alice-ios.json",
        )
        self.ledger.state_path.write_text(
            json.dumps(original, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def test_provider_authorization_requires_broker_verified_identity(self) -> None:
        lease = self.broker.acquire_provider_account("github")
        callback_called = False

        def operation() -> None:
            nonlocal callback_called
            callback_called = True

        with self.assertRaisesRegex(
            LeaseBaselineMismatch,
            "identity is not verified",
        ):
            self.broker.authorize_provider(
                lease,
                client_id="alice-ios",
                operation=operation,
            )
        self.assertFalse(callback_called)
        with self.ledger.lock:
            record = self.ledger.records[lease["resourceKey"]]
            self.assertEqual(record.operation_started, 0)
            self.assertEqual(record.operation_completed, 0)

    def test_provider_authorization_ignores_forged_caller_policy_fields(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        forged = dict(lease)
        forged["provider"] = "google"
        forged["allowedClientIds"] = ["bob-ios"]
        callback_called = False

        def operation() -> None:
            nonlocal callback_called
            callback_called = True

        with self.assertRaisesRegex(
            LeaseBaselineMismatch,
            "not bound to provider 'github'",
        ):
            self.broker.authorize_provider(
                forged,
                client_id="bob-ios",
                operation=operation,
            )
        self.assertFalse(callback_called)
        with self.ledger.lock:
            record = self.ledger.records[lease["resourceKey"]]
            self.assertEqual(record.operation_started, 0)
            self.assertIsNone(record.operation_intent)

    def test_physical_device_identity_cannot_back_two_resource_keys(self) -> None:
        self.device_identifiers["alice-ios"] = "secret-shared-device"
        self.device_identifiers["bob-ios"] = "secret-shared-device"
        self.broker.acquire_physical_device("alice-ios")
        with self.assertRaisesRegex(LeaseConflict, "another client lease"):
            self.broker.acquire_physical_device("bob-ios")

    def test_physical_identity_key_mismatch_rejects_broker_reconstruction(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        self.broker.quarantine(
            lease,
            "LEASE_IDENTITY_MISMATCH",
        )

        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "authentication failed",
        ):
            MobileResourceLeaseBroker(
                run_handle=self.writer,
                correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                physical_identity_key=b"x" * 32,
                artifact_writer_resolver=self._resolve_artifact_writer,
                physical_device_resolver=self._resolve_device,
                provider_expected_subjects=PROVIDER_SUBJECTS,
                ledger=ResourceLeaseLedger(self.ledger_root),
                now=self.clock,
            )
        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        self.assertRegex(
            durable["physicalIdentityKeyId"],
            r"^sha256:[0-9a-f]{64}$",
        )
        self.assertEqual(
            durable["records"][lease["resourceKey"]]["state"],
            "QUARANTINED",
        )

    def test_quarantined_physical_identity_blocks_alias_reuse(self) -> None:
        self.device_identifiers["alice-ios"] = "secret-shared-device"
        self.device_identifiers["bob-ios"] = "secret-shared-device"
        lease = self.broker.acquire_physical_device("alice-ios")
        self.broker.quarantine(
            lease,
            "LEASE_IDENTITY_MISMATCH",
        )

        with self.assertRaisesRegex(LeaseConflict, "another client lease"):
            self.broker.acquire_physical_device("bob-ios")

    def test_shared_broker_ledger_survives_runner_reconstruction(self) -> None:
        lease = self.broker.acquire_physical_device("bob-android")
        reconstructed = MobileResourceLeaseBroker(
            run_handle=self.writer,
            correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=self._resolve_artifact_writer,
            ledger=ResourceLeaseLedger(self.ledger_root),
            now=self.clock,
        )
        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "resolver is unavailable",
        ):
            reconstructed.acquire_physical_device("bob-android")
        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "resolver is unavailable",
        ):
            reconstructed.with_physical_device(
                lease,
                lambda handle: handle.identifier,
            )
        outcome = reconstructed.terminal_outcome(lease["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(
            outcome["failureCode"],
            "LEASE_DEVICE_DISCONNECTED",
        )

        self.clock.advance(timedelta(minutes=11))
        outcomes = reconstructed.quarantine_expired()
        self.assertEqual(outcomes, ())

    def test_multiprocess_duplicate_physical_identity_is_atomic(self) -> None:
        context = multiprocessing.get_context("spawn")
        start_event = context.Event()
        finish_event = context.Event()
        result_queue = context.Queue()
        processes = [
            context.Process(
                target=_process_acquire_physical_device,
                args=(
                    str(self.ledger_root),
                    str(self.temp_root),
                    (
                        "20260829T120003000000Z-"
                        f"{index:032x}"
                    ),
                    client_id,
                    start_event,
                    finish_event,
                    result_queue,
                ),
            )
            for index, client_id in enumerate(
                ("alice-ios", "bob-ios"),
                start=1,
            )
        ]
        for process in processes:
            process.start()
        start_event.set()
        results = [
            result_queue.get(timeout=PROCESS_TIMEOUT_SECONDS)
            for _ in processes
        ]
        finish_event.set()
        for process in processes:
            process.join(timeout=PROCESS_TIMEOUT_SECONDS)
            self.assertEqual(process.exitcode, 0)
        self.assertEqual(
            sorted(result["status"] for result in results),
            ["acquired", "conflict"],
        )

    def test_multi_process_contention_quarantines_crashed_owner_and_preserves_fence(
        self,
    ) -> None:
        context = multiprocessing.get_context("spawn")
        start_event = context.Event()
        finish_event = context.Event()
        result_queue = context.Queue()
        run_ids = (
            "20260829T120001000000Z-11111111111111111111111111111111",
            "20260829T120002000000Z-22222222222222222222222222222222",
        )
        processes = [
            context.Process(
                target=_process_acquire_provider,
                args=(
                    str(self.ledger_root),
                    str(self.temp_root),
                    run_id,
                    start_event,
                    finish_event,
                    result_queue,
                ),
            )
            for run_id in run_ids
        ]
        for process in processes:
            process.start()
        start_event.set()
        results = [
            result_queue.get(timeout=PROCESS_TIMEOUT_SECONDS)
            for _ in processes
        ]
        finish_event.set()
        for process in processes:
            process.join(timeout=PROCESS_TIMEOUT_SECONDS)
            self.assertEqual(process.exitcode, 0)

        self.assertEqual(
            sorted(result["status"] for result in results),
            ["acquired", "conflict"],
        )
        acquired = next(
            result for result in results if result["status"] == "acquired"
        )
        reconstructed = MobileResourceLeaseBroker(
            run_handle=self.writer,
            correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda reference: DirectoryArtifactWriter(
                self.temp_root,
                reference.run_id,
            ),
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=ResourceLeaseLedger(self.ledger_root),
            now=self.clock,
        )
        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            reconstructed.acquire_provider_account("github")
        outcome_path = (
            self.temp_root
            / acquired["runId"]
            / "evidence/mobile/cleanup/leases/account-github.json"
        )
        outcome = json.loads(outcome_path.read_text(encoding="utf-8"))
        self.assertEqual(outcome["runId"], acquired["runId"])
        self.assertEqual(
            outcome["acquisition"]["runId"],
            acquired["runId"],
        )
        self.assertEqual(outcome["finalState"], "QUARANTINED")
        self.assertEqual(
            list(
                (self.temp_root / acquired["runId"]).glob(
                    "evidence/mobile/cleanup/leases/account-github.json"
                )
            ),
            [outcome_path],
        )
        reconstructed.recover_quarantined(
            "provider-account/github/disposable",
            restore_and_reverify=lambda _, __: BaselineRestoreResult(
                True,
                True,
                True,
            ),
        )
        self.assertEqual(
            json.loads(outcome_path.read_text(encoding="utf-8")),
            outcome,
        )
        recovered = reconstructed.acquire_provider_account("github")
        self.assertGreater(recovered["fenceToken"], acquired["fenceToken"])

    def test_broker_requires_original_run_writer_resolver_before_acquisition(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            TypeError,
            "artifact_writer_resolver",
        ):
            MobileResourceLeaseBroker(
                run_handle=self.writer,
                correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                physical_identity_key=PHYSICAL_IDENTITY_KEY,
                ledger=self.ledger,
                now=self.clock,
            )
        self.assertEqual(self.ledger.records, {})

    def test_provider_operations_are_serialized_across_processes(self) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        context = multiprocessing.get_context("spawn")
        start_event = context.Event()
        active = context.Value("i", 0)
        maximum = context.Value("i", 0)
        counter_lock = context.Lock()
        result_queue = context.Queue()
        processes = [
            context.Process(
                target=_process_authorize_provider,
                args=(
                    str(self.ledger_root),
                    lease,
                    self.writer.values,
                    start_event,
                    active,
                    maximum,
                    counter_lock,
                    result_queue,
                ),
            )
            for _ in range(2)
        ]
        for process in processes:
            process.start()
        start_event.set()
        self.assertEqual(
            [
                result_queue.get(timeout=PROCESS_TIMEOUT_SECONDS)
                for _ in processes
            ],
            ["completed", "completed"],
        )
        for process in processes:
            process.join(timeout=PROCESS_TIMEOUT_SECONDS)
            self.assertEqual(process.exitcode, 0)

        outcome = self.broker.release(
            lease,
            restore=lambda: BaselineRestoreResult(True, True, True),
        )
        self.assertEqual(maximum.value, 1)
        self.assertEqual(
            outcome["operationSummary"],
            {
                "started": 2,
                "completed": 2,
                "maxObservedConcurrency": 1,
                "fenceValidated": True,
            },
        )

    def test_provider_callback_can_reenter_same_process_resource_lock(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        context = multiprocessing.get_context("spawn")
        result_queue = context.Queue()
        process = context.Process(
            target=_process_reentrant_provider_callback,
            args=(
                str(self.ledger_root),
                lease,
                self.writer.values,
                result_queue,
            ),
        )
        process.start()
        process.join(timeout=5)
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
            self.fail("provider callback deadlocked on a reentrant resource lock")
        self.assertEqual(process.exitcode, 0)
        self.assertEqual(result_queue.get(timeout=5), "completed")

    def test_crashed_provider_operation_is_durable_and_never_replayed(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        context = multiprocessing.get_context("spawn")
        intent_persisted = context.Event()
        process = context.Process(
            target=_process_crash_during_provider_authorization,
            args=(
                str(self.ledger_root),
                lease,
                self.writer.values,
                intent_persisted,
            ),
        )
        process.start()
        self.assertTrue(intent_persisted.wait(timeout=5))
        process.join(timeout=5)
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
            self.fail("crashing provider callback did not terminate")
        self.assertEqual(process.exitcode, 23)

        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        record = durable["records"][lease["resourceKey"]]
        self.assertEqual(record["operationOwnerPid"], process.pid)
        self.assertEqual(record["operationIntent"]["clientId"], "alice-ios")
        callback_called = False

        def operation() -> None:
            nonlocal callback_called
            callback_called = True

        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            self.broker.authorize_provider(
                lease,
                client_id="alice-ios",
                operation=operation,
            )
        self.assertFalse(callback_called)
        outcome = self.broker.terminal_outcome(lease["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(outcome["failureCode"], "LEASE_OPERATION_INCOMPLETE")

    def test_physical_and_browser_crashes_persist_intents_without_replay(
        self,
    ) -> None:
        _, device, browser = self._acquire_client("alice-ios", "github")
        context = multiprocessing.get_context("spawn")
        for lease, operation_kind, expected_exit in (
            (browser, "browser-session-callback", 31),
            (device, "physical-device-callback", 31),
        ):
            with self.subTest(operation_kind=operation_kind):
                intent_persisted = context.Event()
                process = context.Process(
                    target=_process_crash_during_resource_operation,
                    args=(
                        str(self.ledger_root),
                        lease,
                        self.writer.values,
                        operation_kind,
                        self.device_identifiers["alice-ios"],
                        intent_persisted,
                    ),
                )
                process.start()
                self.assertTrue(intent_persisted.wait(timeout=5))
                process.join(timeout=5)
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=5)
                    self.fail(f"{operation_kind} process did not terminate")
                self.assertEqual(process.exitcode, expected_exit)

                durable = json.loads(
                    self.ledger.state_path.read_text(encoding="utf-8")
                )
                intent = durable["records"][lease["resourceKey"]][
                    "operationIntent"
                ]
                self.assertEqual(intent["operationKind"], operation_kind)
                callback_called = False

                def callback(*_: object) -> None:
                    nonlocal callback_called
                    callback_called = True

                with self.assertRaisesRegex(LeaseConflict, "quarantined"):
                    if operation_kind == "physical-device-callback":
                        self.broker.with_physical_device(lease, callback)
                    else:
                        self.broker.operate_browser_session(lease, callback)
                self.assertFalse(callback_called)
                outcome = self.broker.terminal_outcome(lease["resourceKey"])
                self.assertIsNotNone(outcome)
                self.assertEqual(
                    outcome["failureCode"],
                    "LEASE_OPERATION_INCOMPLETE",
                )

    def test_physical_and_browser_base_exceptions_quarantine(self) -> None:
        _, device, browser = self._acquire_client("alice-ios", "github")

        with self.assertRaisesRegex(RuntimeError, "browser interrupted"):
            self.broker.operate_browser_session(
                browser,
                lambda: (_ for _ in ()).throw(
                    RuntimeError("browser interrupted")
                ),
            )
        browser_outcome = self.broker.terminal_outcome(
            browser["resourceKey"]
        )
        self.assertIsNotNone(browser_outcome)
        self.assertEqual(
            browser_outcome["failureCode"],
            "LEASE_OPERATION_INCOMPLETE",
        )

        with self.assertRaisesRegex(KeyboardInterrupt, "device interrupted"):
            self.broker.with_physical_device(
                device,
                lambda _: (_ for _ in ()).throw(
                    KeyboardInterrupt("device interrupted")
                ),
            )
        device_outcome = self.broker.terminal_outcome(device["resourceKey"])
        self.assertIsNotNone(device_outcome)
        self.assertEqual(
            device_outcome["failureCode"],
            "LEASE_OPERATION_INCOMPLETE",
        )

    def test_provider_callback_failure_quarantines_without_replay(self) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )

        with self.assertRaisesRegex(RuntimeError, "ambiguous provider result"):
            self.broker.authorize_provider(
                lease,
                client_id="alice-ios",
                operation=lambda: (_ for _ in ()).throw(
                    RuntimeError("ambiguous provider result")
                ),
            )
        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            self.broker.authorize_provider(
                lease,
                client_id="alice-ios",
                operation=lambda: None,
            )
        outcome = self.broker.terminal_outcome(lease["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(outcome["failureCode"], "LEASE_OPERATION_INCOMPLETE")

    def test_fence_is_monotonic_and_stale_operation_does_not_mutate_new_lease(
        self,
    ) -> None:
        self.device_identifiers["alice-ios"] = "secret-first"
        first = self.broker.acquire_physical_device("alice-ios")
        outcome = self.broker.release(
            first,
            restore=lambda: BaselineRestoreResult(True, True, True),
        )
        self.assertEqual(outcome["finalState"], "RELEASED")

        self.device_identifiers["alice-ios"] = "secret-second"
        second_writer, second_broker = self._broker_for_run(
            "20260829T120005000000Z-44444444444444444444444444444444"
        )
        second = second_broker.acquire_physical_device("alice-ios")
        self.assertGreater(second["fenceToken"], first["fenceToken"])
        with self.assertRaises(LeaseFenceStale):
            second_broker.with_physical_device(
                first,
                lambda handle: handle.identifier,
            )
        stale_outcome = second_broker.terminal_outcome(second["resourceKey"])
        self.assertIsNone(stale_outcome)
        self.assertNotIn(
            "evidence/mobile/cleanup/leases/device-alice-ios.json",
            second_writer.values,
        )
        self.assertEqual(
            second_broker.with_physical_device(
                second,
                lambda handle: handle.identifier,
            ),
            "secret-second",
        )

    def test_rollback_cannot_reissue_an_old_fence(self) -> None:
        first = self.broker.acquire_physical_device("alice-ios")
        rolled_back_ledger = self.ledger.state_path.read_bytes()
        anchor_head = self.ledger_root / "ledger.anchor.json"
        rolled_back_head = anchor_head.read_bytes()
        self.broker.release(
            first,
            restore=lambda: BaselineRestoreResult(True, True, True),
        )
        second_writer, second_broker = self._broker_for_run(
            "20260829T120006000000Z-55555555555555555555555555555555"
        )
        second = second_broker.acquire_physical_device("alice-ios")
        current_ledger = self.ledger.state_path.read_bytes()
        current_head = anchor_head.read_bytes()
        self.assertGreater(second["fenceToken"], first["fenceToken"])

        self.ledger.state_path.write_bytes(rolled_back_ledger)
        anchor_head.write_bytes(rolled_back_head)
        try:
            self._assert_ledger_rejected("deleted or replayed")
        finally:
            self.ledger.state_path.write_bytes(current_ledger)
            anchor_head.write_bytes(current_head)

        second_broker.release(
            second,
            restore=lambda: BaselineRestoreResult(True, True, True),
        )
        third_writer, third_broker = self._broker_for_run(
            "20260829T120007000000Z-66666666666666666666666666666666"
        )
        third = third_broker.acquire_physical_device("alice-ios")
        self.assertGreater(third["fenceToken"], second["fenceToken"])
        self.assertNotEqual(third["fenceToken"], first["fenceToken"])
        self.assertIn(
            "runtime/mobile/leases/devices/alice-ios.json",
            third_writer.values,
        )
        self.assertIn(
            "evidence/mobile/cleanup/leases/device-alice-ios.json",
            second_writer.values,
        )

    def test_heartbeat_expiry_quarantines_until_explicit_recovery(self) -> None:
        self.device_identifiers["bob-ios"] = "secret-bob"
        lease = self.broker.acquire_physical_device("bob-ios")
        self.clock.advance(timedelta(minutes=11))
        with self.assertRaises(LeaseHeartbeatExpired):
            self.broker.with_physical_device(lease, lambda handle: handle.identifier)
        with self.assertRaises(LeaseConflict):
            self.device_identifiers["bob-ios"] = "replacement"
            self.broker.acquire_physical_device("bob-ios")

        self.broker.recover_quarantined(
            lease["resourceKey"],
            restore_and_reverify=lambda _, __: BaselineRestoreResult(
                True,
                True,
                True,
            ),
        )
        _, recovered_broker = self._broker_for_run(
            "20260829T120006000000Z-55555555555555555555555555555555"
        )
        recovered = recovered_broker.acquire_physical_device("bob-ios")
        self.assertGreater(recovered["fenceToken"], lease["fenceToken"])

    def test_heartbeat_renews_only_current_fence(self) -> None:
        lease = self.broker.acquire_provider_account("google")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["google"],
        )
        self.clock.advance(timedelta(minutes=9))
        self.broker.heartbeat(lease)
        self.clock.advance(timedelta(minutes=2))
        self.assertEqual(
            self.broker.authorize_provider(
                lease,
                client_id="bob-ios",
                operation=lambda: "authorized",
            ),
            "authorized",
        )

    def test_authenticated_heartbeat_chain_survives_restart(self) -> None:
        lease = self.broker.acquire_provider_account("google")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["google"],
        )
        immutable_expiry = lease["expiresAt"]
        self.clock.advance(timedelta(minutes=9))
        self.broker.heartbeat(lease)

        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        record = durable["records"][lease["resourceKey"]]
        self.assertEqual(len(record["heartbeatHistory"]), 1)
        self.assertEqual(
            record["heartbeatHistory"][0]["previousExpiresAt"],
            immutable_expiry,
        )
        self.assertEqual(
            record["expiresAt"],
            record["heartbeatHistory"][0]["expiresAt"],
        )

        restarted_ledger = ResourceLeaseLedger(self.ledger_root)
        try:
            restarted = MobileResourceLeaseBroker(
                run_handle=self.writer,
                correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
                physical_identity_key=PHYSICAL_IDENTITY_KEY,
                artifact_writer_resolver=self._resolve_artifact_writer,
                provider_expected_subjects=PROVIDER_SUBJECTS,
                ledger=restarted_ledger,
                now=self.clock,
            )
            self.clock.advance(timedelta(minutes=2))
            self.assertEqual(
                restarted.authorize_provider(
                    lease,
                    client_id="bob-ios",
                    operation=lambda: "authorized-after-restart",
                ),
                "authorized-after-restart",
            )
        finally:
            restarted_ledger.close()

        tampered = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        tampered["records"][lease["resourceKey"]]["expiresAt"] = (
            self.clock() + timedelta(days=1)
        ).isoformat().replace("+00:00", "Z")
        self.ledger.state_path.write_text(
            json.dumps(tampered, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self._assert_ledger_rejected("authentication failed")

    def test_browser_dependencies_cannot_be_borrowed_by_another_run(
        self,
    ) -> None:
        account = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            account,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        device = self.broker.acquire_physical_device("alice-ios")
        _, other_broker = self._broker_for_run(
            "20260829T120007000000Z-66666666666666666666666666666666"
        )
        verifier_called = False

        def verify(
            _device: LeaseIdentity,
            _account: LeaseIdentity,
        ) -> BrowserBaselineVerificationResult:
            nonlocal verifier_called
            verifier_called = True
            return verified_browser_baseline(_device, _account)

        with self.assertRaisesRegex(LeaseConflict, "another holder run"):
            other_broker.acquire_browser_session(
                "alice-ios",
                physical_device_lease=device,
                provider_account_lease=account,
                verify_baseline=verify,
            )
        self.assertFalse(verifier_called)

    def test_browser_dependencies_validate_fence_expiry_owner_and_kind(
        self,
    ) -> None:
        cases = ("fence", "expiry", "owner", "kind")
        for index, case in enumerate(cases, start=1):
            with self.subTest(case=case):
                run_id = (
                    "20260829T120008000000Z-"
                    f"{index:032x}"
                )
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    writer = MemoryArtifactWriter(run_id)
                    clock = MutableClock()
                    ledger = ResourceLeaseLedger(root / "ledger")
                    broker = MobileResourceLeaseBroker(
                        run_handle=writer,
                        correlation_secret=RunScopedCorrelationSecret(
                            b"v" * 32
                        ),
                        physical_identity_key=PHYSICAL_IDENTITY_KEY,
                        artifact_writer_resolver=lambda _: writer,
                        physical_device_resolver=lambda client_id: (
                            ResolvedPhysicalDeviceHandle(
                                f"browser-dependency-{case}",
                                CLIENT_PLATFORM[client_id],
                                True,
                                True,
                                False,
                            )
                        ),
                        provider_expected_subjects=PROVIDER_SUBJECTS,
                        ledger=ledger,
                        now=clock,
                    )
                    account = broker.acquire_provider_account("github")
                    broker.provider_identity_assertion(
                        account,
                        observed_subject=PROVIDER_SUBJECTS["github"],
                    )
                    device = broker.acquire_physical_device("alice-ios")
                    expected_error: type[Exception]
                    if case == "fence":
                        device = dict(device)
                        device["fenceToken"] += 1
                        expected_error = LeaseFenceStale
                    elif case == "expiry":
                        clock.advance(timedelta(minutes=11))
                        expected_error = LeaseHeartbeatExpired
                    else:
                        with ledger.lock:
                            record = ledger.records[device["resourceKey"]]
                            if case == "owner":
                                record.owner_pid = 999_999_999
                                expected_error = LeaseConflict
                            else:
                                record.kind = "provider-account"
                                expected_error = MobileResourceLeaseError
                    with self.assertRaises(expected_error):
                        broker.acquire_browser_session(
                            "alice-ios",
                            physical_device_lease=device,
                            provider_account_lease=account,
                            verify_baseline=verified_browser_baseline,
                        )
                    ledger.close()

    def test_released_or_quarantined_dependency_blocks_browser_callbacks(
        self,
    ) -> None:
        github_account, github_device, github_browser = self._acquire_client(
            "alice-ios",
            "github",
        )
        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        dependencies = durable["records"][github_browser["resourceKey"]][
            "dependencies"
        ]
        self.assertEqual(
            {
                (
                    dependency["kind"],
                    dependency["resourceKey"],
                    dependency["holderRunId"],
                    dependency["fenceToken"],
                )
                for dependency in dependencies
            },
            {
                (
                    "physical-device",
                    github_device["resourceKey"],
                    RUN_ID,
                    github_device["fenceToken"],
                ),
                (
                    "provider-account",
                    github_account["resourceKey"],
                    RUN_ID,
                    github_account["fenceToken"],
                ),
            },
        )
        self.broker.release(
            github_device,
            restore=lambda: BaselineRestoreResult(True, True, True),
        )
        browser_operation_called = False

        def browser_operation() -> None:
            nonlocal browser_operation_called
            browser_operation_called = True

        with self.assertRaises(LeaseFenceStale):
            self.broker.operate_browser_session(
                github_browser,
                browser_operation,
            )
        self.assertFalse(browser_operation_called)

        google_account, _, google_browser = self._acquire_client(
            "bob-ios",
            "google",
        )
        self.broker.quarantine(
            google_account,
            "LEASE_IDENTITY_MISMATCH",
        )
        restore_called = False

        def restore() -> BaselineRestoreResult:
            nonlocal restore_called
            restore_called = True
            return BaselineRestoreResult(True, True, True)

        with self.assertRaises(LeaseConflict):
            self.broker.release(google_browser, restore=restore)
        self.assertFalse(restore_called)

    def test_browser_baseline_comes_from_fenced_browser_verifier(self) -> None:
        account = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            account,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        device = self.broker.acquire_physical_device("alice-ios")
        observed_fences: list[tuple[LeaseIdentity, LeaseIdentity]] = []

        def reject_browser_baseline(
            device_identity: LeaseIdentity,
            account_identity: LeaseIdentity,
        ) -> BrowserBaselineVerificationResult:
            observed_fences.append((device_identity, account_identity))
            return BrowserBaselineVerificationResult(
                expected_identity_matched=False,
                authorization_in_progress=False,
                mobile_oauth_state_absent=True,
                station_run_state_absent=True,
            )

        with self.assertRaisesRegex(
            LeaseBaselineMismatch,
            "browser baseline",
        ):
            self.broker.acquire_browser_session(
                "alice-ios",
                physical_device_lease=device,
                provider_account_lease=account,
                verify_baseline=reject_browser_baseline,
            )
        self.assertEqual(
            observed_fences,
            [
                (
                    LeaseIdentity.from_payload(device),
                    LeaseIdentity.from_payload(account),
                )
            ],
        )
        self.assertNotIn(
            "runtime/mobile/leases/browsers/alice-ios.json",
            self.writer.values,
        )
        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        browser_record = durable["records"][
            "physical-device/alice-ios/browser/default"
        ]
        self.assertEqual(browser_record["state"], "QUARANTINED")
        self.assertEqual(
            browser_record["quarantineReason"],
            "BROWSER_BASELINE_MISMATCH",
        )
        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            self.broker.acquire_browser_session(
                "alice-ios",
                physical_device_lease=device,
                provider_account_lease=account,
                verify_baseline=verified_browser_baseline,
            )

    def test_browser_callback_crash_quarantines_durable_reservation(self) -> None:
        account = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            account,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        device = self.broker.acquire_physical_device("alice-ios")
        browser_key = "physical-device/alice-ios/browser/default"

        def crash(
            _device: LeaseIdentity,
            _account: LeaseIdentity,
        ) -> BrowserBaselineVerificationResult:
            durable = json.loads(
                self.ledger.state_path.read_text(encoding="utf-8")
            )
            reservation = durable["records"][browser_key]
            self.assertEqual(reservation["state"], "PENDING_BASELINE")
            self.assertIsNone(reservation["acquisitionRef"])
            self.assertEqual(
                {
                    dependency["kind"]
                    for dependency in reservation["dependencies"]
                },
                {"physical-device", "provider-account"},
            )
            raise RuntimeError("synthetic baseline crash")

        with self.assertRaisesRegex(RuntimeError, "baseline crash"):
            self.broker.acquire_browser_session(
                "alice-ios",
                physical_device_lease=device,
                provider_account_lease=account,
                verify_baseline=crash,
            )
        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        self.assertEqual(durable["records"][browser_key]["state"], "QUARANTINED")
        self.assertEqual(
            durable["records"][browser_key]["quarantineReason"],
            "BROWSER_BASELINE_CALLBACK_FAILED",
        )
        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            self.broker.acquire_browser_session(
                "alice-ios",
                physical_device_lease=device,
                provider_account_lease=account,
                verify_baseline=verified_browser_baseline,
            )

    def test_provider_actions_are_serialized_and_release_records_summary(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        active = 0
        max_active = 0
        counter_lock = threading.Lock()

        def operation() -> None:
            nonlocal active, max_active
            with counter_lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.01)
            with counter_lock:
                active -= 1

        threads = [
            threading.Thread(
                target=self.broker.authorize_provider,
                kwargs={
                    "account_lease": lease,
                    "client_id": client_id,
                    "operation": operation,
                },
            )
            for client_id in ("alice-ios", "bob-android")
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        outcome = self.broker.release(
            lease,
            restore=lambda: BaselineRestoreResult(True, True, True),
        )
        self.assertEqual(max_active, 1)
        self.assertEqual(
            outcome["operationSummary"],
            {
                "started": 2,
                "completed": 2,
                "maxObservedConcurrency": 1,
                "fenceValidated": True,
            },
        )

    def test_expiry_waits_for_active_resource_operation(self) -> None:
        lease = self.broker.acquire_provider_account("github")
        self.broker.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        operation_started = threading.Event()
        allow_completion = threading.Event()
        operation_finished = threading.Event()
        terminalization_finished = threading.Event()
        captured_outcomes: list[dict[str, Any]] = []
        operation_errors: list[BaseException] = []

        def operation() -> None:
            operation_started.set()
            allow_completion.wait(timeout=5)
            operation_finished.set()

        def authorize() -> None:
            try:
                self.broker.authorize_provider(
                    lease,
                    client_id="alice-ios",
                    operation=operation,
                )
            except BaseException as error:
                operation_errors.append(error)

        operation_thread = threading.Thread(
            target=authorize,
        )

        def terminalize() -> None:
            captured_outcomes.extend(self.broker.quarantine_expired())
            terminalization_finished.set()

        operation_thread.start()
        self.assertTrue(operation_started.wait(timeout=5))
        self.clock.advance(timedelta(minutes=11))
        terminalization_thread = threading.Thread(target=terminalize)
        terminalization_thread.start()
        time.sleep(0.05)
        self.assertFalse(terminalization_finished.is_set())
        self.assertNotIn(
            "evidence/mobile/cleanup/leases/account-github.json",
            self.writer.values,
        )

        allow_completion.set()
        operation_thread.join(timeout=5)
        terminalization_thread.join(timeout=5)
        self.assertTrue(operation_finished.is_set())
        self.assertTrue(terminalization_finished.is_set())
        self.assertEqual(len(operation_errors), 1)
        self.assertIsInstance(operation_errors[0], LeaseHeartbeatExpired)
        self.assertEqual(captured_outcomes, [])
        outcome = self.broker.terminal_outcome(lease["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(
            outcome["failureCode"],
            "LEASE_HEARTBEAT_EXPIRED",
        )

    def test_secret_side_hmac_correlates_without_persisting_identity(self) -> None:
        account = self.broker.acquire_provider_account("github")
        device = self.broker.acquire_physical_device("alice-ios")
        with self.assertRaisesRegex(
            LeaseBaselineMismatch,
            "identity is not verified",
        ):
            self.broker.acquire_browser_session(
                "alice-ios",
                physical_device_lease=device,
                provider_account_lease=account,
                verify_baseline=verified_browser_baseline,
            )
        first = self.broker.provider_identity_assertion(
            account,
            observed_subject=PROVIDER_SUBJECTS["github"],
        )
        second_secret = RunScopedCorrelationSecret(b"k" * 32)
        second = second_secret.fingerprint(
            "github",
            PROVIDER_SUBJECTS["github"],
        )
        self.assertEqual(first["providerSubjectFingerprint"], second)
        self.assertNotIn(PROVIDER_SUBJECTS["github"], json.dumps(first))
        durable_state = self.ledger.state_path.read_text(encoding="utf-8")
        self.assertNotIn(PROVIDER_SUBJECTS["github"], durable_state)
        durable = json.loads(durable_state)
        provider_record = durable["records"][account["resourceKey"]]
        self.assertTrue(
            provider_record["providerIdentityVerified"]
        )
        self.assertEqual(provider_record["providerIdentityAssertion"], first)
        self.assertIsNone(provider_record["pendingIdentityAssertion"])

        reconstructed = MobileResourceLeaseBroker(
            run_handle=self.writer,
            correlation_secret=RunScopedCorrelationSecret(b"r" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=self._resolve_artifact_writer,
            physical_device_resolver=self._resolve_device,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=ResourceLeaseLedger(self.ledger_root),
            now=self.clock,
        )
        browser = reconstructed.acquire_browser_session(
            "alice-ios",
            physical_device_lease=device,
            provider_account_lease=account,
            verify_baseline=verified_browser_baseline,
        )
        self.assertTrue(browser["checks"]["expectedIdentityMatched"])
        self.assertEqual(
            browser["physicalDeviceLeaseRef"],
            f"physical-device-lease/{device['clientId']}",
        )

        with self.assertRaises(TypeError):
            self.broker.provider_identity_assertion(
                account,
                observed_subject="wrong-subject",
                expected_subject="wrong-subject",  # type: ignore[call-arg]
            )
        with self.assertRaises(LeaseBaselineMismatch):
            self.broker.provider_identity_assertion(
                account,
                observed_subject="wrong-subject",
            )

    def test_provider_identity_revalidates_fence_before_hmac(self) -> None:
        account = self.broker.acquire_provider_account("google")
        stale = dict(account)
        stale["fenceToken"] += 1
        with self.assertRaises(LeaseFenceStale):
            self.broker.provider_identity_assertion(
                stale,
                observed_subject=PROVIDER_SUBJECTS["google"],
            )
        self.assertNotIn(
            "runtime/mobile/identities/providers/google.json",
            self.writer.values,
        )
        outcome_path = "evidence/mobile/cleanup/leases/account-google.json"
        self.assertNotIn(outcome_path, self.writer.values)
        self.assertIsNone(self.broker.terminal_outcome(account["resourceKey"]))

    def test_provider_identity_publication_retries_exact_pending_payload(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")

        class CrashAfterIdentityWrite(MemoryArtifactWriter):
            def __init__(self) -> None:
                super().__init__()
                self.failed = False
                self.attempts: list[dict[str, Any]] = []

            def write_json(
                self,
                relative_path: str,
                value: Mapping[str, Any],
                *,
                role: str | None = None,
                redact: bool = True,
            ) -> ArtifactRef:
                if relative_path.startswith(
                    "runtime/mobile/identities/providers/"
                ):
                    self.attempts.append(dict(value))
                    reference = super().write_json(
                        relative_path,
                        value,
                        role=role,
                        redact=redact,
                    )
                    if not self.failed:
                        self.failed = True
                        raise RuntimeError(
                            "synthetic crash after identity publication"
                        )
                    return reference
                return super().write_json(
                    relative_path,
                    value,
                    role=role,
                    redact=redact,
                )

        writer = CrashAfterIdentityWrite()
        crashing_broker = MobileResourceLeaseBroker(
            run_handle=writer,
            correlation_secret=RunScopedCorrelationSecret(b"k" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda _: self.writer,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=self.ledger,
            now=self.clock,
        )
        with self.assertRaisesRegex(RuntimeError, "identity publication"):
            crashing_broker.provider_identity_assertion(
                lease,
                observed_subject=PROVIDER_SUBJECTS["github"],
                observed_at=NOW,
            )
        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        pending = durable["records"][lease["resourceKey"]][
            "pendingIdentityAssertion"
        ]
        self.assertEqual(pending, writer.attempts[0])
        self.assertFalse(
            durable["records"][lease["resourceKey"]][
                "providerIdentityVerified"
            ]
        )

        self.clock.advance(timedelta(minutes=1))
        reconstructed = MobileResourceLeaseBroker(
            run_handle=writer,
            correlation_secret=RunScopedCorrelationSecret(b"x" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda _: self.writer,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=ResourceLeaseLedger(self.ledger_root),
            now=self.clock,
        )
        published = reconstructed.provider_identity_assertion(
            lease,
            observed_subject=PROVIDER_SUBJECTS["github"],
            observed_at=self.clock(),
        )
        self.assertEqual(writer.attempts, [pending, pending])
        self.assertEqual(published, pending)
        self.assertEqual(
            published["observedAt"],
            NOW.isoformat(timespec="microseconds").replace("+00:00", "Z"),
        )
        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        record = durable["records"][lease["resourceKey"]]
        self.assertEqual(durable["version"], 1)
        self.assertTrue(record["providerIdentityVerified"])
        self.assertEqual(record["providerIdentityAssertion"], pending)
        self.assertIsNone(record["pendingIdentityAssertion"])
        reconstructed.ledger.close()

    def test_provider_identity_rejects_invalid_artifact_reference(
        self,
    ) -> None:
        lease = self.broker.acquire_provider_account("github")
        writer = CorruptingArtifactWriter(
            corrupt_field="sha256",
            corrupt_value="0" * 64,
            path_prefix="runtime/mobile/identities/providers/",
        )
        broker = MobileResourceLeaseBroker(
            run_handle=writer,
            correlation_secret=RunScopedCorrelationSecret(b"k" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda _: self.writer,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=self.ledger,
            now=self.clock,
        )

        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "invalid reference",
        ):
            broker.provider_identity_assertion(
                lease,
                observed_subject=PROVIDER_SUBJECTS["github"],
            )

        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        record = durable["records"][lease["resourceKey"]]
        self.assertFalse(record["providerIdentityVerified"])
        self.assertIsNotNone(record["pendingIdentityAssertion"])

    def test_quarantine_requires_exact_current_lease_tuple(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        for field, value, expected_error in (
            (
                "resourceKey",
                "physical-device/bob-ios",
                LeaseFenceStale,
            ),
            ("holderRunId", "foreign-run", LeaseConflict),
            (
                "fenceToken",
                lease["fenceToken"] + 1,
                LeaseFenceStale,
            ),
            ("runId", "foreign-run", LeaseConflict),
        ):
            with self.subTest(field=field):
                forged = dict(lease)
                forged[field] = value
                with self.assertRaises(expected_error):
                    self.broker.quarantine(
                        forged,
                        "LEASE_IDENTITY_MISMATCH",
                    )
                self.assertIsNone(
                    self.broker.terminal_outcome(lease["resourceKey"])
                )
        _, foreign_broker = self._broker_for_run(
            "20260829T120010000000Z-88888888888888888888888888888888"
        )
        with self.assertRaisesRegex(LeaseConflict, "another holder run"):
            foreign_broker.quarantine(
                lease,
                "LEASE_IDENTITY_MISMATCH",
            )
        self.assertIsNone(self.broker.terminal_outcome(lease["resourceKey"]))
        outcome = self.broker.quarantine(
            lease,
            "LEASE_IDENTITY_MISMATCH",
        )
        self.assertEqual(outcome["failureCode"], "LEASE_IDENTITY_MISMATCH")

    def test_raw_physical_handle_is_process_local_and_non_serializable(self) -> None:
        self.device_identifiers["alice-android"] = "raw-device-serial"
        lease = self.broker.acquire_physical_device("alice-android")
        handle = self.broker.with_physical_device(lease, lambda value: value)
        self.assertIsInstance(handle, ResolvedPhysicalDeviceHandle)
        self.assertNotIn("raw-device-serial", repr(handle))
        with self.assertRaises(TypeError):
            pickle.dumps(handle)
        self.assertNotIn(
            "raw-device-serial",
            json.dumps(self.writer.values, sort_keys=True),
        )
        durable_state = self.ledger.state_path.read_text(encoding="utf-8")
        self.assertNotIn("raw-device-serial", durable_state)
        self.assertNotIn("provider-secret-subject", durable_state)
        self.assertNotIn("deviceHandles", durable_state)

    def test_physical_handle_requires_explicit_broker_facts(self) -> None:
        with self.assertRaises(TypeError):
            ResolvedPhysicalDeviceHandle("identifier-only")  # type: ignore[call-arg]

    def test_physical_acquisition_rejects_unverified_device_facts_without_artifact(
        self,
    ) -> None:
        cases = (
            (
                "emulator-5554",
                {
                    "platform": "android",
                    "connected": True,
                    "physical": False,
                    "simulator": True,
                },
                "simulator or emulator",
            ),
            (
                "disconnected-device",
                {
                    "platform": "ios",
                    "connected": False,
                    "physical": True,
                    "simulator": False,
                },
                "disconnected",
            ),
            (
                "wrong-platform-device",
                {
                    "platform": "android",
                    "connected": True,
                    "physical": True,
                    "simulator": False,
                },
                "does not match",
            ),
        )
        artifact_path = "runtime/mobile/leases/devices/alice-ios.json"

        for identifier, facts, message in cases:
            with self.subTest(identifier=identifier):
                self.device_identifiers["alice-ios"] = identifier
                self.device_facts["alice-ios"] = facts
                with self.assertRaisesRegex(LeaseBaselineMismatch, message):
                    self.broker.acquire_physical_device("alice-ios")
                self.assertNotIn(
                    "physical-device/alice-ios",
                    self.ledger.records,
                )
                self.assertNotIn(artifact_path, self.writer.values)
                self.assertFalse(
                    any(
                        payload.get("artifactKind") == "physical-device-lease"
                        for payload in self.writer.values.values()
                    )
                )

    def test_physical_reresolution_fact_mismatch_quarantines_exact_lease(
        self,
    ) -> None:
        cases = (
            (
                "disconnected",
                {
                    "platform": "ios",
                    "connected": False,
                    "physical": True,
                    "simulator": False,
                },
                "LEASE_DEVICE_DISCONNECTED",
            ),
            (
                "emulator",
                {
                    "platform": "ios",
                    "connected": True,
                    "physical": False,
                    "simulator": True,
                },
                "LEASE_SIMULATOR_DETECTED",
            ),
            (
                "platform-mismatch",
                {
                    "platform": "android",
                    "connected": True,
                    "physical": True,
                    "simulator": False,
                },
                "LEASE_PLATFORM_MISMATCH",
            ),
        )

        for index, (case, facts, failure_code) in enumerate(cases, start=1):
            with self.subTest(case=case):
                run_id = f"20260829T120020000000Z-{index:032x}"
                writer = MemoryArtifactWriter(run_id)
                ledger = ResourceLeaseLedger(
                    self.temp_root / f"reresolution-{case}"
                )
                current_facts = {
                    "platform": "ios",
                    "connected": True,
                    "physical": True,
                    "simulator": False,
                }

                def resolve(_: str) -> ResolvedPhysicalDeviceHandle:
                    return ResolvedPhysicalDeviceHandle(
                        f"secret-reresolution-{case}",
                        current_facts["platform"],
                        current_facts["connected"],
                        current_facts["physical"],
                        current_facts["simulator"],
                    )

                broker = MobileResourceLeaseBroker(
                    run_handle=writer,
                    correlation_secret=RunScopedCorrelationSecret(b"f" * 32),
                    physical_identity_key=PHYSICAL_IDENTITY_KEY,
                    artifact_writer_resolver=lambda _: writer,
                    physical_device_resolver=resolve,
                    provider_expected_subjects=PROVIDER_SUBJECTS,
                    ledger=ledger,
                    now=self.clock,
                )
                try:
                    lease = broker.acquire_physical_device("alice-ios")
                    current_facts.update(facts)
                    callback_called = False

                    def operation(_: ResolvedPhysicalDeviceHandle) -> None:
                        nonlocal callback_called
                        callback_called = True

                    with self.assertRaises(LeaseBaselineMismatch):
                        broker.with_physical_device(lease, operation)
                    self.assertFalse(callback_called)
                    outcome = broker.terminal_outcome(lease["resourceKey"])
                    self.assertIsNotNone(outcome)
                    self.assertEqual(outcome["failureCode"], failure_code)
                    with self.assertRaisesRegex(LeaseConflict, "quarantined"):
                        broker.with_physical_device(lease, operation)
                    self.assertFalse(callback_called)
                finally:
                    ledger.close()

    def test_physical_reresolution_exception_quarantines_without_operation(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        callback_called = False

        def fail_resolution(_: str) -> ResolvedPhysicalDeviceHandle:
            raise RuntimeError("synthetic resolver failure")

        def operation(_: ResolvedPhysicalDeviceHandle) -> None:
            nonlocal callback_called
            callback_called = True

        self.broker._physical_device_resolver = fail_resolution
        with self.assertRaisesRegex(RuntimeError, "synthetic resolver failure"):
            self.broker.with_physical_device(lease, operation)
        self.assertFalse(callback_called)
        outcome = self.broker.terminal_outcome(lease["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(
            outcome["failureCode"],
            "LEASE_DEVICE_DISCONNECTED",
        )
        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            self.broker.with_physical_device(lease, operation)
        self.assertFalse(callback_called)

    def test_physical_handle_is_resolved_fresh_for_each_operation(self) -> None:
        resolution_count = 0

        def resolve(client_id: str) -> ResolvedPhysicalDeviceHandle:
            nonlocal resolution_count
            resolution_count += 1
            return ResolvedPhysicalDeviceHandle(
                self.device_identifiers[client_id],
                CLIENT_PLATFORM[client_id],
                True,
                True,
                False,
            )

        broker = MobileResourceLeaseBroker(
            run_handle=self.writer,
            correlation_secret=self.secret,
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=self._resolve_artifact_writer,
            physical_device_resolver=resolve,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=self.ledger,
            now=self.clock,
        )
        lease = broker.acquire_physical_device("alice-ios")
        broker.with_physical_device(lease, lambda handle: handle.identifier)
        broker.with_physical_device(lease, lambda handle: handle.identifier)
        self.assertEqual(resolution_count, 3)

    def test_cleanup_failure_emits_typed_quarantine_outcome(self) -> None:
        _, _, browser = self._acquire_client("alice-ios", "github")
        outcome = self.broker.release(
            browser,
            restore=lambda: BaselineRestoreResult(True, False, True),
        )
        self.assertEqual(outcome["finalState"], "QUARANTINED")
        self.assertEqual(
            outcome["failureCode"],
            "LEASE_BASELINE_RESTORE_FAILED",
        )
        self.assertFalse(outcome["baselineRestored"])

    def test_terminal_publication_retries_exact_pending_payload(self) -> None:
        for failure_point in ("before-write", "after-write"):
            with self.subTest(failure_point=failure_point):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    ledger = ResourceLeaseLedger(root / "ledger")
                    clock = MutableClock()

                    class CrashOnceTerminalWriter(MemoryArtifactWriter):
                        def __init__(self) -> None:
                            super().__init__()
                            self.failed = False
                            self.pending_states: list[str] = []
                            self.attempts: list[dict[str, Any]] = []

                        def write_json(
                            self,
                            relative_path: str,
                            value: Mapping[str, Any],
                            *,
                            role: str | None = None,
                            redact: bool = True,
                        ) -> ArtifactRef:
                            if relative_path.startswith(
                                "evidence/mobile/cleanup/leases/"
                            ):
                                durable = json.loads(
                                    ledger.state_path.read_text(encoding="utf-8")
                                )
                                record = durable["records"][
                                    "physical-device/alice-ios"
                                ]
                                self.pending_states.append(record["state"])
                                self.attempts.append(dict(value))
                                if not self.failed:
                                    self.failed = True
                                    if failure_point == "before-write":
                                        raise RuntimeError(
                                            "synthetic crash before terminal write"
                                        )
                                    super().write_json(
                                        relative_path,
                                        value,
                                        role=role,
                                        redact=redact,
                                    )
                                    raise RuntimeError(
                                        "synthetic crash after terminal write"
                                    )
                            return super().write_json(
                                relative_path,
                                value,
                                role=role,
                                redact=redact,
                            )

                    writer = CrashOnceTerminalWriter()
                    broker = MobileResourceLeaseBroker(
                        run_handle=writer,
                        correlation_secret=RunScopedCorrelationSecret(b"t" * 32),
                        physical_identity_key=PHYSICAL_IDENTITY_KEY,
                        artifact_writer_resolver=lambda _: writer,
                        physical_device_resolver=lambda client_id: (
                            ResolvedPhysicalDeviceHandle(
                                "terminal-publication-device",
                                CLIENT_PLATFORM[client_id],
                                True,
                                True,
                                False,
                            )
                        ),
                        provider_expected_subjects=PROVIDER_SUBJECTS,
                        ledger=ledger,
                        now=clock,
                    )
                    lease = broker.acquire_physical_device("alice-ios")
                    with self.assertRaisesRegex(
                        RuntimeError,
                        "terminal write",
                    ):
                        broker.release(
                            lease,
                            restore=lambda: BaselineRestoreResult(
                                True,
                                True,
                                True,
                            ),
                        )
                    durable = json.loads(
                        ledger.state_path.read_text(encoding="utf-8")
                    )
                    pending = durable["records"][lease["resourceKey"]]
                    self.assertEqual(
                        pending["state"],
                        "PENDING_TERMINAL_PUBLICATION",
                    )
                    self.assertEqual(
                        pending["pendingOutcome"],
                        writer.attempts[0],
                    )
                    clock.advance(timedelta(minutes=1))
                    stale = dict(lease)
                    stale["fenceToken"] += 1
                    with self.assertRaises(LeaseFenceStale):
                        broker.release(
                            stale,
                            restore=lambda: BaselineRestoreResult(
                                True,
                                True,
                                True,
                            ),
                        )
                    self.assertEqual(len(writer.attempts), 1)
                    restore_called = False

                    def unexpected_restore() -> BaselineRestoreResult:
                        nonlocal restore_called
                        restore_called = True
                        raise AssertionError("restore must not run twice")

                    outcome = broker.release(
                        lease,
                        restore=unexpected_restore,
                    )
                    self.assertFalse(restore_called)
                    self.assertEqual(writer.pending_states, [
                        "PENDING_TERMINAL_PUBLICATION",
                        "PENDING_TERMINAL_PUBLICATION",
                    ])
                    self.assertEqual(writer.attempts, [outcome, outcome])
                    self.assertEqual(
                        outcome["observedAt"],
                        NOW.isoformat(timespec="microseconds").replace(
                            "+00:00",
                            "Z",
                        ),
                    )
                    ledger.close()

    def test_terminal_outcome_rejects_invalid_artifact_reference(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        writer = CorruptingArtifactWriter(
            corrupt_field="path",
            corrupt_value="evidence/mobile/cleanup/leases/foreign.json",
            path_prefix="evidence/mobile/cleanup/leases/",
        )
        broker = MobileResourceLeaseBroker(
            run_handle=writer,
            correlation_secret=RunScopedCorrelationSecret(b"k" * 32),
            physical_identity_key=PHYSICAL_IDENTITY_KEY,
            artifact_writer_resolver=lambda _: self.writer,
            physical_device_resolver=self._resolve_device,
            provider_expected_subjects=PROVIDER_SUBJECTS,
            ledger=self.ledger,
            now=self.clock,
        )

        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "invalid reference",
        ):
            broker.release(
                lease,
                restore=lambda: BaselineRestoreResult(True, True, True),
            )

        durable = json.loads(self.ledger.state_path.read_text(encoding="utf-8"))
        record = durable["records"][lease["resourceKey"]]
        self.assertEqual(record["state"], "PENDING_TERMINAL_PUBLICATION")
        self.assertIsNotNone(record["pendingOutcome"])
        self.assertIsNone(record["outcome"])

    def test_cleanup_base_exception_quarantines_before_reuse(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")

        def interrupted_restore() -> BaselineRestoreResult:
            raise KeyboardInterrupt("synthetic interruption")

        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "baseline restore failed",
        ):
            self.broker.release(lease, restore=interrupted_restore)
        outcome = self.broker.terminal_outcome(lease["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(outcome["failureCode"], "LEASE_CLEANUP_FAILED")

    def test_crashed_cleanup_requires_explicit_fenced_recovery(self) -> None:
        lease = self.broker.acquire_physical_device("alice-ios")
        context = multiprocessing.get_context("spawn")
        intent_persisted = context.Event()
        process = context.Process(
            target=_process_crash_during_cleanup,
            args=(
                str(self.ledger_root),
                lease,
                self.writer.values,
                intent_persisted,
            ),
        )
        process.start()
        self.assertTrue(intent_persisted.wait(timeout=5))
        process.join(timeout=5)
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
            self.fail("cleanup crash process did not terminate")
        self.assertEqual(process.exitcode, 41)

        callback_called = False

        def replayed_restore() -> BaselineRestoreResult:
            nonlocal callback_called
            callback_called = True
            return BaselineRestoreResult(True, True, True)

        with self.assertRaisesRegex(LeaseConflict, "quarantined"):
            self.broker.release(lease, restore=replayed_restore)
        self.assertFalse(callback_called)
        outcome = self.broker.terminal_outcome(lease["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(
            outcome["failureCode"],
            "LEASE_OPERATION_INCOMPLETE",
        )

        recovered: list[LeaseIdentity] = []
        self.broker.recover_quarantined(
            lease["resourceKey"],
            restore_and_reverify=lambda identity, _: (
                recovered.append(identity)
                or BaselineRestoreResult(True, True, True)
            ),
        )
        self.assertEqual(recovered, [LeaseIdentity.from_payload(lease)])

    def test_restore_exception_quarantines_before_reuse(self) -> None:
        account, device, browser = self._acquire_client(
            "bob-ios",
            "google",
        )

        def failed_restore() -> BaselineRestoreResult:
            raise RuntimeError("synthetic restore failure")

        with self.assertRaisesRegex(
            RuntimeError,
            "baseline restore failed",
        ):
            self.broker.release(browser, restore=failed_restore)
        outcome = self.broker.terminal_outcome(browser["resourceKey"])
        self.assertIsNotNone(outcome)
        self.assertEqual(outcome["failureCode"], "LEASE_CLEANUP_FAILED")
        with self.assertRaises(LeaseConflict):
            self.broker.acquire_browser_session(
                "bob-ios",
                physical_device_lease=device,
                provider_account_lease=account,
                verify_baseline=verified_browser_baseline,
            )

    def test_quarantine_recovery_is_fenced_callback_audited_before_reuse(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-android")
        self.broker.quarantine(
            lease,
            "LEASE_BASELINE_RESTORE_FAILED",
        )
        callback_identities: list[LeaseIdentity] = []

        def incomplete(
            identity: LeaseIdentity,
            _: str,
        ) -> BaselineRestoreResult:
            callback_identities.append(identity)
            durable = json.loads(
                self.ledger.state_path.read_text(encoding="utf-8")
            )
            self.assertEqual(
                durable["recoveryAudit"][-1]["state"],
                "STARTED",
            )
            return BaselineRestoreResult(True, False, True)

        with self.assertRaises(LeaseBaselineMismatch):
            self.broker.recover_quarantined(
                lease["resourceKey"],
                restore_and_reverify=incomplete,
            )
        with self.assertRaises(LeaseConflict):
            self.broker.acquire_physical_device("alice-android")

        self.broker.recover_quarantined(
            lease["resourceKey"],
            restore_and_reverify=lambda identity, _: (
                callback_identities.append(identity)
                or BaselineRestoreResult(True, True, True)
            ),
        )
        durable = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        self.assertEqual(
            [entry["state"] for entry in durable["recoveryAudit"]],
            ["FAILED", "COMPLETED"],
        )
        self.assertEqual(
            callback_identities,
            [
                LeaseIdentity.from_payload(lease),
                LeaseIdentity.from_payload(lease),
            ],
        )
        _, recovered_broker = self._broker_for_run(
            "20260829T120009000000Z-77777777777777777777777777777777"
        )
        recovered = recovered_broker.acquire_physical_device("alice-android")
        self.assertGreater(recovered["fenceToken"], lease["fenceToken"])

    def test_started_recovery_resumes_same_operation_after_hard_crash(
        self,
    ) -> None:
        lease = self.broker.acquire_physical_device("alice-android")
        self.broker.quarantine(
            lease,
            "LEASE_BASELINE_RESTORE_FAILED",
        )
        context = multiprocessing.get_context("spawn")
        audit_persisted = context.Event()
        process = context.Process(
            target=_process_crash_during_recovery,
            args=(
                str(self.ledger_root),
                lease["resourceKey"],
                self.writer.values,
                audit_persisted,
            ),
        )
        process.start()
        self.assertTrue(audit_persisted.wait(timeout=5))
        process.join(timeout=5)
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
            self.fail("recovery crash process did not terminate")
        self.assertEqual(process.exitcode, 51)

        crashed = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        crashed_audit = crashed["recoveryAudit"][-1]
        recovery_ids: list[str] = []

        def resumed_recovery(
            identity: LeaseIdentity,
            recovery_id: str,
        ) -> BaselineRestoreResult:
            self.assertEqual(identity, LeaseIdentity.from_payload(lease))
            recovery_ids.append(recovery_id)
            return BaselineRestoreResult(True, True, True)

        self.broker.recover_quarantined(
            lease["resourceKey"],
            restore_and_reverify=resumed_recovery,
        )
        durable = json.loads(
            self.ledger.state_path.read_text(encoding="utf-8")
        )
        self.assertEqual(recovery_ids, [crashed_audit["recoveryId"]])
        self.assertEqual(len(durable["recoveryAudit"]), 1)
        self.assertEqual(durable["recoveryAudit"][-1]["state"], "COMPLETED")
        self.assertEqual(durable["recoveryAudit"][-1]["resumeCount"], 1)
        self.assertEqual(durable["recoveryAudit"][-1]["ownerPid"], 0)
        self.assertEqual(
            durable["recoveryAudit"][-1]["recoveryId"],
            crashed_audit["recoveryId"],
        )
        self.assertNotIn(lease["resourceKey"], durable["records"])

    def test_release_emits_ten_typed_e23_outcomes(self) -> None:
        accounts: dict[str, dict[str, Any]] = {}
        devices = []
        browsers = []
        for client_id, provider in (
            ("alice-ios", "github"),
            ("bob-ios", "google"),
            ("alice-android", "google"),
            ("bob-android", "github"),
        ):
            account, device, browser = self._acquire_client(client_id, provider)
            accounts[provider] = account
            devices.append(device)
            browsers.append(browser)

        for provider, account in accounts.items():
            client_id = "alice-ios" if provider == "github" else "bob-ios"
            self.broker.authorize_provider(
                account,
                client_id=client_id,
                operation=lambda: None,
            )
        outcomes = [
            self.broker.release(
                lease,
                restore=lambda: BaselineRestoreResult(True, True, True),
            )
            for lease in [*reversed(browsers), *reversed(devices), *accounts.values()]
        ]
        self.assertEqual(len(outcomes), 10)
        self.assertEqual(
            [outcome["leaseKind"] for outcome in outcomes].count(
                "physical-device"
            ),
            4,
        )
        self.assertEqual(
            [outcome["leaseKind"] for outcome in outcomes].count(
                "provider-account"
            ),
            2,
        )
        self.assertEqual(
            [outcome["leaseKind"] for outcome in outcomes].count(
                "provider-browser-session"
            ),
            4,
        )
        self.assertTrue(
            all(outcome["finalState"] == "RELEASED" for outcome in outcomes)
        )

    def test_crash_recovery_emits_one_outcome_per_expired_resource(self) -> None:
        self._acquire_client("alice-ios", "github")
        self.clock.advance(timedelta(minutes=11))
        outcomes = self.broker.quarantine_expired()
        self.assertEqual(len(outcomes), 3)
        self.assertEqual(
            {outcome["failureCode"] for outcome in outcomes},
            {"LEASE_HEARTBEAT_EXPIRED"},
        )
        self.assertEqual(self.broker.quarantine_expired(), ())

    def test_correlation_cleanup_closes_and_zeroizes_secret(self) -> None:
        evidence = self.broker.cleanup_correlation_channel()
        self.assertEqual(
            evidence,
            {
                "correlationChannelClosed": True,
                "correlationKeyZeroized": True,
            },
        )
        with self.assertRaisesRegex(
            RuntimeError,
            "correlation channel is closed",
        ):
            self.secret.fingerprint("github", "subject")

    def test_rejects_symlink_in_storage_root_components(self) -> None:
        actual = self.temp_root / "actual-ledger-parent"
        actual.mkdir()
        linked = self.temp_root / "linked-ledger-parent"
        linked.symlink_to(actual, target_is_directory=True)
        with self.assertRaisesRegex(
            MobileResourceLeaseError,
            "symlink component",
        ):
            ResourceLeaseLedger(linked / "ledger")

    def test_state_and_lock_symlinks_fail_closed(self) -> None:
        for filename, operation in (
            ("ledger.json", "state"),
            ("ledger.lock", "lock"),
        ):
            with self.subTest(operation=operation):
                root = (
                    self.temp_root
                    / f"symlink-{operation}-ledger"
                )
                root.mkdir()
                target = root / f"{filename}.target"
                target.write_text("{}\n", encoding="utf-8")
                (root / filename).symlink_to(target)
                with self.assertRaises(MobileResourceLeaseError):
                    ledger = ResourceLeaseLedger(root)
                    with ledger.lock:
                        pass

    def test_operation_lock_directory_symlink_fails_closed(self) -> None:
        root = self.temp_root / "operation-symlink-ledger"
        root.mkdir()
        target = self.temp_root / "operation-lock-target"
        target.mkdir()
        (root / "operations").symlink_to(target, target_is_directory=True)
        with self.assertRaises(MobileResourceLeaseError):
            ResourceLeaseLedger(root)

    def test_generation_anchor_directory_symlink_fails_closed(self) -> None:
        root = self.temp_root / "generation-symlink-ledger"
        root.mkdir()
        (root / "operations").mkdir()
        target = self.temp_root / "generation-anchor-target"
        target.mkdir()
        (root / "ledger.generations").symlink_to(
            target,
            target_is_directory=True,
        )
        with self.assertRaises(MobileResourceLeaseError):
            ResourceLeaseLedger(root)

    def test_ledger_permissions_are_private(self) -> None:
        self.broker.acquire_provider_account("github")
        self.assertEqual(
            self.ledger_root.stat().st_mode & 0o777,
            0o700,
        )
        self.assertEqual(
            self.ledger.state_path.stat().st_mode & 0o777,
            0o600,
        )
        self.assertEqual(
            (self.ledger_root / "ledger.lock").stat().st_mode & 0o777,
            0o600,
        )
        generation_directory = self.ledger_root / "ledger.generations"
        self.assertEqual(
            generation_directory.stat().st_mode & 0o777,
            0o700,
        )
        self.assertTrue(
            all(
                path.stat().st_mode & 0o777 == 0o600
                for path in generation_directory.glob("*.json")
            )
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
