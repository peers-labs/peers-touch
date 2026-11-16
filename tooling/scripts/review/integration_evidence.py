#!/usr/bin/env python3
"""Transport original integration evidence externally, never as source commits."""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

from integration_review import IntegrationError, load, require

MAX_DECODED = 20 * 1024 * 1024


def decode(encoded: str) -> dict:
    require(len(encoded) <= 60000, "EVIDENCE_TOO_LARGE", "dispatch input exceeds 60KB")
    compressed = base64.b64decode(encoded, validate=True)
    inflater = zlib.decompressobj()
    raw = inflater.decompress(compressed, MAX_DECODED + 1)
    require(len(raw) <= MAX_DECODED and inflater.eof and not inflater.unused_data,
            "INVALID_EVIDENCE", "truncated or oversized archive")
    value = json.loads(raw)
    require(isinstance(value, dict) and set(value) == {"plan", "results", "review"}
            and all(isinstance(item, dict) for item in value.values()),
            "INVALID_EVIDENCE", "exact plan/results/review objects required")
    return value


def write_bundle(value: dict, output: Path) -> None:
    require(output.is_dir(), "EVIDENCE_DIRECTORY_REQUIRED", str(output))
    (output / "bundle.json").write_text(json.dumps(value) + "\n")
    for key in ("plan", "results", "review"):
        (output / f"{key}.json").write_text(json.dumps(value[key]) + "\n")


def gh(*args: str) -> bytes:
    result = subprocess.run(["gh", *args], capture_output=True)
    require(result.returncode == 0, "EVIDENCE_UNAVAILABLE", result.stderr.decode())
    return result.stdout


def download(repository: str, head: str, base: str, output: Path) -> None:
    workflow = json.loads(gh("api", f"repos/{repository}/actions/workflows/integration-evidence.yml"))
    pages = json.loads(gh("api", "--paginate", "--slurp",
                         f"repos/{repository}/actions/artifacts?per_page=100"))
    name = f"integration-review-{head}-{base}"
    artifacts = sorted((artifact for page in pages for artifact in page["artifacts"]
                        if artifact["name"] == name and not artifact["expired"]),
                       key=lambda artifact: artifact["id"], reverse=True)
    require(bool(artifacts), "EVIDENCE_UNAVAILABLE",
            "publish external evidence using integration-evidence.yml, then rerun this check")
    artifact = artifacts[0]
    run = json.loads(gh("api", f"repos/{repository}/actions/runs/"
                       f"{artifact['workflow_run']['id']}"))
    require(run["workflow_id"] == workflow["id"] and run["event"] == "workflow_dispatch"
            and run["conclusion"] == "success",
            "INVALID_EVIDENCE_ORIGIN", "successful evidence workflow required")
    data = gh("api", f"repos/{repository}/actions/artifacts/{artifact['id']}/zip")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        item = archive.getinfo("bundle.json")
        require(item.file_size <= MAX_DECODED, "EVIDENCE_TOO_LARGE", "artifact")
        value = json.loads(archive.read(item))
    require(set(value) == {"plan", "results", "review"},
            "INVALID_EVIDENCE", "artifact members")
    write_bundle(value, output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pack", "unpack", "download"))
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--results", type=Path)
    parser.add_argument("--review", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repository")
    parser.add_argument("--head")
    parser.add_argument("--base")
    parser.add_argument("--pr", type=int)
    args = parser.parse_args()
    try:
        if args.action == "pack":
            require(args.pr is not None and args.pr > 0, "PR_REQUIRED", "--pr")
            require(all((args.plan, args.results, args.review)), "EVIDENCE_REQUIRED", "three inputs")
            value = {key: load(getattr(args, key)) for key in ("plan", "results", "review")}
            encoded = base64.b64encode(zlib.compress(json.dumps(value).encode())).decode()
            decode(encoded)
            args.output.write_text(json.dumps({"pr": str(args.pr), "bundle": encoded}) + "\n")
            print("Evidence dispatch inputs prepared; publish only with authorized gh workflow run")
        elif args.action == "unpack":
            write_bundle(decode(os.environ["INTEGRATION_EVIDENCE_BUNDLE"]), args.output)
        else:
            require(args.repository and args.head and args.base, "SOURCE_REQUIRED", "repository/parents")
            download(args.repository, args.head, args.base, args.output)
        return 0
    except (IntegrationError, OSError, ValueError, KeyError, zlib.error, zipfile.BadZipFile) as error:
        print(f"integration-evidence: BLOCKED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
