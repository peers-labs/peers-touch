#!/usr/bin/env python3

import json
import heapq
import os
import re
import struct
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple


FINGERPRINT_DIR = re.compile(r"^(?P<package>.+)-(?P<hash>[0-9a-f]{16})$")
ARTIFACT_NAME = re.compile(
    r"^(?P<family>.+)-(?P<hash>[0-9a-f]{16})(?P<suffix>.*)$"
)
SHORT_HASH = re.compile(r"^[0-9a-f]{16}$")
BUILD_SCRIPT_MARKER_PREFIXES = ("build-script-", "run-build-script-")


def normalize_name(value: str) -> str:
    return value.replace("-", "_").lower()


def manifest_package_name(manifest_path: Path) -> Optional[str]:
    try:
        lines = manifest_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    in_package = False
    for raw_line in lines:
        line = raw_line.split("#", 1)[0].strip()
        if line.startswith("[") and line.endswith("]"):
            in_package = line == "[package]"
            continue
        if not in_package:
            continue
        match = re.match(r'name\s*=\s*"([^"]+)"', line)
        if match:
            return match.group(1)
    return None


def marker_target_name(marker: str) -> str:
    for prefix in (
        "test-integration-test-",
        "test-example-",
        "test-bench-",
        "test-lib-",
        "test-bin-",
        "run-build-script-",
        "build-script-",
        "lib-",
        "bin-",
        "bench-",
        "example-",
    ):
        if marker.startswith(prefix):
            return normalize_name(marker[len(prefix) :])
    return normalize_name(marker)


def dependency_short_hash(value: int) -> str:
    return struct.pack("<Q", value).hex()


def load_units(profile: Path) -> Tuple[List[Dict[str, Any]], List[str]]:
    fingerprint_root = profile / ".fingerprint"
    units = []
    invalid_json = []
    if fingerprint_root.is_symlink():
        return units, [str(fingerprint_root)]
    if not fingerprint_root.is_dir():
        return units, invalid_json

    for directory in fingerprint_root.iterdir():
        match = FINGERPRINT_DIR.match(directory.name)
        if directory.is_symlink():
            invalid_json.append(str(directory))
            continue
        if not directory.is_dir() or not match:
            invalid_json.append(str(directory))
            continue
        invoked = directory / "invoked.timestamp"
        if invoked.is_symlink():
            invalid_json.append(str(invoked))
            continue
        invoked_mtime = invoked.stat().st_mtime if invoked.exists() else 0.0
        json_paths = list(directory.glob("*.json"))
        if not json_paths:
            invalid_json.append(str(directory))
            continue
        for json_path in json_paths:
            marker = directory / json_path.stem
            if json_path.is_symlink() or marker.is_symlink():
                invalid_json.append(str(json_path))
                continue
            try:
                payload = json.loads(json_path.read_text(encoding="utf-8"))
                short_hash = marker.read_text(encoding="utf-8").strip()
            except (OSError, ValueError):
                invalid_json.append(str(json_path))
                continue
            required_fields = ("features", "target", "profile", "path", "deps")
            if (
                not isinstance(payload, dict)
                or not all(field in payload for field in required_fields)
                or not isinstance(payload.get("deps"), list)
                or not SHORT_HASH.fullmatch(short_hash)
            ):
                invalid_json.append(str(json_path))
                continue
            dependencies = []
            malformed_dependency = False
            for dependency in payload["deps"]:
                if not (
                    isinstance(dependency, list)
                    and len(dependency) >= 4
                    and isinstance(dependency[1], str)
                    and isinstance(dependency[3], int)
                ):
                    malformed_dependency = True
                    break
                dependencies.append(
                    {
                        "name": normalize_name(dependency[1]),
                        "short_hash": dependency_short_hash(dependency[3]),
                    }
                )
            if malformed_dependency:
                invalid_json.append(str(json_path))
                continue
            units.append(
                {
                    "id": f"{profile}:{directory.name}:{json_path.stem}",
                    "package": match.group("package"),
                    "package_normalized": normalize_name(match.group("package")),
                    "artifact_hash": match.group("hash"),
                    "short_hash": short_hash,
                    "marker": json_path.stem,
                    "target_name": marker_target_name(json_path.stem),
                    "directory": directory,
                    "profile_path": profile,
                    "modified": max(json_path.stat().st_mtime, invoked_mtime),
                    "features": str(payload.get("features", "")),
                    "target": payload.get("target"),
                    "profile": payload.get("profile"),
                    "path": payload.get("path"),
                    "dependencies": dependencies,
                }
            )
    return units, invalid_json


