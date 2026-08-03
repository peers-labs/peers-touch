#!/usr/bin/env python3
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


NODES = {
    "one": os.environ.get("TESTNET_NODE_ONE_BASE", "http://10.37.246.80:18080"),
    "two": os.environ.get("TESTNET_NODE_TWO_BASE", "http://10.37.118.48:18080"),
    "three": os.environ.get("TESTNET_NODE_THREE_BASE", "http://10.37.94.156:18080"),
}
REPORT_PATH = Path(
    os.environ.get(
        "TESTNET_FEDERATION_REPORT",
        "tooling/acceptance/reports/testnet-p5-federation-e2e.json",
    )
)


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


def signup_and_login(node_name, base):
    suffix = str(int(time.time() * 1000)) + secrets.token_hex(3)
    name = f"c6{node_name}{suffix}"[:20]
    email = f"{name}@testnet.local"
    password = "C6TopologyAa1!"
    request(
        "POST",
        base + "/actor/sign-up",
        {"name": name, "email": email, "password": password},
    )
    body = unwrap(
        request(
            "POST",
            base + "/actor/login",
            {"email": email, "password": password, "device_type": "desktop"},
        )
    )
    return {
        "token": body["tokens"]["access_token"],
        "ptid": body["actor_ref"]["ptid"],
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
    logins = {}
    health = {}
    for node_name, base in NODES.items():
        request("GET", base + "/sub-oss/healthz")
        health[node_name] = federation_health(base)
        if not health[node_name].get("ready"):
            raise RuntimeError(f"Federation routing is not ready on {node_name}")
        logins[node_name] = signup_and_login(node_name, base)
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
        "gate": "testnet-p5-federation-e2e",
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
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(f"federation_e2e_ok report={REPORT_PATH}")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        print(f"federation_e2e_failed: {error}", file=sys.stderr)
        sys.exit(1)
