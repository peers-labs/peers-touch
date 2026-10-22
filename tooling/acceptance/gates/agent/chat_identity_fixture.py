"""Agent Suite identity continuity, validated against its Station trust anchor."""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
from pathlib import Path

from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native.runtime import NativeStorageFixture
from tooling.acceptance.provisioners.remote_source_identity import reviewed_remote_transport


def resolve_chat_identity_fixture(
    profile: dict[str, str], actor_ptid: str,
) -> NativeStorageFixture:
    configured = os.environ.get("PT_AGENT_CHAT_IDENTITY_SEED_FILE", "").strip()
    if not configured:
        raise DriverError("Agent Native Suite requires its retained identity seed fixture")
    source = Path(configured).expanduser()
    if source.is_symlink() or not source.is_file():
        raise DriverError("Agent retained identity fixture source is invalid")
    seed_text = source.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{64}", seed_text):
        raise DriverError("Agent retained identity fixture is not an Ed25519 seed")
    # RFC 8410 private-key DER; OpenSSL derives public material without exposing seed bytes.
    derived = subprocess.run(
        ["openssl", "pkey", "-inform", "DER", "-pubout", "-outform", "DER"],
        input=bytes.fromhex("302e020100300506032b657004220420") + bytes.fromhex(seed_text),
        capture_output=True, timeout=15,
    )
    public_prefix = bytes.fromhex("302a300506032b6570032100")
    if derived.returncode or not derived.stdout.startswith(public_prefix):
        raise DriverError("Agent retained identity public-key derivation failed")
    public_key = derived.stdout[len(public_prefix):]
    if len(public_key) != 32 or not actor_ptid.startswith("ptid:"):
        raise DriverError("Agent retained identity fixture scope is invalid")
    transport, deployment = reviewed_remote_transport(profile["PT_STATION_DEPLOY_ENV"])
    project = deployment.get("PT_ACCEPTANCE_COMPOSE_PROJECT", "")
    if deployment.get("PT_ACCEPTANCE_DISPOSABLE") != "1" or not re.fullmatch(
        r"[a-z0-9][a-z0-9_-]*", project,
    ):
        raise DriverError("Agent identity fixture requires its disposable Station")
    ptid_literal = "'" + actor_ptid.replace("'", "''") + "'"
    observed = transport.run_argv(
        [
            "docker", "exec", "-i", f"{project}-postgres-1",
            "sh", "-c", 'exec psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
        ],
        input_text=(
            "SELECT encode(public_key,'hex') || '|' || encode(fingerprint,'hex') "
            f"FROM actor_identity_keys WHERE ptid={ptid_literal};\n"
        ),
        timeout=30, check=True,
    ).stdout.strip()
    expected = public_key.hex() + "|" + hashlib.sha256(public_key).hexdigest()
    if observed != expected:
        raise DriverError("Agent identity fixture does not match Station identity continuity")
    actor_scope = re.sub(r"[^A-Za-z0-9_.-]", "_", actor_ptid.strip())
    home_scope = "actor_home_" + hashlib.sha256(actor_ptid.strip().encode()).hexdigest()[:24]
    filename = hashlib.sha256(f"{home_scope}/{actor_scope}".encode()).hexdigest()
    return NativeStorageFixture(
        source=source,
        relative_path=f"peers-touch/desktop/data/secure-store/identity-keys/{filename}",
        sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    )