def select_root_units(
    units: Sequence[Dict[str, Any]],
    package_name: str,
    cutoff: float,
    keep_generations: int,
) -> List[Dict[str, Any]]:
    groups: Dict[Tuple[Any, ...], List[Dict[str, Any]]] = defaultdict(list)
    for unit in units:
        if unit["package"] != package_name:
            continue
        if unit["marker"].startswith(BUILD_SCRIPT_MARKER_PREFIXES):
            continue
        key = (
            str(unit["profile_path"]),
            unit["package"],
            unit["marker"],
            unit["features"],
            unit["target"],
            unit["profile"],
            unit["path"],
        )
        groups[key].append(unit)

    selected = []
    for generations in groups.values():
        generations.sort(key=lambda item: item["modified"], reverse=True)
        selected.extend(generations[:keep_generations])
        selected.extend(
            unit
            for unit in generations[keep_generations:]
            if unit["modified"] >= cutoff
        )
    return list({unit["id"]: unit for unit in selected}.values())


def live_closure(
    units: Sequence[Dict[str, Any]],
    roots: Sequence[Dict[str, Any]],
) -> Tuple[Set[str], Set[str], Set[str], int]:
    by_short_hash: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    by_name: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for unit in units:
        by_short_hash[unit["short_hash"]].append(unit)
        by_name[unit["target_name"]].append(unit)
        by_name[unit["package_normalized"]].append(unit)

    live_ids: Set[str] = set()
    unresolved_names: Set[str] = set()
    unmapped_names: Set[str] = set()
    unresolved_references = 0
    stack = list(roots)
    while stack:
        unit = stack.pop()
        if unit["id"] in live_ids:
            continue
        live_ids.add(unit["id"])
        for dependency in unit["dependencies"]:
            matches = by_short_hash.get(dependency["short_hash"], [])
            if not matches:
                unresolved_names.add(dependency["name"])
                unresolved_references += 1
                matches = by_name.get(dependency["name"], [])
                if not matches:
                    unmapped_names.add(dependency["name"])
                    continue
            stack.extend(matches)
    return live_ids, unresolved_names, unmapped_names, unresolved_references


def artifact_index(profile: Path) -> Dict[str, List[Path]]:
    result: Dict[str, List[Path]] = defaultdict(list)
    for section_name in ("deps", "build"):
        section = profile / section_name
        if section.is_symlink() or not section.is_dir():
            continue
        for path in section.iterdir():
            match = ARTIFACT_NAME.match(path.name)
            if match:
                result[match.group("hash")].append(path)
    return result


def path_is_open(path: Path, opened: Set[Path]) -> bool:
    resolved = path.resolve()
    if not path.is_dir():
        return resolved in opened
    for opened_path in opened:
        if opened_path == resolved:
            return True
        if path.is_dir():
            try:
                opened_path.relative_to(resolved)
                return True
            except ValueError:
                pass
    return False


def regular_files(paths: Iterable[Path]) -> Iterable[Path]:
    for path in paths:
        if path.is_file() and not path.is_symlink():
            yield path
            continue
        if not path.is_dir() or path.is_symlink():
            continue
        for current, _, files in os.walk(path, followlinks=False):
            current_path = Path(current)
            for name in files:
                candidate = current_path / name
                if candidate.is_file() and not candidate.is_symlink():
                    yield candidate


