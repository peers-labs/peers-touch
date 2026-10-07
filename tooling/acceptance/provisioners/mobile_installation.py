from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


ANDROID_ADB_PACKAGE_SHA256_ADAPTER = "android-adb-package-sha256"
FRESH_INSTALL_STRATEGY = "fresh-install"
REUSE_EXACT_ARTIFACT_STRATEGY = "reuse-exact-artifact"
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_DESCRIPTOR_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


class MobileInstallationError(ValueError):
    """The installation policy, adapter result, or descriptor is invalid."""


@dataclass(frozen=True)
class AndroidInstalledArtifact:
    present: bool
    sha256: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.present, bool):
            raise MobileInstallationError(
                "installed artifact presence must be boolean"
            )
        if self.present:
            _require_sha256(self.sha256, "installed artifact")
        elif self.sha256 is not None:
            raise MobileInstallationError(
                "absent installed artifact cannot carry a SHA-256"
            )


@dataclass(frozen=True)
class MobileInstallationPolicy:
    adapter: str
    strategy: str
    user_confirmation_on_install: bool

    def __post_init__(self) -> None:
        if self.adapter != ANDROID_ADB_PACKAGE_SHA256_ADAPTER:
            raise MobileInstallationError(
                f"unsupported Mobile installation adapter: {self.adapter!r}"
            )
        if self.strategy not in {
            FRESH_INSTALL_STRATEGY,
            REUSE_EXACT_ARTIFACT_STRATEGY,
        }:
            raise MobileInstallationError(
                f"unsupported Mobile installation strategy: {self.strategy!r}"
            )
        if not isinstance(self.user_confirmation_on_install, bool):
            raise MobileInstallationError(
                "user_confirmation_on_install must be boolean"
            )


@dataclass(frozen=True)
class MobileDeviceDescriptor:
    id: str
    platform: str
    manufacturer: str
    model: str
    installation: MobileInstallationPolicy

    def __post_init__(self) -> None:
        if _DESCRIPTOR_ID_PATTERN.fullmatch(self.id) is None:
            raise MobileInstallationError("Mobile device descriptor ID is invalid")
        if self.platform != "android":
            raise MobileInstallationError(
                "Mobile installation descriptor platform must be android"
            )
        for label, value in (
            ("manufacturer", self.manufacturer),
            ("model", self.model),
        ):
            if not value or value.strip() != value:
                raise MobileInstallationError(
                    f"Mobile device descriptor {label} is invalid"
                )

    def matches(self, facts: Mapping[str, object]) -> bool:
        return (
            facts.get("platform") == self.platform
            and _normalized_identity(facts.get("manufacturer"))
            == _normalized_identity(self.manufacturer)
            and _normalized_identity(facts.get("model"))
            == _normalized_identity(self.model)
        )


@dataclass(frozen=True)
class AndroidInstallationDecision:
    action: str
    reason: str
    expected_sha256: str
    observed_sha256: str | None

    @property
    def reuses_installed_artifact(self) -> bool:
        return self.action == "reuse"


@dataclass(frozen=True)
class AndroidInstallationExecution:
    decision: AndroidInstallationDecision
    installed_sha256: str
    inspected_at: str
    removed_at: str | None
    installed_at: str | None
    activated_at: str
    post_removal_absent: bool

    def to_trace(self, policy: MobileInstallationPolicy) -> dict[str, object]:
        installed = not self.decision.reuses_installed_artifact
        return {
            "adapter": policy.adapter,
            "strategy": policy.strategy,
            "decision": self.decision.action,
            "decisionReason": self.decision.reason,
            "expectedArtifactSha256": self.decision.expected_sha256,
            "observedArtifactSha256": self.decision.observed_sha256,
            "installedArtifactSha256": self.installed_sha256,
            "exactArtifactMatch": (
                self.installed_sha256 == self.decision.expected_sha256
            ),
            "inspectedAt": self.inspected_at,
            "reuse": {
                "selected": self.decision.reuses_installed_artifact,
            },
            "uninstall": {
                "requested": installed,
                "postRemovalAbsent": self.post_removal_absent,
                "completedAt": self.removed_at,
            },
            "install": {
                "requested": installed,
                "completed": installed,
                "applicationPresent": True,
                "completedAt": self.installed_at,
                "userConfirmationPolicy": (
                    "required-on-install"
                    if policy.user_confirmation_on_install
                    else "not-required"
                ),
                "userConfirmationApplicable": (
                    installed and policy.user_confirmation_on_install
                ),
            },
            "activatedAt": self.activated_at,
        }


class AndroidInstallationAdapter(Protocol):
    adapter_id: str

    def inspect(self, application_id: str) -> AndroidInstalledArtifact:
        ...

    def remove(self, application_id: str) -> None:
        ...

    def install(self, package: Path) -> None:
        ...

    def activate(self, application_id: str) -> None:
        ...


