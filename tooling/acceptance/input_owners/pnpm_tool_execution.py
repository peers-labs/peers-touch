"""Actual installed tool version inputs under pnpm; no build/cache reuse grant."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import re
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.launch_context import GateLaunchSpec, GateProcessLauncher
from .installed_inputs import executable_input, file_digest, selection_input
from .pnpm_launchers import launcher_entry
from .pnpm_toolchain import delegation_candidates, pnpm_entry


WORKER = Path(__file__).with_name("node_execution_observation.cjs")
MARKER = "PT_NODE_EXECUTION_INPUTS="
OBSERVATION_FIELDS = {
    "entry", "executable", "versions", "architecture", "platform", "cwd", "path",
    "nodePath", "initialCache", "finalCache", "modules", "resolutions", "failures",
    "libraries", "observer", "context", "threadEntry", "complete", "event", "exitCode",
}


def node_execution_observations(stdout: str) -> tuple[list[dict[str, Any]], str]:
    """Reassemble bounded atomic frames; missing or altered fragments reject."""
    pending = {}
    seen = set()
    observations, output = [], []
    frame_pattern = re.compile(
        r"([1-9][0-9]{0,15}):(0|[1-9][0-9]{0,15}):(0|[1-9][0-9]{0,15}):"
        r"([0-9a-f]{64}):(0|[1-9][0-9]{0,5}):([1-9][0-9]{0,5}):([A-Za-z0-9+/]+={0,2})"
    )
    for line in stdout.splitlines(keepends=True):
        if not line.startswith(MARKER):
            output.append(line)
            continue
        match = frame_pattern.fullmatch(line.removeprefix(MARKER).removesuffix("\n"))
        if not match or not line.endswith("\n") or len(line.encode()) + 1 > 512:
            raise ValueError("Node observation atomic frame is malformed")
        pid, thread, sequence, checksum, index, count, encoded = match.groups()
        index, count = int(index), int(count)
        identity = (int(pid), int(thread), int(sequence))
        if index >= count or count > (16 * 1024 * 1024 + 239) // 240 or identity in seen:
            raise ValueError("Node observation frame identity or inventory is invalid")
        fragment = base64.b64decode(encoded, validate=True)
        if (
            not 1 <= len(fragment) <= 240
            or (index != count - 1 and len(fragment) != 240)
            or base64.b64encode(fragment).decode() != encoded
        ):
            raise ValueError("Node observation fragment is not canonical")
        if identity not in pending:
            if len(pending) >= 64:
                raise ValueError("Node observation concurrent samples exceeded")
            pending[identity] = {"checksum": checksum, "count": count, "fragments": {}}
        sample = pending[identity]
        if sample["checksum"] != checksum or sample["count"] != count or index in sample["fragments"]:
            raise ValueError("Node observation fragment is duplicated or inconsistent")
        sample["fragments"][index] = fragment
        if len(sample["fragments"]) != count:
            continue
        payload = b"".join(sample["fragments"][item] for item in range(count))
        if len(payload) > 16 * 1024 * 1024 or hashlib.sha256(payload).hexdigest() != checksum:
            raise ValueError("Node observation sample bytes changed")
        value = json.loads(payload)
        context = value.get("context") if isinstance(value, dict) else None
        if not isinstance(context, dict) or (
            type(context.get("pid")) is not int or context["pid"] != identity[0]
            or type(context.get("threadId")) is not int or context["threadId"] != identity[1]
        ):
            raise ValueError("Node observation frame and sample identities differ")
        observations.append(value)
        seen.add(identity)
        del pending[identity]
    if pending:
        raise ValueError("Node observation sample has missing fragments")
    return observations, "".join(output)


def pnpm_tool_execution_inputs(cwd: Path, name: str) -> dict[str, Any]:
    """Retain only the real version workload's modules, libraries and cache state."""
    if (
        platform.system() != "Darwin"
        or not isinstance(name, str) or not name
        or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
               for character in name)
        or any(os.environ.get(key) for key in (
            "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "OPENSSL_CONF",
            "OPENSSL_MODULES", "ICU_DATA", "NODE_ICU_DATA",
        ))
    ):
        raise ValueError("pnpm tool observation has no closed loader/platform selection")
    cwd = cwd.resolve(strict=True)
    launcher = cwd / "node_modules/.bin" / name
    entry, launcher_inputs = launcher_entry(launcher, name)
    selected, _ = pnpm_entry()
    candidates = delegation_candidates(cwd, selected)
    allowed = [*candidates, str(entry)]
    node = executable_input("node")
    observer = file_digest(WORKER)
    argv = (str(selected), "exec", name, "--version")
    completed = GateProcessLauncher(
        cwd=str(cwd), environment={
            **os.environ, "NODE_OPTIONS": "--require=" + json.dumps(str(WORKER)),
            "PT_NODE_OBSERVATION_ENTRIES": json.dumps(allowed),
        },
        termination_timeout_seconds=1,
    ).run(
        GateLaunchSpec(argv, 2, ()), None,
    )
    if len(completed.stdout.encode()) > 16 * 1024 * 1024:
        raise ValueError("pnpm tool observation exceeds its bounded output")
    observations, output = node_execution_observations(completed.stdout)
    if not 1 <= len(observations) <= 64:
        raise ValueError("pnpm tool input events exceed their bounded inventory")
    events = {}
    for value in observations:
        context = value.get("context")
        if (
            value.get("complete") is not True or not isinstance(context, dict)
            or set(context) != {"pid", "threadId", "isMainThread", "isInternalThread"}
            or type(context["pid"]) is not int or context["pid"] <= 0
            or type(context["threadId"]) is not int or context["threadId"] != 0
            or context["isMainThread"] is not True or context["isInternalThread"] is not False
            or value.get("threadEntry") is not None
        ):
            raise ValueError("pnpm tool reported incomplete or unclosed thread inputs")
        key = value.get("entry")
        if key not in allowed or (
            key in events and events[key].get("event") == "exit"
        ):
            raise ValueError("pnpm tool input event has no unique selected process")
        events[key] = value
    if set(events) != set(allowed):
        raise ValueError("pnpm tool did not report the complete selected Node process chain")
    observations = list(events.values())
    sources = {}
    libraries = {}
    for value in observations:
        if (
            set(value) != OBSERVATION_FIELDS or value["complete"] is not True
            or value["event"] not in {"exit", "native-library-loaded"}
            or value["observer"] != str(WORKER.resolve(strict=True))
            or value["executable"] != node["resolvedPath"]
            or value["platform"] != "darwin"
            or not isinstance(value["modules"], list) or not value["modules"]
            or not isinstance(value["libraries"], list) or not value["libraries"]
            or value["cwd"] != str(cwd)
            or any(
                not isinstance(value[key], list) or len(value[key]) > 8192
                for key in ("resolutions", "failures")
            )
        ):
            raise ValueError("pnpm tool reported incomplete or different runtime inputs")
        for row in value["modules"]:
            if not isinstance(row, dict) or set(row) != {
                "path", "resolved", "format", "fileBytes", "loadedSourceBytes", "cache",
                "postLoad",
            }:
                raise ValueError("Node module input has no complete load observation")
            if row["postLoad"] != {
                "state": "present", "fileBytes": row["fileBytes"],
                "resolved": row["resolved"],
            }:
                raise ValueError("Node module input has an incomplete post-load observation")
            origin = Path(row["path"])
            if not origin.is_absolute() or str(origin.resolve(strict=True)) != row["resolved"]:
                raise ValueError("Node module input selection changed")
            actual = {"selection": selection_input(origin), "bytes": file_digest(origin)}
            if actual["bytes"] != row["fileBytes"]:
                raise ValueError("Node module input bytes changed after execution")
            if str(origin) in sources and sources[str(origin)] != actual:
                raise ValueError("Node module inputs changed across the process chain")
            sources[str(origin)] = actual
        for filename in value["libraries"]:
            if not isinstance(filename, str) or not Path(filename).is_absolute():
                raise ValueError("Node loaded library input is not absolute")
            if filename.startswith(("/usr/lib/", "/System/Library/")):
                continue
            origin = Path(filename)
            actual = {"selection": selection_input(origin), "bytes": file_digest(origin)}
            if filename in libraries and libraries[filename] != actual:
                raise ValueError("Node loaded library inputs changed across the process chain")
            libraries[filename] = actual
    tool = next(value for value in observations if value["entry"] == str(entry))
    if tool["nodePath"] != launcher_inputs["injectedNodePath"]:
        raise ValueError("pnpm tool did not inherit its actual launcher NODE_PATH")
    if launcher_entry(launcher, name) != (entry, launcher_inputs) or file_digest(WORKER) != observer:
        raise ValueError("pnpm launcher or input observer changed during execution")
    release, version_info, machine = platform.mac_ver()
    return {
        "cwd": str(cwd), "argv": [str(selected), "exec", name, "--version"],
        "launcher": launcher_inputs, "node": node, "observerBytes": observer,
        "processes": observations, "loadedSources": sources, "loadedLibraries": libraries,
        "outputDigest": digest(output), "stderrDigest": digest(completed.stderr),
        "commandExitCode": completed.returncode,
        "platform": [
            platform.system(), platform.machine(), platform.version(),
            [release, list(version_info), machine],
        ],
        "qualification": "OBSERVED_TOOL_VERSION_INPUTS_ONLY",
        "allProcessesReportedExit": all(value["event"] == "exit" for value in observations),
        "compileCacheQualification": "UNPROVEN",
        "completeToolQualification": False, "completeBuildQualification": False,
    }
