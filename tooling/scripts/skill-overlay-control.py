#!/usr/bin/env python3
"""Machine-local control plane for user-owned Skill overlays."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REGISTRY_KIND = "peers-touch-skill-overlay-registry"
MANIFEST_KIND = "peers-touch-skill-overlay"
RESOLUTION_KIND = "peers-touch-skill-overlay-resolution"
SUPPORTED_TARGETS = {"pt-ew"}
NAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MANIFEST_KEYS = {"kind", "name", "target", "entry", "priority"}
REGISTRY_KEYS = {"kind", "overlays"}
REGISTRY_ENTRY_KEYS = {
    "name",
    "target",
    "digest",
    "priority",
    "enabled",
    "installedAt",
}
MAX_FILES = 128
MAX_BYTES = 2 * 1024 * 1024
LOCK_TIMEOUT_SECONDS = 10


class OverlayError(RuntimeError):
    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.detail = detail or {}


def fail(code: str, message: str, **detail: Any) -> None:
    raise OverlayError(code, message, detail)


def machine_root() -> Path:
    override = os.environ.get("PT_MACHINE_DEV_ROOT", "").strip()
    return (
        Path(override).expanduser()
        if override
        else Path.home() / ".peers-touch" / "dev"
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def is_valid_timestamp(value: object) -> bool:
    if not isinstance(value, str) or not value.endswith("Z"):
        return False
    try:
        datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return False
    return True


def require_name(
    value: object,
    field: str = "name",
    error_code: str = "OVERLAY_MANIFEST_INVALID",
) -> str:
    if not isinstance(value, str) or not NAME_PATTERN.fullmatch(value):
        fail(error_code, f"{field} must be kebab-case", field=field)
    return value


def require_target(value: object) -> str:
    if not isinstance(value, str) or value not in SUPPORTED_TARGETS:
        fail(
            "OVERLAY_TARGET_UNSUPPORTED",
            "overlay target is not supported",
            target=value,
        )
    return value


def parse_skill_frontmatter(path: Path) -> dict[str, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError, UnicodeDecodeError) as error:
        fail("OVERLAY_SKILL_INVALID", "SKILL.md is unreadable", cause=str(error))
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        fail("OVERLAY_SKILL_INVALID", "SKILL.md must start with YAML frontmatter")
    try:
        closing = lines.index("---", 1)
    except ValueError:
        fail("OVERLAY_SKILL_INVALID", "SKILL.md frontmatter is not closed")
    fields: dict[str, str] = {}
    for line in lines[1:closing]:
        if not line.strip():
            continue
        if line.startswith((" ", "\t")) or ":" not in line:
            fail(
                "OVERLAY_SKILL_INVALID",
                "SKILL.md frontmatter must use flat scalar fields",
            )
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key in fields or not value or value.startswith(("'", '"')):
            fail(
                "OVERLAY_SKILL_INVALID",
                "SKILL.md frontmatter fields must be unique unquoted scalars",
                field=key,
            )
        fields[key] = value
    if set(fields) != {"name", "description"}:
        fail(
            "OVERLAY_SKILL_INVALID",
            "SKILL.md frontmatter must contain only name and description",
            fields=sorted(fields),
        )
    require_name(fields["name"])
    if not fields["description"].strip():
        fail("OVERLAY_SKILL_INVALID", "SKILL.md description must not be empty")
    if not "\n".join(lines[closing + 1 :]).strip():
        fail("OVERLAY_SKILL_INVALID", "SKILL.md body must not be empty")
    return fields


def load_manifest(
    source: Path, *, require_directory_name: bool = True
) -> dict[str, Any]:
    manifest_path = source / "overlay.json"
    try:
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail("OVERLAY_MANIFEST_INVALID", "overlay.json is required")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("OVERLAY_MANIFEST_INVALID", "overlay.json is unreadable", cause=str(error))
    if not isinstance(value, dict) or set(value) != MANIFEST_KEYS:
        fail(
            "OVERLAY_MANIFEST_INVALID",
            "overlay.json has an invalid field set",
            fields=sorted(value) if isinstance(value, dict) else [],
        )
    if value.get("kind") != MANIFEST_KIND:
        fail("OVERLAY_MANIFEST_INVALID", "overlay.json kind is invalid")
    name = require_name(value.get("name"))
    target = require_target(value.get("target"))
    if require_directory_name and source.name != name:
        fail(
            "OVERLAY_MANIFEST_INVALID",
            "overlay directory name must match manifest name",
            directory=source.name,
            name=name,
        )
    if value.get("entry") != "SKILL.md":
        fail("OVERLAY_MANIFEST_INVALID", "overlay entry must be SKILL.md")
    priority = value.get("priority")
    if (
        isinstance(priority, bool)
        or not isinstance(priority, int)
        or not 0 <= priority <= 1000
    ):
        fail(
            "OVERLAY_MANIFEST_INVALID",
            "overlay priority must be an integer from 0 through 1000",
        )
    skill_fields = parse_skill_frontmatter(source / "SKILL.md")
    if skill_fields["name"] != name:
        fail(
            "OVERLAY_MANIFEST_INVALID",
            "SKILL.md name must match overlay name",
            manifestName=name,
            skillName=skill_fields["name"],
        )
    return {
        "kind": MANIFEST_KIND,
        "name": name,
        "target": target,
        "entry": "SKILL.md",
        "priority": priority,
    }


def source_manifest(source: Path) -> tuple[list[dict[str, Any]], str]:
    if source.is_symlink() or not source.is_dir():
        fail("OVERLAY_SOURCE_INVALID", "overlay source must be a real directory")
    entries: list[dict[str, Any]] = []
    total_bytes = 0
    for current, directories, files in os.walk(source, followlinks=False):
        current_path = Path(current)
        for name in [*directories, *files]:
            candidate = current_path / name
            if candidate.is_symlink():
                fail(
                    "OVERLAY_SOURCE_INVALID",
                    "overlay source must not contain symlinks",
                    path=candidate.relative_to(source).as_posix(),
                )
        for name in sorted(files):
            candidate = current_path / name
            metadata = candidate.stat()
            if not stat.S_ISREG(metadata.st_mode):
                fail(
                    "OVERLAY_SOURCE_INVALID",
                    "overlay source may contain only regular files",
                    path=candidate.relative_to(source).as_posix(),
                )
            content = candidate.read_bytes()
            total_bytes += len(content)
            entries.append(
                {
                    "path": candidate.relative_to(source).as_posix(),
                    "mode": metadata.st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    entries.sort(key=lambda entry: str(entry["path"]))
    if not entries or len(entries) > MAX_FILES or total_bytes > MAX_BYTES:
        fail(
            "OVERLAY_SOURCE_INVALID",
            "overlay source exceeds file or size limits",
            fileCount=len(entries),
            totalBytes=total_bytes,
        )
    serialized = json.dumps(entries, separators=(",", ":"), sort_keys=True).encode()
    return entries, hashlib.sha256(serialized).hexdigest()


def validate_registry(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != REGISTRY_KEYS:
        fail("OVERLAY_REGISTRY_INVALID", "overlay registry has an invalid field set")
    if value.get("kind") != REGISTRY_KIND or not isinstance(
        value.get("overlays"), dict
    ):
        fail("OVERLAY_REGISTRY_INVALID", "overlay registry shape is invalid")
    overlays: dict[str, Any] = {}
    for key, entry in value["overlays"].items():
        if (
            not isinstance(entry, dict)
            or set(entry) != REGISTRY_ENTRY_KEYS
            or key != entry.get("name")
        ):
            fail(
                "OVERLAY_REGISTRY_INVALID",
                "overlay registry entry is invalid",
                name=key,
            )
        name = require_name(
            entry.get("name"),
            "registry.name",
            "OVERLAY_REGISTRY_INVALID",
        )
        target = require_target(entry.get("target"))
        digest = entry.get("digest")
        priority = entry.get("priority")
        enabled = entry.get("enabled")
        if not isinstance(digest, str) or not DIGEST_PATTERN.fullmatch(digest):
            fail("OVERLAY_REGISTRY_INVALID", "overlay digest is invalid", name=name)
        if (
            isinstance(priority, bool)
            or not isinstance(priority, int)
            or not 0 <= priority <= 1000
        ):
            fail("OVERLAY_REGISTRY_INVALID", "overlay priority is invalid", name=name)
        if not isinstance(enabled, bool) or not is_valid_timestamp(
            entry.get("installedAt")
        ):
            fail("OVERLAY_REGISTRY_INVALID", "overlay lifecycle is invalid", name=name)
        overlays[name] = {
            "name": name,
            "target": target,
            "digest": digest,
            "priority": priority,
            "enabled": enabled,
            "installedAt": entry["installedAt"],
        }
    return {"kind": REGISTRY_KIND, "overlays": overlays}


class RegistryLock:
    def __init__(self, path: Path):
        self.path = path
        self.handle: Any = None

    def __enter__(self) -> "RegistryLock":
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.handle = self.path.open("a+b")
        os.chmod(self.path, 0o600)
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while True:
            try:
                if os.name == "nt":
                    import msvcrt

                    self.handle.seek(0)
                    if self.handle.read(1) == b"":
                        self.handle.write(b"\0")
                        self.handle.flush()
                    self.handle.seek(0)
                    msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    self.handle.close()
                    self.handle = None
                    fail("OVERLAY_REGISTRY_LOCKED", "overlay registry lock timed out")
                time.sleep(0.05)

    def __exit__(self, *_: object) -> None:
        if self.handle is None:
            return
        if os.name == "nt":
            import msvcrt

            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()


class OverlayStore:
    def __init__(self, root: Path | None = None):
        self.root = (root or machine_root()) / "skill-overlays"
        self.registry_path = self.root / "registry.json"
        self.store_root = self.root / "store"
        self.lock_path = self.root / "registry.lock"

    def ensure_root(self) -> None:
        if (
            self.root.is_symlink()
            or self.store_root.is_symlink()
            or self.lock_path.is_symlink()
        ):
            fail("OVERLAY_STORE_INVALID", "overlay control paths must not be symlinks")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.store_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        os.chmod(self.store_root, 0o700)
        if self.registry_path.is_symlink():
            fail("OVERLAY_REGISTRY_INVALID", "overlay registry must not be a symlink")

    def read_registry(self) -> dict[str, Any]:
        self.ensure_root()
        try:
            value = json.loads(self.registry_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"kind": REGISTRY_KIND, "overlays": {}}
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            fail("OVERLAY_REGISTRY_INVALID", "overlay registry is unreadable", cause=str(error))
        return validate_registry(value)

    def write_registry(self, registry: dict[str, Any]) -> None:
        validated = validate_registry(registry)
        descriptor, temporary = tempfile.mkstemp(
            prefix=".registry.", suffix=".tmp", dir=self.root
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(validated, handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.registry_path)
            if os.name != "nt":
                directory_fd = os.open(self.root, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    def installed_path(self, name: str, digest: str) -> Path:
        return self.store_root / name / digest

    def validate_installed(self, entry: dict[str, Any]) -> Path:
        installed = self.installed_path(entry["name"], entry["digest"])
        if installed.is_symlink() or not installed.is_dir():
            fail(
                "OVERLAY_STORE_INVALID",
                "installed overlay is missing",
                name=entry["name"],
            )
        _, actual_digest = source_manifest(installed)
        manifest = load_manifest(installed, require_directory_name=False)
        if (
            actual_digest != entry["digest"]
            or manifest["name"] != entry["name"]
            or manifest["target"] != entry["target"]
            or manifest["priority"] != entry["priority"]
        ):
            fail(
                "OVERLAY_STORE_INVALID",
                "installed overlay does not match its registry entry",
                name=entry["name"],
            )
        return installed

    def copy_to_store(
        self, source: Path, name: str, digest: str, files: list[dict[str, Any]]
    ) -> Path:
        destination = self.installed_path(name, digest)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if destination.parent.is_symlink():
            fail(
                "OVERLAY_STORE_INVALID",
                "overlay name directory must not be a symlink",
            )
        if destination.exists():
            return destination
        staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=self.root))
        try:
            for entry in files:
                relative = Path(str(entry["path"]))
                target = staging / relative
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                shutil.copy2(source / relative, target, follow_symlinks=False)
            _, copied_digest = source_manifest(staging)
            if copied_digest != digest:
                fail("OVERLAY_SOURCE_CHANGED", "overlay source changed during install")
            os.rename(staging, destination)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
        return destination

    def prune(self, registry: dict[str, Any]) -> None:
        referenced = {
            self.installed_path(entry["name"], entry["digest"]).resolve()
            for entry in registry["overlays"].values()
        }
        for staging in self.root.glob(".staging-*"):
            if staging.is_dir() and not staging.is_symlink():
                shutil.rmtree(staging)
        if not self.store_root.exists():
            return
        for name_dir in self.store_root.iterdir():
            if name_dir.is_symlink() or not name_dir.is_dir():
                fail("OVERLAY_STORE_INVALID", "overlay store contains an invalid entry")
            for digest_dir in name_dir.iterdir():
                if digest_dir.is_symlink() or not digest_dir.is_dir():
                    fail(
                        "OVERLAY_STORE_INVALID",
                        "overlay store contains an invalid digest entry",
                    )
                if digest_dir.resolve() not in referenced:
                    shutil.rmtree(digest_dir)
            if not any(name_dir.iterdir()):
                name_dir.rmdir()

    def install(self, source: Path, replace: bool = False) -> dict[str, Any]:
        source = source.expanduser()
        if source.is_symlink():
            fail("OVERLAY_SOURCE_INVALID", "overlay source must not be a symlink")
        try:
            source = source.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            fail(
                "OVERLAY_SOURCE_INVALID",
                "overlay source cannot be resolved",
                cause=str(error),
            )
        files, digest = source_manifest(source)
        manifest = load_manifest(source)
        self.ensure_root()
        with RegistryLock(self.lock_path):
            registry = self.read_registry()
            existing = registry["overlays"].get(manifest["name"])
            if existing and existing["digest"] != digest and not replace:
                fail(
                    "OVERLAY_NAME_CONFLICT",
                    "overlay name is already installed with different content",
                    name=manifest["name"],
                )
            installed = self.copy_to_store(source, manifest["name"], digest, files)
            entry = {
                "name": manifest["name"],
                "target": manifest["target"],
                "digest": digest,
                "priority": manifest["priority"],
                "enabled": existing["enabled"] if existing else True,
                "installedAt": (
                    existing["installedAt"]
                    if existing and existing["digest"] == digest
                    else utc_now()
                ),
            }
            self.validate_installed(entry)
            registry["overlays"][entry["name"]] = entry
            self.write_registry(registry)
            self.prune(registry)
        return {
            "ok": True,
            "action": "install",
            "status": "INSTALLED",
            "overlay": entry,
            "skillPath": str(installed / "SKILL.md"),
        }

    def set_enabled(self, name: str, enabled: bool) -> dict[str, Any]:
        name = require_name(name)
        self.ensure_root()
        with RegistryLock(self.lock_path):
            registry = self.read_registry()
            entry = registry["overlays"].get(name)
            if entry is None:
                fail("OVERLAY_NOT_INSTALLED", "overlay is not installed", name=name)
            self.validate_installed(entry)
            entry["enabled"] = enabled
            self.write_registry(registry)
        return {
            "ok": True,
            "action": "enable" if enabled else "disable",
            "overlay": entry,
        }

    def uninstall(self, name: str) -> dict[str, Any]:
        name = require_name(name)
        self.ensure_root()
        with RegistryLock(self.lock_path):
            registry = self.read_registry()
            if name not in registry["overlays"]:
                fail("OVERLAY_NOT_INSTALLED", "overlay is not installed", name=name)
            del registry["overlays"][name]
            self.write_registry(registry)
            self.prune(registry)
        return {"ok": True, "action": "uninstall", "name": name}

    def list(self) -> dict[str, Any]:
        self.ensure_root()
        with RegistryLock(self.lock_path):
            registry = self.read_registry()
            overlays = []
            for entry in registry["overlays"].values():
                self.validate_installed(entry)
                overlays.append(dict(entry))
            overlays.sort(key=lambda entry: (entry["priority"], entry["name"]))
        return {
            "ok": True,
            "kind": REGISTRY_KIND,
            "overlays": overlays,
        }

    def resolve(self, target: str) -> dict[str, Any]:
        target = require_target(target)
        self.ensure_root()
        with RegistryLock(self.lock_path):
            registry = self.read_registry()
            overlays = []
            for entry in registry["overlays"].values():
                if not entry["enabled"] or entry["target"] != target:
                    continue
                installed = self.validate_installed(entry)
                overlays.append(
                    {
                        "name": entry["name"],
                        "priority": entry["priority"],
                        "digest": entry["digest"],
                        "skillPath": str(installed / "SKILL.md"),
                    }
                )
            overlays.sort(key=lambda entry: (entry["priority"], entry["name"]))
        return {
            "ok": True,
            "kind": RESOLUTION_KIND,
            "target": target,
            "overlays": overlays,
        }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="action", required=True)

    install = commands.add_parser("install")
    install.add_argument("--source", required=True)
    install.add_argument("--replace", action="store_true")

    commands.add_parser("list")

    for action in ("enable", "disable", "uninstall"):
        command = commands.add_parser(action)
        command.add_argument("name")

    resolve = commands.add_parser("resolve")
    resolve.add_argument("--target", default="pt-ew")
    return parser.parse_args(argv)


def run(argv: list[str]) -> dict[str, Any]:
    args = parse_args(argv)
    store = OverlayStore()
    if args.action == "install":
        return store.install(Path(args.source), replace=args.replace)
    if args.action == "list":
        return store.list()
    if args.action == "enable":
        return store.set_enabled(args.name, True)
    if args.action == "disable":
        return store.set_enabled(args.name, False)
    if args.action == "uninstall":
        return store.uninstall(args.name)
    if args.action == "resolve":
        return store.resolve(args.target)
    fail("OVERLAY_ACTION_INVALID", "unknown overlay action")


def main() -> None:
    try:
        result = run(sys.argv[1:])
    except OverlayError as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": error.code,
                        "message": str(error),
                        "detail": error.detail,
                    },
                },
                indent=2,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise SystemExit(2) from error
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
