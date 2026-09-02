#!/usr/bin/env python3
"""Fail-closed coverage check for Modern Chat Agent V2 Rust protos."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


REQUIRED_PROTOS = (
    "domain/agent/agent.proto",
    "domain/agent/agent_config.proto",
    "domain/agent/turn_stream.proto",
    "domain/agent/home.proto",
    "domain/agent/capability.proto",
    "domain/agent/evaluation.proto",
)

CONST_PATTERN = re.compile(
    r"const\s+AGENT_V2_PROTO_FILES:\s*&\[&str\]\s*=\s*&\[(?P<body>.*?)\];",
    re.DOTALL,
)
PROTO_PATTERN = re.compile(r'"([^"]+\.proto)"')


class CoverageError(RuntimeError):
    pass


def parse_agent_v2_protos(build_source: str) -> tuple[str, ...]:
    match = CONST_PATTERN.search(build_source)
    if match is None:
        raise CoverageError("build.rs does not declare AGENT_V2_PROTO_FILES")
    protos = tuple(PROTO_PATTERN.findall(match.group("body")))
    if len(protos) != len(set(protos)):
        raise CoverageError("AGENT_V2_PROTO_FILES contains duplicate entries")
    return protos


def check_build_source(build_source: str) -> None:
    actual = parse_agent_v2_protos(build_source)
    if actual != REQUIRED_PROTOS:
        missing = sorted(set(REQUIRED_PROTOS) - set(actual))
        unexpected = sorted(set(actual) - set(REQUIRED_PROTOS))
        raise CoverageError(
            "AGENT_V2_PROTO_FILES must exactly match the six canonical protos; "
            f"missing={missing}, unexpected={unexpected}, order={list(actual)}"
        )
    if ".chain(AGENT_V2_PROTO_FILES.iter())" not in build_source:
        raise CoverageError("Desktop Rust compile list does not consume AGENT_V2_PROTO_FILES")
    if "for proto_file in AGENT_V2_PROTO_FILES" not in build_source:
        raise CoverageError("build.rs does not fail closed over AGENT_V2_PROTO_FILES")
    if "path.is_file()" not in build_source:
        raise CoverageError("build.rs does not reject a missing required proto")


def compile_descriptor(repo_root: Path) -> None:
    protoc = shutil.which("protoc")
    if protoc is None:
        raise CoverageError("protoc is required to compile the six-proto descriptor set")

    model_root = repo_root / "model"
    proto_paths = [model_root / proto for proto in REQUIRED_PROTOS]
    missing = [str(path.relative_to(repo_root)) for path in proto_paths if not path.is_file()]
    if missing:
        raise CoverageError(f"required proto files are missing: {missing}")

    with tempfile.TemporaryDirectory(prefix="agent-v2-proto-coverage-") as temp_dir:
        descriptor = Path(temp_dir) / "agent-v2.pb"
        command = [
            protoc,
            f"-I{model_root}",
            "--include_imports",
            f"--descriptor_set_out={descriptor}",
            *(str(path) for path in proto_paths),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise CoverageError(f"six-proto descriptor compilation failed: {detail}")
        if not descriptor.is_file() or descriptor.stat().st_size == 0:
            raise CoverageError("protoc returned success without a non-empty descriptor set")


def run_self_test() -> None:
    entries = "\n".join(f'    "{proto}",' for proto in REQUIRED_PROTOS)
    valid = f"""
const AGENT_V2_PROTO_FILES: &[&str] = &[
{entries}
];
fn compile() {{
    for proto_file in AGENT_V2_PROTO_FILES {{
        assert!(path.is_file());
    }}
    files.iter().chain(AGENT_V2_PROTO_FILES.iter());
}}
"""
    check_build_source(valid)

    invalid_cases = (
        valid.replace(f'    "{REQUIRED_PROTOS[-1]}",\n', ""),
        valid.replace(".chain(AGENT_V2_PROTO_FILES.iter())", ""),
        valid.replace("for proto_file in AGENT_V2_PROTO_FILES", "for proto_file in []"),
        valid.replace("path.is_file()", "true"),
    )
    for invalid in invalid_cases:
        try:
            check_build_source(invalid)
        except CoverageError:
            continue
        raise AssertionError("invalid build.rs fixture passed fail-closed coverage")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="repository root (defaults to the script's repository)",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        if args.self_test:
            run_self_test()
            print("agent-v2 proto coverage self-test: PASS")
            return 0

        repo_root = args.repo_root.resolve()
        build_rs = repo_root / "apps/desktop/src-tauri/build.rs"
        check_build_source(build_rs.read_text(encoding="utf-8"))
        compile_descriptor(repo_root)
        print("agent-v2 proto coverage: PASS (6/6 Rust inputs, descriptor compiled)")
        return 0
    except (CoverageError, OSError) as error:
        print(f"agent-v2 proto coverage: FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