def group_metrics(groups: List[Dict[str, Any]]) -> int:
    inode_records: Dict[Tuple[int, int], Dict[str, Any]] = {}
    for group in groups:
        group_inodes: Set[Tuple[int, int]] = set()
        group["file_count"] = 0
        group["logical_bytes"] = 0
        group["allocated_upper_bound_bytes"] = 0
        group["contains_open_file"] = bool(group.get("contains_open_file"))
        largest: List[Tuple[int, str]] = []
        for path in regular_files(group["path_objects"]):
            try:
                stat = path.stat()
                resolved = path.resolve()
            except OSError:
                continue
            inode = (stat.st_dev, stat.st_ino)
            group["file_count"] += 1
            group["logical_bytes"] += stat.st_size
            if inode not in group_inodes:
                group_inodes.add(inode)
                group["allocated_upper_bound_bytes"] += stat.st_blocks * 512
            record = inode_records.setdefault(
                inode,
                {
                    "blocks": stat.st_blocks * 512,
                    "link_count": stat.st_nlink,
                    "candidate_path_count": 0,
                    "group_path_counts": defaultdict(int),
                },
            )
            record["candidate_path_count"] += 1
            record["group_path_counts"][group["id"]] += 1
            if resolved in group["opened_paths"]:
                group["contains_open_file"] = True
            entry = (stat.st_size, str(path))
            if len(largest) < 5:
                heapq.heappush(largest, entry)
            elif entry > largest[0]:
                heapq.heapreplace(largest, entry)
        group["largest_files"] = [
            {"path": str(path), "bytes": size}
            for size, path in sorted(largest, reverse=True)
        ]
        group["_inodes"] = group_inodes

    reclaim_by_group: Dict[str, int] = defaultdict(int)
    cleanup_enabled = {
        group["id"]: group["cleanup_enabled"]
        for group in groups
    }
    batch_reclaim_bytes = 0
    for record in inode_records.values():
        batch_paths = sum(
            count
            for group_id, count in record["group_path_counts"].items()
            if cleanup_enabled[group_id]
        )
        if record["link_count"] <= batch_paths:
            batch_reclaim_bytes += record["blocks"]
        for group_id, count in record["group_path_counts"].items():
            if cleanup_enabled[group_id] and record["link_count"] <= count:
                reclaim_by_group[group_id] += record["blocks"]

    for group in groups:
        group["conservative_reclaim_bytes"] = reclaim_by_group[group["id"]]
        del group["_inodes"]
        del group["opened_paths"]
    return batch_reclaim_bytes


def candidate_groups(
    profile: Path,
    units: Sequence[Dict[str, Any]],
    live_ids: Set[str],
    unresolved_names: Set[str],
    cutoff: float,
    opened: Set[Path],
    writer_active: bool,
    include_paths: bool = False,
) -> Tuple[List[Dict[str, Any]], int]:
    by_directory: Dict[Path, List[Dict[str, Any]]] = defaultdict(list)
    for unit in units:
        by_directory[unit["directory"]].append(unit)
    live_directories = {
        unit["directory"]
        for unit in units
        if unit["id"] in live_ids
    }
    live_hashes = {
        unit["artifact_hash"]
        for unit in units
        if unit["id"] in live_ids
    }
    artifacts = artifact_index(profile)
    groups = []
    for directory, directory_units in by_directory.items():
        artifact_hash = directory_units[0]["artifact_hash"]
        target_names = {
            unit["target_name"]
            for unit in directory_units
        }
        package_names = {
            unit["package_normalized"]
            for unit in directory_units
        }
        modified = max(unit["modified"] for unit in directory_units)
        if directory in live_directories or artifact_hash in live_hashes:
            continue
        if modified >= cutoff:
            continue
        if target_names & unresolved_names or package_names & unresolved_names:
            continue
        paths = artifacts.get(artifact_hash, []) + [directory]
        contains_open = any(path_is_open(path, opened) for path in paths)
        groups.append(
            {
                "id": directory.name,
                "package": directory_units[0]["package"],
                "artifact_hash": artifact_hash,
                "target_names": sorted(target_names),
                "modified": modified,
                "fingerprint_directory": str(directory),
                "artifact_paths": len(paths) - 1,
                "path_objects": paths,
                "opened_paths": opened,
                "cleanup_enabled": not writer_active and not contains_open,
                "reason": (
                    "active Cargo or rustc writer"
                    if writer_active
                    else "candidate path is open"
                    if contains_open
                    else "not reachable from retained root fingerprints"
                ),
            }
        )
    batch_reclaim_bytes = group_metrics(groups)
    for group in groups:
        if include_paths:
            group["_path_objects"] = group.pop("path_objects")
        else:
            del group["path_objects"]
        if group["contains_open_file"]:
            group["cleanup_enabled"] = False
            group["reason"] = "candidate file is open"
    return groups, batch_reclaim_bytes


