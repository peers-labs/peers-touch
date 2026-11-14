"""Git-only source fence and bilateral integration inventory.

No checkout, branch update or working-tree write is performed here.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


class IntegrationError(ValueError):
    pass


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise IntegrationError(f"git {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout.strip()


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def tree_files(root: Path, tree: str) -> dict[str, dict[str, str]]:
    records = git(root, "ls-tree", "-r", "-z", tree).split("\0")
    return {
        record.split("\t", 1)[1]: dict(zip(("mode", "type", "object"),
                                        record.split("\t", 1)[0].split()))
        for record in records if record
    }


def source_fence(root: Path, ours: str, theirs: str, candidate: str) -> dict:
    left = git(root, "rev-parse", "--verify", f"{ours}^{{commit}}")
    right = git(root, "rev-parse", "--verify", f"{theirs}^{{commit}}")
    bases = git(root, "merge-base", "--all", left, right).splitlines()
    if len(bases) != 1:
        raise IntegrationError("AMBIGUOUS_MERGE_BASE: resolve criss-cross ancestry")
    if candidate == "auto":
        result = subprocess.run(
            ["git", "merge-tree", "--write-tree", left, right],
            cwd=root, capture_output=True, text=True,
        )
        if result.returncode:
            raise IntegrationError("UNRESOLVED_MERGE: prepare the resolved index")
        tree = result.stdout.splitlines()[0]
    elif candidate == "index":
        if git(root, "diff", "--name-only", "--diff-filter=U"):
            raise IntegrationError("UNRESOLVED_MERGE: index has conflicts")
        tree = git(root, "write-tree")
    else:
        tree = git(root, "rev-parse", "--verify", f"{candidate}^{{tree}}")
    return {"ours": left, "theirs": right, "mergeBase": bases[0], "candidateTree": tree}


def changed_files(root: Path, before: str, after: str) -> set[str]:
    return set(filter(None, git(
        root, "diff", "--name-only", "--no-renames", "-z", before, after, "--"
    ).split("\0")))


def protected_standard(path: str) -> bool:
    name = Path(path).name.lower()
    return (
        any(part in path.lower().split("/") for part in ("tests", "test", "e2e"))
        or any(token in name for token in (".test.", ".spec.", "_test.", "-test."))
        or name.startswith("test_")
        or path.startswith(("tooling/acceptance/", ".github/workflows/"))
        or name in ("gates.yaml", "gates.json")
    )


def ui_source(path: str) -> bool:
    return path.endswith((".tsx", ".jsx", ".css", ".html", ".vue", ".svelte"))


def read_json_at(root: Path, tree: str, path: str) -> dict:
    exists = subprocess.run(
        ["git", "cat-file", "-e", f"{tree}:{path}"], cwd=root, capture_output=True
    )
    if exists.returncode:
        return {}
    try:
        return json.loads(git(root, "show", f"{tree}:{path}"))
    except json.JSONDecodeError as error:
        raise IntegrationError(f"INVALID_CONTRACT: {path}: {error}") from error


def contains(prefix: str, path: str) -> bool:
    return path == prefix or path.startswith(prefix.rstrip("/") + "/")


def architecture_closure(root: Path, fence: dict, paths: set[str]) -> list[dict]:
    """Union all three registries so deleting a registration cannot hide impact."""
    registry_path = (
        "docs/architecture/engineering/architecture-governance/"
        "architecture-modules.json"
    )
    modules: dict[str, dict] = {}
    capabilities: dict[str, dict] = {}
    versions = []
    for revision in (fence["ours"], fence["theirs"], fence["candidateTree"]):
        registry = read_json_at(root, revision, registry_path)
        versions.append({module["id"]: module for module in registry.get("modules", [])})
        for module in registry.get("modules", []):
            entry = modules.setdefault(module["id"], {
                "id": module["id"], "roots": set(), "contracts": set(), "gates": set(),
            })
            entry["roots"].update(module.get("governedPaths", []))
            entry["contracts"].add(module["root"])
            for capability in module.get("capabilities", []):
                cap = capabilities.setdefault(capability["id"], {
                    "module": module["id"], "roots": set(), "dependencies": set(),
                    "gates": set(),
                })
                cap["roots"].update(capability.get("contractRoots", []))
                cap["roots"].update(capability.get("consumers", []))
                cap["dependencies"].update(capability.get("allowedDependencies", []))
                cap["gates"].update(capability.get("evidenceGates", []))
    selected = {
        key for key, cap in capabilities.items()
        if any(contains(prefix, path) for prefix in cap["roots"] for path in paths)
    }
    changed_modules = set()
    if registry_path in paths:
        changed_modules = {
            key for key in modules
            if any(version.get(key) != versions[-1].get(key) for version in versions[:-1])
        }
        selected |= {key for key, cap in capabilities.items() if cap["module"] in changed_modules}
    # Producers and consumers both matter. Expand registered capabilities to a
    # fixed point; external library identifiers do not become invented owners.
    while True:
        expanded = selected | {
            key for key, cap in capabilities.items()
            if cap["dependencies"] & selected
        }
        expanded |= {
            dependency for key in selected
            for dependency in capabilities[key]["dependencies"]
            if dependency in capabilities
        }
        if expanded == selected:
            break
        selected = expanded
    owners = {
        key for key, module in modules.items()
        if any(contains(prefix, path) for prefix in module["roots"] for path in paths)
    } | {capabilities[key]["module"] for key in selected} | changed_modules
    for key in selected:
        cap = capabilities[key]
        modules[cap["module"]]["roots"].update(cap["roots"])
        modules[cap["module"]]["gates"].update(cap["gates"])
    return [
        {key: sorted(value) if isinstance(value, set) else value
         for key, value in modules[owner].items()}
        for owner in sorted(owners)
    ]


def inventory(root: Path, fence: dict) -> dict:
    base, ours, theirs, candidate = (
        tree_files(root, fence[key])
        for key in ("mergeBase", "ours", "theirs", "candidateTree")
    )
    left = changed_files(root, fence["mergeBase"], fence["ours"])
    right = changed_files(root, fence["mergeBase"], fence["theirs"])
    paths = left | right | changed_files(root, fence["ours"], fence["candidateTree"])
    paths |= changed_files(root, fence["theirs"], fence["candidateTree"])
    entries = []
    for path in sorted(paths):
        lost_from = [
            side for side, files in (("ours", ours), ("theirs", theirs))
            if files.get(path) != candidate.get(path) and path in files
        ]
        entry = {
            "path": path, "changedOn": [
                side for side, files in (("ours", left), ("theirs", right))
                if path in files
            ],
            "baseBlob": base.get(path, {}).get("object"),
            "oursBlob": ours.get(path, {}).get("object"),
            "theirsBlob": theirs.get(path, {}).get("object"),
            "candidateBlob": candidate.get(path, {}).get("object"),
            "baseEntry": base.get(path), "oursEntry": ours.get(path),
            "theirsEntry": theirs.get(path), "candidateEntry": candidate.get(path),
            "executable": any(int(files.get(path, {}).get("mode", "0"), 8) & 0o111
                              for files in (base, ours, theirs, candidate)),
            "differsFrom": lost_from, "standard": protected_standard(path),
            "ui": ui_source(path), "historicalReversion": False,
        }
        # A blob from the ancestry of the still-new parent reappears in the
        # candidate. This catches history-propagated damage without UI tokens.
        if lost_from and candidate.get(path):
            parents = [fence[side] for side in lost_from]
            versions = git(root, "log", "--format=%H", *parents, "--", path).splitlines()
            for commit in versions:
                prior = git(root, "ls-tree", commit, "--", path)
                if prior and prior.split()[:3] == [
                        candidate[path]["mode"], candidate[path]["type"], candidate[path]["object"]]:
                    entry["historicalReversion"] = True
                    break
        entries.append(entry)
    return {
        "files": entries,
        "architecture": architecture_closure(root, fence, paths),
    }