def load_mobile_device_descriptor(path: Path) -> MobileDeviceDescriptor:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MobileInstallationError(
            f"cannot load Mobile device descriptor: {error}"
        ) from error
    if not isinstance(payload, Mapping) or set(payload) != {
        "id",
        "match",
        "installation",
    }:
        raise MobileInstallationError(
            "Mobile device descriptor has an invalid field set"
        )
    match = _closed_mapping(
        payload["match"],
        {"platform", "manufacturer", "model"},
        "Mobile device descriptor match",
    )
    installation = _closed_mapping(
        payload["installation"],
        {"adapter", "strategy", "user_confirmation_on_install"},
        "Mobile device descriptor installation",
    )
    return MobileDeviceDescriptor(
        id=_required_text(payload["id"], "Mobile device descriptor ID"),
        platform=_required_text(
            match["platform"],
            "Mobile device descriptor platform",
        ),
        manufacturer=_required_text(
            match["manufacturer"],
            "Mobile device descriptor manufacturer",
        ),
        model=_required_text(
            match["model"],
            "Mobile device descriptor model",
        ),
        installation=MobileInstallationPolicy(
            adapter=_required_text(
                installation["adapter"],
                "Mobile installation adapter",
            ),
            strategy=_required_text(
                installation["strategy"],
                "Mobile installation strategy",
            ),
            user_confirmation_on_install=installation[
                "user_confirmation_on_install"
            ],
        ),
    )


def decide_android_installation(
    policy: MobileInstallationPolicy,
    observed: AndroidInstalledArtifact,
    expected_sha256: str,
) -> AndroidInstallationDecision:
    expected = _require_sha256(expected_sha256, "expected Android artifact")
    if policy.strategy == FRESH_INSTALL_STRATEGY:
        return AndroidInstallationDecision(
            action="install",
            reason="fresh-install-policy",
            expected_sha256=expected,
            observed_sha256=observed.sha256,
        )
    if observed.present and observed.sha256 == expected:
        return AndroidInstallationDecision(
            action="reuse",
            reason="installed-artifact-sha256-match",
            expected_sha256=expected,
            observed_sha256=observed.sha256,
        )
    return AndroidInstallationDecision(
        action="install",
        reason=(
            "application-absent"
            if not observed.present
            else "installed-artifact-sha256-mismatch"
        ),
        expected_sha256=expected,
        observed_sha256=observed.sha256,
    )


def execute_android_installation(
    policy: MobileInstallationPolicy,
    adapter: AndroidInstallationAdapter,
    *,
    application_id: str,
    package: Path,
    expected_sha256: str,
    timestamp: Callable[[], str],
) -> AndroidInstallationExecution:
    if adapter.adapter_id != policy.adapter:
        raise MobileInstallationError(
            "Android installation adapter does not match the device policy"
        )
    if not application_id or application_id.strip() != application_id:
        raise MobileInstallationError("Android application ID is invalid")
    if not package.is_file():
        raise MobileInstallationError("Android package is unavailable")

    observed = adapter.inspect(application_id)
    inspected_at = timestamp()
    decision = decide_android_installation(policy, observed, expected_sha256)
    removed_at: str | None = None
    installed_at: str | None = None
    post_removal_absent = False

    if not decision.reuses_installed_artifact:
        adapter.remove(application_id)
        after_removal = adapter.inspect(application_id)
        if after_removal.present:
            raise MobileInstallationError(
                "Android application remains installed after removal"
            )
        post_removal_absent = True
        removed_at = timestamp()
        adapter.install(package)
        installed_at = timestamp()

    installed = adapter.inspect(application_id)
    installed_sha256 = installed.sha256
    if (
        not installed.present
        or installed_sha256 is None
        or installed_sha256 != decision.expected_sha256
    ):
        raise MobileInstallationError(
            "installed Android artifact does not match the attested APK SHA-256"
        )
    adapter.activate(application_id)
    return AndroidInstallationExecution(
        decision=decision,
        installed_sha256=installed_sha256,
        inspected_at=inspected_at,
        removed_at=removed_at,
        installed_at=installed_at,
        activated_at=timestamp(),
        post_removal_absent=post_removal_absent,
    )


def _closed_mapping(
    value: object,
    fields: set[str],
    label: str,
) -> Mapping[str, object]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise MobileInstallationError(f"{label} has an invalid field set")
    return value


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise MobileInstallationError(f"{label} is invalid")
    return value


def _require_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise MobileInstallationError(f"{label} SHA-256 is invalid")
    return value


def _normalized_identity(value: object) -> str:
    return value.strip().casefold() if isinstance(value, str) else ""
