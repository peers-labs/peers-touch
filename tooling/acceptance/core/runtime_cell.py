"""Native Desktop Runtime Cell contracts, manifests, and matrix aggregation.

This module is Acceptance Infra (D-13 ~ D-16). It defines the domain-neutral
Runtime Cell contract, the per-run cell manifest, and the cross-platform matrix
result that fails closed on missing, stale, or substituted platform evidence.

It owns no product journey, selector, or assertion. Business Domains inject
concrete cell contracts under `tooling/acceptance/runtime-cells/` and consume
this module through the runner and validator.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

from .errors import ProvisioningError
from .redaction import redact_value


# Ordered lifecycle a remote cell walks before and after a product Gate runs.
# See docs/architecture/engineering/acceptance/data-model.md §17.
class RuntimeCellState(str, Enum):
    DISCOVERED = "DISCOVERED"
    HOST_VERIFIED = "HOST_VERIFIED"
    SESSION_READY = "SESSION_READY"
    SOURCE_ALIGNED = "SOURCE_ALIGNED"
    BUILD_READY = "BUILD_READY"
    DRIVER_READY = "DRIVER_READY"
    LEASED = "LEASED"
    GATE_RUNNING = "GATE_RUNNING"
    EVIDENCE_JUDGED = "EVIDENCE_JUDGED"
    CLEANING = "CLEANING"
    CLEANED = "CLEANED"
    BLOCKED = "BLOCKED"
    GATE_FAILED = "GATE_FAILED"
    CLEANUP_FAILED = "CLEANUP_FAILED"
    REAPING = "REAPING"


class RuntimeCellLifecycle(Protocol):
    """Acquire and release one Gate-bound Native Desktop runtime cell."""

    def ready(self, gate_id: str) -> "RuntimeCellManifest": ...

    def status(self) -> dict[str, Any]: ...

    def logs(self, tail: int = 200) -> str: ...

    def stop(self) -> dict[str, Any]: ...


_SUPPORTED_TRANSPORTS = ("ssh", "local")
_SUPPORTED_SESSION_TYPES = ("x11", "wayland", "native-macos", "native-windows")
_SUPPORTED_ISOLATION_KINDS = ("host", "container")
_SUPPORTED_SOURCE_MODES = ("git-object-sync", "local-worktree")
_FORBIDDEN_SESSION_TYPES = ("xvfb",)
_SLUG_MAX = 128
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_GEOMETRY_PATTERN = re.compile(r"^[1-9][0-9]*x[1-9][0-9]*$")


def _is_slug(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    if len(value) > _SLUG_MAX:
        return False
    if not (value[0].isalnum()):
        return False
    return all(ch.isalnum() or ch in "._-" for ch in value)


def _looks_like_literal_target(value: str) -> bool:
    """Reject literal SSH targets so contracts never store host/user/paths."""
    lowered = value.strip()
    if not lowered:
        return False
    if lowered.startswith(("profile:", "secret:", "env:")):
        return False
    # user@host, host:port, IPs, or absolute remote paths are all literal.
    if "@" in lowered or lowered.startswith("/"):
        return True
    parts = lowered.split(".")
    if len(parts) == 4 and all(part.isdigit() for part in parts):
        return True
    return False


def parse_required_runtime_cells(
    gate_id: str,
    raw_cells: object,
) -> tuple[str, ...]:
    if raw_cells is None:
        return ()
    if not isinstance(raw_cells, (list, tuple)):
        raise ProvisioningError(
            f"gate {gate_id}: requiredRuntimeCells must be a list"
        )
    cells = tuple(str(cell_id) for cell_id in raw_cells)
    if len(set(cells)) != len(cells):
        raise ProvisioningError(
            f"gate {gate_id}: requiredRuntimeCells contains duplicates"
        )
    if any(not _is_slug(cell_id) for cell_id in cells):
        raise ProvisioningError(
            f"gate {gate_id}: requiredRuntimeCells contains an invalid id"
        )
    return cells


@dataclass(frozen=True)
class TransportContract:
    kind: str
    target_ref: str
    webdriver_forward: str = "local-loopback"


@dataclass(frozen=True)
class DisplayContract:
    session_type: str
    physical_monitor_required: bool = False
    connected_output_required: bool = True
    fixed_geometry: str = ""


@dataclass(frozen=True)
class WebDriverContract:
    kind: str = "tauri-embedded"
    bind: str = "127.0.0.1"


@dataclass(frozen=True)
class NativeAdapterContract:
    input: str
    window: str
    screenshot: str


@dataclass(frozen=True)
class SourceContract:
    mode: str = "git-object-sync"
    clean_commit_required_for_proof: bool = True
    binary_sha256_required: bool = True


@dataclass(frozen=True)
class IsolationContract:
    kind: str
    image_ref: str = ""
    image_digest_required: bool = False


@dataclass(frozen=True)
class RuntimeCellContract:
    """Repository-stored, non-sensitive platform capability declaration."""

    cell_id: str
    platform: str
    architecture: str
    isolation: IsolationContract
    transport: TransportContract
    display: DisplayContract
    webdriver: WebDriverContract
    native_adapter: NativeAdapterContract
    source: SourceContract
    lease_scope: str = "gui-session"
    lease_ttl_seconds: int = 5400
    cleanup_resources: tuple[str, ...] = ()

    @classmethod
    def from_yaml(cls, path: Path) -> "RuntimeCellContract":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ProvisioningError(
                f"invalid runtime cell contract at {path}: {error}"
            ) from error
        return cls.from_dict(data, source=str(path))

    @classmethod
    def from_dict(
        cls,
        data: Any,
        *,
        source: str = "<dict>",
    ) -> "RuntimeCellContract":
        if not isinstance(data, dict):
            raise ProvisioningError(
                f"invalid runtime cell contract at {source}: not an object"
            )

        cell_id = data.get("id")
        if not _is_slug(cell_id):
            raise ProvisioningError(
                f"invalid runtime cell contract at {source}: id must be a slug"
            )

        platform = str(data.get("platform") or "").strip()
        if platform not in ("linux", "macos", "windows"):
            raise ProvisioningError(
                f"runtime cell {cell_id}: platform must be linux/macos/windows"
            )
        architecture = str(data.get("architecture") or "").strip()
        if not architecture:
            raise ProvisioningError(
                f"runtime cell {cell_id}: architecture is required"
            )

        isolation = cls._parse_isolation(data.get("isolation"), cell_id)
        transport = cls._parse_transport(data.get("transport"), cell_id)
        display = cls._parse_display(data.get("display"), cell_id)
        webdriver = cls._parse_webdriver(data.get("webdriver"), cell_id)
        native_adapter = cls._parse_native_adapter(
            data.get("native_adapter"), cell_id
        )
        source_contract = cls._parse_source(data.get("source"), cell_id)

        lease = data.get("lease") or {}
        if not isinstance(lease, dict):
            raise ProvisioningError(f"runtime cell {cell_id}: lease must be an object")
        cleanup = data.get("cleanup") or {}
        if not isinstance(cleanup, dict):
            raise ProvisioningError(
                f"runtime cell {cell_id}: cleanup must be an object"
            )
        cleanup_resources = cleanup.get("resources", ())
        if not isinstance(cleanup_resources, (list, tuple)) or any(
            not isinstance(item, str) or not item for item in cleanup_resources
        ):
            raise ProvisioningError(
                f"runtime cell {cell_id}: cleanup.resources must be strings"
            )
        if not cleanup_resources:
            raise ProvisioningError(
                f"runtime cell {cell_id}: cleanup.resources must not be empty"
            )
        try:
            lease_ttl_seconds = int(lease.get("ttl_seconds", 5400))
        except (TypeError, ValueError) as error:
            raise ProvisioningError(
                f"runtime cell {cell_id}: lease.ttl_seconds must be an integer"
            ) from error
        if lease_ttl_seconds <= 0:
            raise ProvisioningError(
                f"runtime cell {cell_id}: lease.ttl_seconds must be positive"
            )

        expected_session = {
            "linux": ("x11", "wayland"),
            "macos": ("native-macos",),
            "windows": ("native-windows",),
        }[platform]
        if display.session_type not in expected_session:
            raise ProvisioningError(
                f"runtime cell {cell_id}: display session "
                f"{display.session_type!r} is invalid for {platform}"
            )
        if transport.kind == "ssh":
            if transport.webdriver_forward != "local-loopback":
                raise ProvisioningError(
                    f"runtime cell {cell_id}: remote WebDriver forwarding "
                    "must be local-loopback"
                )
            if webdriver.bind not in ("127.0.0.1", "::1", "localhost"):
                raise ProvisioningError(
                    f"runtime cell {cell_id}: remote WebDriver must bind loopback"
                )
            if source_contract.mode != "git-object-sync":
                raise ProvisioningError(
                    f"runtime cell {cell_id}: ssh transport requires "
                    "source.mode git-object-sync"
                )

        return cls(
            cell_id=str(cell_id),
            platform=platform,
            architecture=architecture,
            isolation=isolation,
            transport=transport,
            display=display,
            webdriver=webdriver,
            native_adapter=native_adapter,
            source=source_contract,
            lease_scope=str(lease.get("scope") or "gui-session"),
            lease_ttl_seconds=lease_ttl_seconds,
            cleanup_resources=tuple(str(item) for item in cleanup_resources),
        )

    @staticmethod
    def _parse_isolation(raw: Any, cell_id: str) -> IsolationContract:
        if not isinstance(raw, dict):
            raise ProvisioningError(
                f"runtime cell {cell_id}: isolation is required"
            )
        kind = str(raw.get("kind") or "").strip()
        if kind not in _SUPPORTED_ISOLATION_KINDS:
            raise ProvisioningError(
                f"runtime cell {cell_id}: isolation.kind must be one of "
                f"{_SUPPORTED_ISOLATION_KINDS}"
            )
        image_ref = str(raw.get("image_ref") or "").strip()
        image_digest_required = bool(raw.get("image_digest_required", False))
        if kind == "container" and (not image_ref or not image_digest_required):
            raise ProvisioningError(
                f"runtime cell {cell_id}: container isolation requires "
                "image_ref and image_digest_required"
            )
        return IsolationContract(
            kind=kind,
            image_ref=image_ref,
            image_digest_required=image_digest_required,
        )

    @staticmethod
    def _parse_transport(raw: Any, cell_id: str) -> TransportContract:
        if not isinstance(raw, dict):
            raise ProvisioningError(f"runtime cell {cell_id}: transport is required")
        kind = str(raw.get("kind") or "").strip()
        if kind not in _SUPPORTED_TRANSPORTS:
            raise ProvisioningError(
                f"runtime cell {cell_id}: transport.kind must be one of "
                f"{_SUPPORTED_TRANSPORTS}"
            )
        target_ref = str(raw.get("target_ref") or "").strip()
        if kind == "ssh":
            if not target_ref:
                raise ProvisioningError(
                    f"runtime cell {cell_id}: ssh transport requires target_ref"
                )
            if _looks_like_literal_target(target_ref):
                raise ProvisioningError(
                    f"runtime cell {cell_id}: target_ref must be a "
                    "profile/secret reference, not a literal host or path"
                )
        return TransportContract(
            kind=kind,
            target_ref=target_ref,
            webdriver_forward=str(
                raw.get("webdriver_forward") or "local-loopback"
            ),
        )

    @staticmethod
    def _parse_display(raw: Any, cell_id: str) -> DisplayContract:
        if not isinstance(raw, dict):
            raise ProvisioningError(f"runtime cell {cell_id}: display is required")
        session_type = str(raw.get("session_type") or "").strip()
        if session_type in _FORBIDDEN_SESSION_TYPES:
            raise ProvisioningError(
                f"runtime cell {cell_id}: session_type {session_type!r} cannot "
                "produce final Native proof"
            )
        if session_type not in _SUPPORTED_SESSION_TYPES:
            raise ProvisioningError(
                f"runtime cell {cell_id}: session_type must be one of "
                f"{_SUPPORTED_SESSION_TYPES}"
            )
        fixed_geometry = str(raw.get("fixed_geometry") or "")
        if fixed_geometry and not _GEOMETRY_PATTERN.fullmatch(fixed_geometry):
            raise ProvisioningError(
                f"runtime cell {cell_id}: display.fixed_geometry must be WIDTHxHEIGHT"
            )
        return DisplayContract(
            session_type=session_type,
            physical_monitor_required=bool(
                raw.get("physical_monitor_required", False)
            ),
            connected_output_required=bool(
                raw.get("connected_output_required", True)
            ),
            fixed_geometry=fixed_geometry,
        )

    @staticmethod
    def _parse_webdriver(raw: Any, cell_id: str) -> WebDriverContract:
        if raw is None:
            return WebDriverContract()
        if not isinstance(raw, dict):
            raise ProvisioningError(f"runtime cell {cell_id}: webdriver must be object")
        bind = str(raw.get("bind") or "127.0.0.1").strip()
        return WebDriverContract(
            kind=str(raw.get("kind") or "tauri-embedded"),
            bind=bind,
        )

    @staticmethod
    def _parse_native_adapter(raw: Any, cell_id: str) -> NativeAdapterContract:
        if not isinstance(raw, dict):
            raise ProvisioningError(
                f"runtime cell {cell_id}: native_adapter is required"
            )
        for field_name in ("input", "window", "screenshot"):
            if not str(raw.get(field_name) or "").strip():
                raise ProvisioningError(
                    f"runtime cell {cell_id}: native_adapter.{field_name} required"
                )
        return NativeAdapterContract(
            input=str(raw["input"]),
            window=str(raw["window"]),
            screenshot=str(raw["screenshot"]),
        )

    @staticmethod
    def _parse_source(raw: Any, cell_id: str) -> SourceContract:
        if raw is None:
            return SourceContract()
        if not isinstance(raw, dict):
            raise ProvisioningError(f"runtime cell {cell_id}: source must be object")
        mode = str(raw.get("mode") or "git-object-sync")
        if mode not in _SUPPORTED_SOURCE_MODES:
            raise ProvisioningError(
                f"runtime cell {cell_id}: source.mode must be one of "
                f"{_SUPPORTED_SOURCE_MODES}"
            )
        return SourceContract(
            mode=mode,
            clean_commit_required_for_proof=bool(
                raw.get("clean_commit_required_for_proof", True)
            ),
            binary_sha256_required=bool(raw.get("binary_sha256_required", True)),
        )

    def requires_remote_loopback(self) -> bool:
        return self.transport.kind == "ssh"

    def to_dict(self) -> dict[str, Any]:
        return redact_value(
            {
                "artifactKind": "acceptance-runtime-cell-contract",
                "id": self.cell_id,
                "platform": self.platform,
                "architecture": self.architecture,
                "isolation": {
                    "kind": self.isolation.kind,
                    "imageRef": self.isolation.image_ref,
                    "imageDigestRequired": self.isolation.image_digest_required,
                },
                "transport": {
                    "kind": self.transport.kind,
                    "targetRef": self.transport.target_ref,
                    "webdriverForward": self.transport.webdriver_forward,
                },
                "display": {
                    "sessionType": self.display.session_type,
                    "physicalMonitorRequired": (
                        self.display.physical_monitor_required
                    ),
                    "connectedOutputRequired": (
                        self.display.connected_output_required
                    ),
                    "fixedGeometry": self.display.fixed_geometry,
                },
                "webdriver": {
                    "kind": self.webdriver.kind,
                    "bind": self.webdriver.bind,
                },
                "nativeAdapter": {
                    "input": self.native_adapter.input,
                    "window": self.native_adapter.window,
                    "screenshot": self.native_adapter.screenshot,
                },
                "source": {
                    "mode": self.source.mode,
                    "cleanCommitRequiredForProof": (
                        self.source.clean_commit_required_for_proof
                    ),
                    "binarySha256Required": self.source.binary_sha256_required,
                },
                "lease": {
                    "scope": self.lease_scope,
                    "ttlSeconds": self.lease_ttl_seconds,
                },
                "cleanup": {"resources": list(self.cleanup_resources)},
            }
        )


@dataclass(frozen=True)
class CellPlatformIdentity:
    os: str
    host_distribution: str
    host_kernel: str
    isolation_kind: str
    image_digest: str
    distribution: str
    architecture: str
    webview_backend: str
    webview_version: str


@dataclass(frozen=True)
class CellTransportIdentity:
    kind: str
    host_identity_sha256: str
    host_key_sha256: str
    webdriver_local_port: int
    webdriver_remote_port: int


@dataclass(frozen=True)
class CellDisplayIdentity:
    session_type: str
    display_id: str
    seat: str
    width: int
    height: int
    connected_output: bool
    desktop_user_identity_sha256: str


@dataclass(frozen=True)
class CellSourceIdentity:
    mode: str
    commit: str
    workspace_digest: str
    remote_source_digest: str
    remote_checkout_clean: bool
    binary_sha256: str


@dataclass(frozen=True)
class CellAdapterIdentity:
    input_backend: str
    window_backend: str
    screenshot_backend: str
    input_probe: bool
    focus_probe: bool
    point_ownership_probe: bool
    screenshot_probe: bool


@dataclass(frozen=True)
class RuntimeCellManifest:
    """Immutable identity of one acquired Native Desktop runtime cell."""

    cell_id: str
    gate_id: str
    run_id: str
    state: RuntimeCellState
    platform: CellPlatformIdentity
    transport: CellTransportIdentity
    display: CellDisplayIdentity
    source: CellSourceIdentity
    native_adapter: CellAdapterIdentity
    lease_owner_run_id: str
    lease_expires_at: str
    cleanup_registered: bool
    cleanup_resources: tuple[str, ...] = ()
    artifact_kind: str = "acceptance-runtime-cell-manifest"

    def validate(self, contract: RuntimeCellContract) -> None:
        if self.cell_id != contract.cell_id:
            raise ProvisioningError(
                f"runtime cell manifest {self.cell_id!r} does not match "
                f"contract {contract.cell_id!r}"
            )
        if self.platform.os != contract.platform:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: platform identity mismatch"
            )
        if self.platform.architecture != contract.architecture:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: architecture identity mismatch"
            )
        if self.platform.isolation_kind != contract.isolation.kind:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: isolation identity mismatch"
            )
        if self.transport.kind != contract.transport.kind:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: transport identity mismatch"
            )
        if self.display.session_type != contract.display.session_type:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: display identity mismatch"
            )
        if self.source.mode != contract.source.mode:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: source mode mismatch"
            )
        if (
            self.native_adapter.input_backend != contract.native_adapter.input
            or self.native_adapter.window_backend != contract.native_adapter.window
            or self.native_adapter.screenshot_backend
            != contract.native_adapter.screenshot
        ):
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: native adapter identity mismatch"
            )
        if contract.isolation.image_digest_required and not _SHA256_PATTERN.fullmatch(
            self.platform.image_digest
        ):
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: image digest is missing or invalid"
            )
        for name, value in (
            ("hostIdentitySha256", self.transport.host_identity_sha256),
            ("hostKeySha256", self.transport.host_key_sha256),
            ("desktopUserIdentitySha256", self.display.desktop_user_identity_sha256),
            ("remoteSourceDigest", self.source.remote_source_digest),
        ):
            if not _SHA256_PATTERN.fullmatch(value):
                raise ProvisioningError(
                    f"runtime cell {self.cell_id}: {name} is missing or invalid"
                )
        if contract.source.binary_sha256_required and not _SHA256_PATTERN.fullmatch(
            self.source.binary_sha256
        ):
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: binary SHA-256 is missing or invalid"
            )
        if (
            contract.source.clean_commit_required_for_proof
            and (
                not self.source.remote_checkout_clean
                or self.source.workspace_digest != "clean"
            )
        ):
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: source checkout is not clean"
            )
        if not self.source.commit:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: source commit is required"
            )
        if contract.display.connected_output_required and not self.display.connected_output:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: connected display output is required"
            )
        if not (
            self.native_adapter.input_probe
            and self.native_adapter.focus_probe
            and self.native_adapter.point_ownership_probe
            and self.native_adapter.screenshot_probe
        ):
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: native adapter probes are incomplete"
            )
        if self.display.width <= 0 or self.display.height <= 0:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: display geometry is invalid"
            )
        if contract.display.fixed_geometry:
            expected_width, expected_height = (
                int(part)
                for part in contract.display.fixed_geometry.split("x", 1)
            )
            if (
                self.display.width != expected_width
                or self.display.height != expected_height
            ):
                raise ProvisioningError(
                    f"runtime cell {self.cell_id}: display geometry "
                    f"{self.display.width}x{self.display.height} does not "
                    f"match required {contract.display.fixed_geometry}"
                )
        if contract.transport.kind == "ssh":
            for name, port in (
                ("webdriverLocalPort", self.transport.webdriver_local_port),
                ("webdriverRemotePort", self.transport.webdriver_remote_port),
            ):
                if port < 1 or port > 65535:
                    raise ProvisioningError(
                        f"runtime cell {self.cell_id}: {name} is invalid"
                    )
        if self.lease_owner_run_id != self.run_id:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: lease owner does not match run"
            )
        if self.state == RuntimeCellState.LEASED and not self.cleanup_registered:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: cleanup is not registered"
            )
        missing_cleanup = set(contract.cleanup_resources) - set(
            self.cleanup_resources
        )
        if missing_cleanup:
            raise ProvisioningError(
                f"runtime cell {self.cell_id}: cleanup resources missing: "
                f"{sorted(missing_cleanup)}"
            )

    def is_ready_for_gate(self, contract: RuntimeCellContract) -> bool:
        self.validate(contract)
        return self.state == RuntimeCellState.LEASED

    def to_dict(self) -> dict[str, Any]:
        return redact_value(
            {
                "artifactKind": self.artifact_kind,
                "cellId": self.cell_id,
                "gateId": self.gate_id,
                "runId": self.run_id,
                "state": self.state.value,
                "platform": {
                    "os": self.platform.os,
                    "hostDistribution": self.platform.host_distribution,
                    "hostKernel": self.platform.host_kernel,
                    "isolationKind": self.platform.isolation_kind,
                    "imageDigest": self.platform.image_digest,
                    "distribution": self.platform.distribution,
                    "architecture": self.platform.architecture,
                    "webviewBackend": self.platform.webview_backend,
                    "webviewVersion": self.platform.webview_version,
                },
                "transport": {
                    "kind": self.transport.kind,
                    "hostIdentitySha256": self.transport.host_identity_sha256,
                    "hostKeySha256": self.transport.host_key_sha256,
                    "webdriverLocalPort": self.transport.webdriver_local_port,
                    "webdriverRemotePort": self.transport.webdriver_remote_port,
                },
                "display": {
                    "sessionType": self.display.session_type,
                    "displayId": self.display.display_id,
                    "seat": self.display.seat,
                    "geometry": {
                        "width": self.display.width,
                        "height": self.display.height,
                    },
                    "connectedOutput": self.display.connected_output,
                    "desktopUserIdentitySha256": (
                        self.display.desktop_user_identity_sha256
                    ),
                },
                "source": {
                    "mode": self.source.mode,
                    "commit": self.source.commit,
                    "workspaceDigest": self.source.workspace_digest,
                    "remoteSourceDigest": self.source.remote_source_digest,
                    "remoteCheckoutClean": self.source.remote_checkout_clean,
                    "binarySha256": self.source.binary_sha256,
                },
                "nativeAdapter": {
                    "inputBackend": self.native_adapter.input_backend,
                    "windowBackend": self.native_adapter.window_backend,
                    "screenshotBackend": self.native_adapter.screenshot_backend,
                    "inputProbe": self.native_adapter.input_probe,
                    "focusProbe": self.native_adapter.focus_probe,
                    "pointOwnershipProbe": (
                        self.native_adapter.point_ownership_probe
                    ),
                    "screenshotProbe": self.native_adapter.screenshot_probe,
                },
                "lease": {
                    "ownerRunId": self.lease_owner_run_id,
                    "expiresAt": self.lease_expires_at,
                },
                "cleanup": {
                    "registered": self.cleanup_registered,
                    "resources": list(self.cleanup_resources),
                },
            }
        )
