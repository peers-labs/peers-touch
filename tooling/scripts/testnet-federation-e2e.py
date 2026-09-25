#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from _acceptance_artifacts import artifact_session, explicit_output_path


NODES = {
    "one": os.environ.get("TESTNET_NODE_ONE_BASE", ""),
    "two": os.environ.get("TESTNET_NODE_TWO_BASE", ""),
    "three": os.environ.get("TESTNET_NODE_THREE_BASE", ""),
}
DEMO_ACCOUNTS = {
    "one": os.environ.get("TESTNET_NODE_ONE_ACCOUNT", ""),
    "two": os.environ.get("TESTNET_NODE_TWO_ACCOUNT", ""),
    "three": os.environ.get("TESTNET_NODE_THREE_ACCOUNT", ""),
}
DEMO_PASSWORD = os.environ.get("TESTNET_DEMO_PASSWORD", "")
GATE_ID = "federation-three-node-e2e"
REPORT_ROLE = "reports/testnet-p5-federation-e2e.json"
REPO_ROOT = Path(__file__).resolve().parents[2]
ACCESS_CLIENT_DIR = REPO_ROOT / "apps/station/app"


def request(method, url, payload=None, token=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw": raw[:512]}
        raise RuntimeError(
            f"{method} {url} failed status={error.code} body={body}"
        ) from error


def unwrap(body):
    if isinstance(body, dict) and isinstance(body.get("data"), dict):
        return body["data"]
    return body


def login_demo_actor(node_name, base):
    email = DEMO_ACCOUNTS[node_name]
    if not base or not email or not DEMO_PASSWORD:
        raise RuntimeError(
            "testnet federation access requires TESTNET_NODE_{ONE,TWO,THREE}_BASE, "
            "TESTNET_NODE_{ONE,TWO,THREE}_ACCOUNT, and TESTNET_DEMO_PASSWORD"
        )
    environment = {
        **os.environ,
        "PT_ACCESS_CLIENT_STATION": base,
        "PT_ACCESS_CLIENT_EMAIL": email,
        "PT_ACCESS_CLIENT_PASSWORD": DEMO_PASSWORD,
    }
    completed = subprocess.run(
        ["go", "run", "./tests/access_client"],
        cwd=ACCESS_CLIENT_DIR,
        env=environment,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"canonical Access client failed for node {node_name}: "
            f"{completed.stderr.strip() or 'unknown error'}"
        )
    try:
        body = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"canonical Access client returned invalid output for node {node_name}"
        ) from error
    if not isinstance(body, dict) or not body.get("token") or not body.get("ptid"):
        raise RuntimeError(
            f"canonical Access client returned incomplete output for node {node_name}"
        )
    return {
        "token": body["token"],
        "ptid": body["ptid"],
    }


def federation_health(base):
    return unwrap(request("GET", base + "/actor/federation/health"))


def create_federation(base, token):
    body = unwrap(
        request(
            "POST",
            base + "/sub-federation/federations",
            {
                "name": "C6 Topology Gate",
                "description": "one/two/three topology and ledger convergence",
                "policy_type": "single_admin",
            },
            token,
        )
    )
    return body["federation_id"]


def join_federation(base, token, federation_id, authority_base):
    authority = urllib.parse.urlsplit(authority_base)
    endpoint = authority.netloc or authority.path
    return unwrap(
        request(
            "POST",
            base + "/sub-federation/federations/join",
            {
                "federation_id": federation_id,
                "federation_endpoint": endpoint,
                "message": "C6 topology acceptance",
            },
            token,
        )
    )


def list_federations(base, token):
    return unwrap(
        request("GET", base + "/sub-federation/federations", token=token)
    ).get("federations", [])