def profile_report(
    profile: Path,
    manifest_path: Path,
    package_name: str,
    profile_units: Sequence[Dict[str, Any]],
    profile_roots: Sequence[Dict[str, Any]],
    profile_live_ids: Set[str],
    unresolved_names: Set[str],
    unresolved_references: int,
    invalid_json: Sequence[str],
    cutoff: float,
    opened_paths: Set[Path],
    writer_active: bool,
    max_groups: int,
    include_paths: bool,
) -> Dict[str, Any]:
    groups, batch_reclaim_bytes = candidate_groups(
        profile,
        profile_units,
        profile_live_ids,
        unresolved_names,
        cutoff,
        opened_paths,
        writer_active,
        include_paths=include_paths,
    )
    groups.sort(
        key=lambda item: (
            item["conservative_reclaim_bytes"],
            item["allocated_upper_bound_bytes"],
        ),
        reverse=True,
    )
    cleanup_groups = [
        group
        for group in groups
        if group["cleanup_enabled"]
    ]
    return {
        "status": "conservative" if unresolved_names else "proven",
        "reason": (
            "unresolved dependency names are fully protected"
            if unresolved_names
            else "retained root fingerprint closure is complete"
        ),
        "profile": str(profile),
        "manifest_path": str(manifest_path),
        "package": package_name,
        "fingerprint_units": len(profile_units),
        "retained_root_units": len(profile_roots),
        "live_units": len(profile_live_ids),
        "invalid_fingerprint_json": len(invalid_json),
        "invalid_fingerprint_paths": list(invalid_json[:20]),
        "unresolved_dependency_names": sorted(unresolved_names),
        "unresolved_dependency_references": unresolved_references,
        "candidate_groups": len(groups),
        "cleanup_enabled_groups": len(cleanup_groups),
        "candidate_allocated_upper_bound_bytes": sum(
            group["allocated_upper_bound_bytes"] for group in groups
        ),
        "conservative_reclaim_bytes": sum(
            group["conservative_reclaim_bytes"] for group in cleanup_groups
        ),
        "batch_reclaim_bytes": batch_reclaim_bytes,
        "groups_truncated": max(0, len(groups) - max_groups),
        "groups": groups[:max_groups],
    }


