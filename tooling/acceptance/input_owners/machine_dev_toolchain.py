"""Concrete inputs of the unchanged MachineDev self-check command."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.operation_observer import runner_operation_stream
from .installed_inputs import executable_input
from .node_toolchain import node_source_observation
from .observation_trace import InputOwnerTrace


GATE_ID = "machine-dev-registry-self"
OWNER_ID = "machine-dev-toolchain"
COMMAND = (
    "node --test tooling/scripts/local-dev/machine-dev.test.mjs "
    "tooling/devctl/test/desktop.test.mjs tooling/devctl/test/process-adapter.test.mjs "
    "tooling/devctl/test/profile.test.mjs tooling/devctl/test/station.test.mjs"
)
COMMANDS = {
    GATE_ID: COMMAND,
    "acceptance-run-static-gate": (
        "python3 tooling/scripts/acceptance-run-test.py && python3 -m unittest "
        "tooling.acceptance.tests.test_input_owner_diagnostics "
        "tooling.acceptance.tests.test_machine_dev_input_owner"
    ),
}
TOOLS = ["node", "python3", "sh", "bash", "env", "git", "ps", "sleep"]

# Read through the same port and slot APIs that the original tests consume.
# Connections carry no application request; all sockets close before returning.
FIXTURE_OBSERVATION = r"""
import {realpathSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = process.argv[1];
const {isPortListening} = await import(
  pathToFileURL(resolve(root, 'tooling/devctl/process-adapter.mjs')));
const {slotPorts} = await import(
  pathToFileURL(resolve(root, 'tooling/scripts/local-dev/machine-dev-registry.mjs')));
const ports = [9, ...Array.from({length: 100}, (_, slot) => slotPorts(slot).station)];
const states = new Array(ports.length);
let cursor = 0;
await Promise.all(Array.from({length: 4}, async () => {
  while (cursor < ports.length) {
    const index = cursor++;
    states[index] = {port: ports[index], listening: await isPortListening(ports[index])};
  }
}));
const parent = realpathSync(tmpdir());
const metadata = statSync(parent);
process.stdout.write(JSON.stringify({
  temporaryParent: parent,
  parentMode: metadata.mode & 0o7777,
  parentOwner: [metadata.uid, metadata.gid],
  ports: states
}));
"""


def fixture_inputs(root: Path) -> dict[str, Any]:
    node = executable_input("node")
    completed = subprocess.run(
        [node["path"], "--input-type=module", "-e", FIXTURE_OBSERVATION, str(root)],
        cwd=root, capture_output=True, text=True, check=True, timeout=2,
    )
    if len(completed.stdout.encode()) > 16384:
        raise ValueError("MachineDev fixture observation exceeds its input boundary")
    value = json.loads(completed.stdout)
    expected_ports = [9, *(18080 + slot * 100 for slot in range(100))]
    if (
        not isinstance(value, dict)
        or set(value) != {"temporaryParent", "parentMode", "parentOwner", "ports"}
        or not isinstance(value["temporaryParent"], str)
        or not Path(value["temporaryParent"]).is_absolute()
        or type(value["parentMode"]) is not int
        or not 0 <= value["parentMode"] <= 0o7777
        or not isinstance(value["parentOwner"], list)
        or len(value["parentOwner"]) != 2
        or any(type(item) is not int or item < 0 for item in value["parentOwner"])
        or not isinstance(value["ports"], list)
        or len(value["ports"]) != len(expected_ports)
        or any(
            not isinstance(item, dict)
            or set(item) != {"port", "listening"}
            or type(item["port"]) is not int
            or item["port"] != port
            or type(item["listening"]) is not bool
            for item, port in zip(value["ports"], expected_ports)
        )
    ):
        raise ValueError("MachineDev fixture observation is incomplete")
    return value


def machine_dev_observation(context: dict[str, Any], *, root: Path) -> dict[str, Any]:
    gate = context["gate"]
    gate_id = gate["id"]
    if gate_id not in COMMANDS or gate.get("command") != COMMANDS[gate_id]:
        raise ValueError("MachineDev input owner does not own this command")
    # The shared owner still rejects product equipment and closes actual tools.
    value = node_source_observation(
        gate_id, context, root=root, tools=TOOLS, imports=[],
    )
    with InputOwnerTrace(gate_id, context).stage("machine-dev-fixture-inputs"):
        fixtures = fixture_inputs(root)
    value["ownerId"] = OWNER_ID
    value["inputs"]["runtime"] = digest({
        "nodeSource": value["inputs"]["runtime"],
        "temporaryParent": fixtures["temporaryParent"],
        "parentMode": fixtures["parentMode"],
        "parentOwner": fixtures["parentOwner"],
    })
    value["inputs"]["oracle"] = digest({
        "sourceOracle": value["inputs"]["oracle"], "ports": fixtures["ports"],
    })
    value["inputs"]["fixture"] = digest({
        "sourceFixture": value["inputs"]["fixture"], "fixtures": fixtures,
    })
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True, choices=list(COMMANDS))
    parser.parse_args()
    try:
        with runner_operation_stream():
            value = machine_dev_observation(
                json.loads(os.environ["PT_ACCEPTANCE_INPUT_CONTEXT"]), root=Path.cwd(),
            )
        print(json.dumps(value, sort_keys=True))
        return 0
    except (
        KeyError, TypeError, ValueError, OSError, RuntimeError, AttributeError,
        ImportError, subprocess.SubprocessError,
    ):
        print("MACHINE_DEV_INPUT_IDENTITY_UNPROVEN", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