def wait_for_convergence(logins, federation_id):
    deadline = time.time() + 75
    last = {}
    while time.time() < deadline:
        last = {}
        for node_name, base in NODES.items():
            federations = list_federations(base, logins[node_name]["token"])
            federation = next(
                (
                    item
                    for item in federations
                    if item.get("federation_id") == federation_id
                ),
                None,
            )
            last[node_name] = {
                "federation": federation,
            }
        if all(
            item["federation"] is not None
            and int(item["federation"].get("member_station_count", 0)) == 3
            for item in last.values()
        ):
            return last
        time.sleep(3)
    raise RuntimeError(
        "Federation projections did not converge: "
        + json.dumps(
            {
                node_name: {
                    "federation_visible": item["federation"] is not None,
                    "station_count": int(
                        (item["federation"] or {}).get(
                            "member_station_count",
                            0,
                        )
                    ),
                }
                for node_name, item in last.items()
            },
            sort_keys=True,
        )
    )


def run():
    missing = [
        name
        for name, value in {
            **{f"TESTNET_NODE_{key.upper()}_BASE": value for key, value in NODES.items()},
            **{f"TESTNET_NODE_{key.upper()}_ACCOUNT": value for key, value in DEMO_ACCOUNTS.items()},
            "TESTNET_DEMO_PASSWORD": DEMO_PASSWORD,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"missing required testnet environment: {', '.join(missing)}")

    logins = {}
    health = {}
    for node_name, base in NODES.items():
        request("GET", base + "/sub-oss/healthz")
        health[node_name] = federation_health(base)
        if not health[node_name].get("ready"):
            raise RuntimeError(f"Federation routing is not ready on {node_name}")
        logins[node_name] = login_demo_actor(node_name, base)
        print(
            f"[{node_name}] station_peer_id="
            f"{health[node_name]['station_peer_id']}"
        )

    peer_ids = [health[name]["station_peer_id"] for name in NODES]
    if any(not peer_id for peer_id in peer_ids) or len(set(peer_ids)) != 3:
        raise RuntimeError(f"Station peer IDs are not distinct: {peer_ids}")

    federation_id = create_federation(NODES["one"], logins["one"]["token"])
    for node_name in ("two", "three"):
        response = join_federation(
            NODES[node_name],
            logins[node_name]["token"],
            federation_id,
            NODES["one"],
        )
        if response.get("status") not in ("active", "pending"):
            raise RuntimeError(
                f"{node_name} join returned unexpected status: {response}"
            )

    projections = wait_for_convergence(logins, federation_id)
    head_seqs = {
        node_name: int(item["federation"].get("head_seq", 0))
        for node_name, item in projections.items()
    }
    if len(set(head_seqs.values())) != 1:
        raise RuntimeError(f"Federation heads diverged: {head_seqs}")

    report = {
        "schema_version": 1,
        "gate": GATE_ID,
        "generated_at_unix_ms": int(time.time() * 1000),
        "status": "pass",
        "federation_id": federation_id,
        "nodes": {
            node_name: {
                "base_url": NODES[node_name],
                "station_peer_id": health[node_name]["station_peer_id"],
                "routing_ready": health[node_name]["ready"],
                "member_count": int(
                    projections[node_name]["federation"].get(
                        "member_station_count",
                        0,
                    )
                ),
                "head_seq": head_seqs[node_name],
            }
            for node_name in NODES
        },
        "distinct_station_peer_ids": True,
        "access_tokens_present": False,
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if args.output is not None:
        report = run()
        output = explicit_output_path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(f"federation_e2e_ok report={output}")
        return 0

    with artifact_session(GATE_ID) as session:
        try:
            report = run()
        except Exception as error:
            session.write_json(
                REPORT_ROLE,
                {
                    "schema_version": 1,
                    "gate": GATE_ID,
                    "status": "fail",
                    "error_type": type(error).__name__,
                    "access_tokens_present": False,
                },
                role="report",
            )
            session.complete(
                status="fail",
                completion_status="PARTIAL",
                proof_status="UNPROVEN",
            )
            print(f"federation_e2e_failed: {error}", file=sys.stderr)
            return 1
        session.write_json(REPORT_ROLE, report, role="report")
        session.complete(
            status="pass",
            completion_status="DONE",
            proof_status="PROVEN",
        )
    print(f"federation_e2e_ok report={REPORT_ROLE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