def analyze_profiles(
    profiles: Sequence[Path],
    manifest_path: Path,
    cutoff: float,
    keep_generations: int,
    opened: Optional[Set[Path]] = None,
    writer_active: bool = False,
    max_groups: int = 100,
    include_paths: bool = False,
) -> Dict[str, Any]:
    opened_paths = opened or set()
    package_name = manifest_package_name(manifest_path)
    unique_profiles = list(
        dict.fromkeys(
            Path(os.path.abspath(str(profile)))
            for profile in profiles
        )
    )
    if not package_name:
        return {
            "status": "unproven",
            "reason": f"package name unavailable from {manifest_path}",
            "manifest_path": str(manifest_path),
            "profiles": [],
        }

    all_units = []
    invalid_by_profile: Dict[Path, List[str]] = {}
    for profile in unique_profiles:
        if profile.is_symlink():
            units, invalid_json = [], [str(profile)]
        else:
            units, invalid_json = load_units(profile)
            invalid_json.extend(
                str(path)
                for path in (
                    profile / "deps",
                    profile / "build",
                )
                if path.is_symlink()
            )
        all_units.extend(units)
        invalid_by_profile[profile] = invalid_json
    invalid_total = sum(len(paths) for paths in invalid_by_profile.values())
    if invalid_total:
        return {
            "status": "unproven",
            "reason": "one or more Cargo fingerprint JSON files are unreadable",
            "manifest_path": str(manifest_path),
            "package": package_name,
            "invalid_fingerprint_json": invalid_total,
            "invalid_fingerprint_paths": [
                path
                for paths in invalid_by_profile.values()
                for path in paths
            ][:100],
            "profiles": [
                {
                    "status": "unproven",
                    "reason": "Cargo fingerprint JSON is unreadable",
                    "profile": str(profile),
                    "groups": [],
                    "fingerprint_units": sum(
                        1
                        for unit in all_units
                        if unit["profile_path"] == profile
                    ),
                    "invalid_fingerprint_json": len(invalid_by_profile[profile]),
                    "invalid_fingerprint_paths": invalid_by_profile[profile][:20],
                }
                for profile in unique_profiles
            ],
        }
    roots = select_root_units(
        all_units,
        package_name,
        cutoff,
        keep_generations,
    )
    if not roots:
        return {
            "status": "unproven",
            "reason": f"no retained root fingerprints for {package_name}",
            "manifest_path": str(manifest_path),
            "package": package_name,
            "profiles": [
                {
                    "status": "unproven",
                    "reason": f"no retained root fingerprints for {package_name}",
                    "profile": str(profile),
                    "groups": [],
                    "fingerprint_units": sum(
                        1
                        for unit in all_units
                        if unit["profile_path"] == profile
                    ),
                    "invalid_fingerprint_json": len(invalid_by_profile[profile]),
                    "invalid_fingerprint_paths": invalid_by_profile[profile][:20],
                }
                for profile in unique_profiles
            ],
        }

    (
        live_ids,
        unresolved_names,
        unmapped_names,
        unresolved_references,
    ) = live_closure(
        all_units,
        roots,
    )
    if unmapped_names:
        return {
            "status": "unproven",
            "reason": "one or more retained dependencies have no fingerprint unit",
            "manifest_path": str(manifest_path),
            "package": package_name,
            "unresolved_dependency_names": sorted(unresolved_names),
            "unmapped_dependency_names": sorted(unmapped_names),
            "unresolved_dependency_references": unresolved_references,
            "profiles": [
                {
                    "status": "unproven",
                    "reason": "retained dependency fingerprint is unavailable",
                    "profile": str(profile),
                    "groups": [],
                    "fingerprint_units": sum(
                        1
                        for unit in all_units
                        if unit["profile_path"] == profile
                    ),
                    "invalid_fingerprint_json": 0,
                    "invalid_fingerprint_paths": [],
                }
                for profile in unique_profiles
            ],
        }
    reports = []
    for profile in unique_profiles:
        profile_units = [
            unit
            for unit in all_units
            if unit["profile_path"] == profile
        ]
        profile_roots = [
            unit
            for unit in roots
            if unit["profile_path"] == profile
        ]
        profile_live_ids = {
            unit["id"]
            for unit in profile_units
            if unit["id"] in live_ids
        }
        reports.append(
            profile_report(
                profile,
                manifest_path,
                package_name,
                profile_units,
                profile_roots,
                profile_live_ids,
                unresolved_names,
                unresolved_references,
                invalid_by_profile[profile],
                cutoff,
                opened_paths,
                writer_active,
                max_groups,
                include_paths,
            )
        )
    return {
        "status": "conservative" if unresolved_names else "proven",
        "reason": (
            "cross-profile unresolved dependency names are fully protected"
            if unresolved_names
            else "cross-profile retained root fingerprint closure is complete"
        ),
        "manifest_path": str(manifest_path),
        "package": package_name,
        "profiles_analyzed": len(unique_profiles),
        "fingerprint_units": len(all_units),
        "retained_root_units": len(roots),
        "live_units": len(live_ids),
        "unresolved_dependency_names": sorted(unresolved_names),
        "unresolved_dependency_references": unresolved_references,
        "candidate_groups": sum(
            report.get("candidate_groups", 0)
            for report in reports
        ),
        "cleanup_enabled_groups": sum(
            report.get("cleanup_enabled_groups", 0)
            for report in reports
        ),
        "candidate_allocated_upper_bound_bytes": sum(
            report.get("candidate_allocated_upper_bound_bytes", 0)
            for report in reports
        ),
        "conservative_reclaim_bytes": sum(
            report.get("conservative_reclaim_bytes", 0)
            for report in reports
        ),
        "profile_local_batch_reclaim_bytes": sum(
            report.get("batch_reclaim_bytes", 0)
            for report in reports
        ),
        "profiles": reports,
    }


def analyze_profile(
    profile: Path,
    manifest_path: Path,
    cutoff: float,
    keep_generations: int,
    opened: Optional[Set[Path]] = None,
    writer_active: bool = False,
    max_groups: int = 100,
    include_paths: bool = False,
) -> Dict[str, Any]:
    analysis = analyze_profiles(
        [profile],
        manifest_path,
        cutoff,
        keep_generations,
        opened=opened,
        writer_active=writer_active,
        max_groups=max_groups,
        include_paths=include_paths,
    )
    profiles = analysis.get("profiles", [])
    if profiles:
        return profiles[0]
    return {
        "status": analysis["status"],
        "reason": analysis["reason"],
        "profile": str(profile),
        "groups": [],
    }
