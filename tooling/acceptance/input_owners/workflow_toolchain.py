"""Concrete inputs of the complete development-workflow self-check."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.operation_observer import runner_operation_stream
from .installed_inputs import executable_input, file_digest, macos_library_inputs, tree_digest
from .metadata_toolchain import cargo_metadata, fixture_parent, pnpm_metadata
from .node_toolchain import node_source_observation
from .observation_trace import InputOwnerTrace


GATE_ID = "development-workflow-control-plane"
OWNER_ID = "development-workflow-toolchain"
ORIGINAL_COMMAND = (
    "node --test tooling/scripts/local-dev/dev-work.test.mjs "
    "tooling/scripts/local-dev/development-close.test.mjs "
    "tooling/scripts/local-dev/completion-review.test.mjs "
    "tooling/scripts/local-dev/workflow-snapshot.test.mjs "
    "tooling/scripts/local-dev/workflow-doctor.test.mjs "
    "tooling/scripts/local-dev/workflow-state-inspector.test.mjs && "
    "python3 -m unittest tooling.acceptance.tests.test_execution_plan && "
    "bash tooling/scripts/review/skill-check.sh"
)
COMMAND = (
    "env NODE_DISABLE_COMPILE_CACHE=1 npm_config_manage_package_manager_versions=false "
    "sh -c '" + ORIGINAL_COMMAND + "'"
)
TOOLS = [
    "node", "python3", "sh", "bash", "env", "git", "rg", "dirname", "sed",
    "sort", "mktemp", "rm", "cut", "awk",
]
SHELL_UTILITIES = ("grep", "cat", "find", "wc", "tr")

# Run the reviewed SHA-256 stdin path through its actual interpreter. The
# exit observation reports loaded Perl modules and native XS images; it does
# not replace the filter's output or execute a different hash implementation.
PERL_OBSERVATION = r"""
use JSON::PP;
my $entry = shift @ARGV;
END {
  print "\nPT_PERL_OBSERVATION=", JSON::PP::encode_json({
    inc => \@INC, modules => \%INC, images => \@DynaLoader::dl_shared_objects,
    executable => $^X, version => "$^V"
  });
}
do $entry;
die "Perl delegate failed" if $@ || $!;
"""


def perl_delegate_inputs(script: Path) -> dict[str, Any]:
    """Observe actual code/images; this helper grants no Gate ownership."""
    if not script.read_bytes().startswith(b"#!/usr/bin/perl\n"):
        raise ValueError("checksum script has no reviewed Perl delegate")
    interpreter = executable_input("/usr/bin/perl")
    completed = subprocess.run(
        [interpreter["path"], "-e", PERL_OBSERVATION, str(script), "-a", "256"],
        input=b"", capture_output=True, check=True, timeout=2,
    )
    marker = b"\nPT_PERL_OBSERVATION="
    if len(completed.stdout) > 65536 or completed.stdout.count(marker) != 1:
        raise ValueError("Perl has no unique bounded exit observation")
    output, metadata = completed.stdout.split(marker)
    if output != (hashlib.sha256(b"").hexdigest() + "  -\n").encode():
        raise ValueError("Perl observation did not execute the SHA-256 stdin filter")
    value = json.loads(metadata)
    if (
        not isinstance(value, dict)
        or set(value) != {"inc", "modules", "images", "executable", "version"}
        or value["executable"] != interpreter["path"]
        or not isinstance(value["version"], str)
        or not isinstance(value["inc"], list)
        or not value["inc"] or len(value["inc"]) > 32
        or any(not isinstance(item, str) or not Path(item).is_absolute()
               for item in value["inc"])
        or not isinstance(value["modules"], dict)
        or not value["modules"] or len(value["modules"]) > 128
        or any(not isinstance(name, str) or not isinstance(path, str)
               or not Path(path).is_absolute()
               for name, path in value["modules"].items())
        or not isinstance(value["images"], list)
        or not value["images"] or len(value["images"]) > 32
        or any(not isinstance(item, str) or not Path(item).is_absolute()
               for item in value["images"])
    ):
        raise ValueError("Perl code/image observation is incomplete")
    modules = {
        name: {"path": path, "bytes": file_digest(Path(path))}
        for name, path in sorted(value["modules"].items())
    }
    images = {path: file_digest(Path(path)) for path in sorted(value["images"])}
    return {
        "script": {
            "path": str(script), "resolved": str(script.resolve(strict=True)),
            "bytes": file_digest(script), "mode": script.stat().st_mode & 0o777,
        },
        "interpreter": interpreter, "version": value["version"],
        "importPaths": value["inc"], "modules": modules, "images": images,
        "libraries": macos_library_inputs([
            Path(interpreter["resolvedPath"]), *(Path(path) for path in images),
        ]),
    }


def checksum_inputs() -> dict[str, Any]:
    if any(os.environ.get(key) for key in ("PERL5LIB", "PERLLIB", "PERL5OPT")):
        raise ValueError("configured Perl loader requires another input owner")
    selected = shutil.which("shasum")
    if selected != "/usr/bin/shasum":
        raise ValueError("checksum selection is not the reviewed macOS filter")
    return perl_delegate_inputs(Path(selected))


def workflow_fixture_inputs() -> dict[str, Any]:
    """Bind temporary-parent state and actual disposable Git initialization."""
    parent = fixture_parent()
    parents = {}
    candidates = list(dict.fromkeys((
        str(parent), *(os.environ[key] for key in ("TMPDIR", "TEMP", "TMP")
                       if os.environ.get(key)),
        "/tmp", "/var/tmp", "/usr/tmp", str(Path.cwd()),
    )))
    for location in candidates:
        path = Path(location)
        if not path.is_absolute():
            raise ValueError("relative temporary parent is not qualified")
        if not path.exists():
            parents[location] = "absent"
            continue
        if not path.is_dir():
            raise ValueError("temporary parent is not a directory")
        metadata = path.stat()
        parents[location] = {
            "resolved": str(path.resolve(strict=True)),
            "mode": metadata.st_mode & 0o7777, "owner": [metadata.st_uid, metadata.st_gid],
        }
    git = executable_input("git")
    completed = subprocess.run(
        [git["path"], "config", "--null", "--list"], cwd=parent,
        capture_output=True, check=True, timeout=2,
    )
    if len(completed.stdout) > 1024 * 1024:
        raise ValueError("fixture Git configuration exceeds its input boundary")
    configuration = dict(
        item.split(b"\n", 1) if b"\n" in item else (item, b"true")
        for item in completed.stdout.split(b"\0") if item
    )
    if (
        any(key.lower().startswith(b"includeif.") for key in configuration)
        or configuration.get(b"commit.gpgsign", b"false") not in (b"false", b"0")
        or configuration.get(b"core.fsmonitor", b"false") not in (b"false", b"0")
    ):
        raise ValueError("conditional or executable Git fixture configuration is unqualified")
    discovery = subprocess.run(
        [git["path"], "--exec-path"], cwd=parent,
        capture_output=True, text=True, check=True, timeout=2,
    )
    template_path = configuration.get(b"init.templatedir")
    templates = (
        Path(os.fsdecode(template_path)).expanduser()
        if template_path else
        Path(discovery.stdout.strip()).parent.parent / "share/git-core/templates"
    )
    if not templates.is_absolute():
        raise ValueError("relative Git template origin is unqualified")
    return {
        "temporaryParents": parents,
        "gitConfiguration": hashlib.sha256(completed.stdout).hexdigest(),
        "templates": {"path": str(templates), "bytes": tree_digest(templates)},
    }


def workflow_observation(context: dict[str, Any], *, root: Path) -> dict[str, Any]:
    gate = context["gate"]
    if (
        gate["id"] != GATE_ID or gate.get("command") != COMMAND
        or os.environ.get("NODE_DISABLE_COMPILE_CACHE") != "1"
        or os.environ.get("npm_config_manage_package_manager_versions") != "false"
    ):
        raise ValueError("workflow owner does not own this complete command")
    value = node_source_observation(
        GATE_ID, context, root=root, tools=TOOLS,
        imports=[{"origin": "tooling/scripts/architecture/module-governance.mjs",
                  "name": "yaml"}],
    )
    trace = InputOwnerTrace(GATE_ID, context)
    with trace.stage("workflow-shell-utilities"):
        utilities = {name: executable_input(name) for name in SHELL_UTILITIES}
        libraries = macos_library_inputs([
            Path(item["resolvedPath"]) for item in utilities.values()
        ])
    with trace.stage("pnpm-metadata"):
        pnpm = pnpm_metadata(root)
    with trace.stage("cargo-metadata"):
        cargo = cargo_metadata(root)
    with trace.stage("workflow-checksum-delegate"):
        checksum = checksum_inputs()
    with trace.stage("workflow-fixture-inputs"):
        fixtures = workflow_fixture_inputs()
    value["ownerId"] = OWNER_ID
    value["inputs"]["runtime"] = digest({
        "nodeSource": value["inputs"]["runtime"], "utilities": utilities,
        "libraries": libraries, "pnpm": pnpm, "cargo": cargo, "checksum": checksum,
    })
    value["inputs"]["fixture"] = digest({
        "sourceFixture": value["inputs"]["fixture"], "fixtures": fixtures,
    })
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True, choices=[GATE_ID])
    parser.parse_args()
    try:
        with runner_operation_stream():
            value = workflow_observation(
                json.loads(os.environ["PT_ACCEPTANCE_INPUT_CONTEXT"]), root=Path.cwd(),
            )
        print(json.dumps(value, sort_keys=True))
        return 0
    except (
        KeyError, TypeError, ValueError, OSError, RuntimeError, AttributeError,
        ImportError, subprocess.SubprocessError,
    ):
        print("WORKFLOW_TOOLCHAIN_INPUT_IDENTITY_UNPROVEN", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
