#!/usr/bin/env python3
"""Mechanical W1 PTID and Station identity hard-cut Gate."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
ACTOR_PROTO = REPO_ROOT / "model" / "domain" / "actor" / "actor.proto"
STATION_IDENTITY_PROTO = (
    REPO_ROOT / "model" / "domain" / "peer" / "station_identity.proto"
)
MOBILE_STATION_COMMAND = (
    REPO_ROOT / "apps" / "mobile" / "src-tauri" / "src" / "commands" / "station.rs"
)
IDENTITY_SOURCE_ROOTS = (
    REPO_ROOT / "apps" / "mobile" / "src",
    REPO_ROOT / "apps" / "mobile" / "src-tauri" / "src",
    REPO_ROOT / "apps" / "desktop" / "src",
    REPO_ROOT / "apps" / "desktop" / "src-tauri" / "src",
    REPO_ROOT / "apps" / "station",
    REPO_ROOT / "packages",
)
SOURCE_SUFFIXES = {".go", ".rs", ".ts", ".tsx"}
PROTO_NON_ACTOR_ID_ALLOWLIST = {
    Path("model/domain/applet/applet.proto"): {"owner_id"},
    Path("model/domain/oauth/oauth.proto"): {"provider_user_id"},
}
LEGACY_MIGRATION_ALLOWLIST = {
    Path("apps/station/frame/touch/model/db/automigrate.go"): {
        "did",
        "actor_did",
        "member_did",
        "sender_did",
    },
    Path("apps/station/frame/touch/model/db/automigrate_identity_test.go"): {
        "actor_did",
        "member_did",
        "sender_did",
    },
    Path(
        "apps/station/app/subserver/presence/infrastructure/repo.go"
    ): {
        "actor_did",
        "participant_a_did",
        "participant_b_did",
    },
    Path(
        "apps/station/app/subserver/presence/infrastructure/"
        "identity_column_migration_test.go"
    ): {
        "actor_did",
        "member_did",
    },
    Path(
        "apps/station/app/subserver/presence/infrastructure/repo_test.go"
    ): {
        "actor_did",
        "participant_a_did",
        "participant_b_did",
    },
    Path(
        "apps/station/app/subserver/envelope/infrastructure/repo.go"
    ): {
        "recipient_did",
    },
    Path(
        "apps/station/app/subserver/envelope/infrastructure/repo_test.go"
    ): {
        "recipient_did",
    },
    Path("apps/station/app/subserver/conversation/subserver.go"): {
        "actor_did",
    },
    Path(
        "apps/station/app/subserver/key_exchange/infrastructure/repo.go"
    ): {
        "actor_did",
    },
    Path(
        "apps/station/app/subserver/key_exchange/infrastructure/repo_test.go"
    ): {
        "actor_did",
        "ActorDID",
    },
    Path(
        "apps/station/app/subserver/social/infrastructure/identity_migration.go"
    ): {
        "actor_did",
        "member_did",
        "sender_did",
        "receiver_did",
        "peer_did",
    },
    Path(
        "apps/station/app/subserver/social/infrastructure/"
        "identity_migration_test.go"
    ): {
        "actor_did",
        "member_did",
        "sender_did",
        "receiver_did",
        "peer_did",
    },
}
FORBIDDEN_DID_ALIAS = re.compile(
    r"\b(?:actor|subject|sender|receiver|participant_[ab]|participant|target|"
    r"owner|inviter|invitee|next_owner|member|mentioned|uploader|author|reader|"
    r"current_user|peer)_dids?\b|"
    r"\b(?:actor|subject|sender|receiver|participantA|participantB|participant|"
    r"target|owner|inviter|invitee|nextOwner|member|mentioned|uploader|author|"
    r"reader|currentUser|peer)Dids?\b",
    re.IGNORECASE,
)


def fail(message: str) -> int:
    sys.stderr.write(f"mobile identity contract failed: {message}\n")
    return 1


def main() -> int:
    actor_proto = ACTOR_PROTO.read_text(encoding="utf-8")
    actor_ref = re.search(
        r"message ActorRef \{(?P<body>.*?)\n\}",
        actor_proto,
        re.DOTALL,
    )
    if actor_ref is None:
        return fail("ActorRef is missing")
    body = actor_ref.group("body")
    if "reserved 1;" not in body or 'reserved "actor_id";' not in body:
        return fail("ActorRef must reserve former actor_id field 1")
    if re.search(r"\bactor_id\b\s*=", body):
        return fail("ActorRef still exposes actor_id")
    if not re.search(r"\bstring\s+ptid\s*=\s*2\s*;", body):
        return fail("ActorRef.ptid field 2 is missing")

    forbidden_proto_fields: list[str] = []
    for path in sorted((REPO_ROOT / "model" / "domain").rglob("*.proto")):
        relative = path.relative_to(REPO_ROOT)
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(),
            start=1,
        ):
            identity_id = re.search(
                r"\b(?:u?int(?:32|64)|string)\s+"
                r"([a-z_]*(?:actor|user|sender|recipient|owner|author|"
                r"member|mentioned|participant|subject|receiver|inviter|"
                r"invitee|uploader|reader)_ids?)\b",
                line,
            )
            if identity_id and identity_id.group(1) not in (
                PROTO_NON_ACTOR_ID_ALLOWLIST.get(relative, set())
            ):
                forbidden_proto_fields.append(f"{relative}:{line_number}")
            elif re.search(
                r"\b(?:string|repeated\s+string)\s+[a-z_]*_dids?\b",
                line,
            ) or re.search(
                r"\b(?:string|repeated\s+string)\s+dids?\b",
                line,
            ):
                forbidden_proto_fields.append(f"{relative}:{line_number}")
    if forbidden_proto_fields:
        return fail(
            "public actor_id fields remain: "
            + ", ".join(forbidden_proto_fields)
        )

    forbidden_source_aliases: list[str] = []
    for root in IDENTITY_SOURCE_ROOTS:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            relative = path.relative_to(REPO_ROOT)
            if "target" in relative.parts or "dist" in relative.parts:
                continue
            if path.name.endswith(".pb.go") or path.name.endswith("_pb.ts"):
                continue
            if relative.parts[:5] == (
                "apps",
                "desktop",
                "src-tauri",
                "src",
                "model",
            ):
                continue
            for line_number, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(),
                start=1,
            ):
                if FORBIDDEN_DID_ALIAS.search(line):
                    allowed_tokens = LEGACY_MIGRATION_ALLOWLIST.get(relative, set())
                    if any(f'"{token}"' in line or token in line for token in allowed_tokens):
                        continue
                    forbidden_source_aliases.append(
                        f"{relative}:{line_number}"
                    )
    if forbidden_source_aliases:
        sample = forbidden_source_aliases[:50]
        remaining = len(forbidden_source_aliases) - len(sample)
        suffix = f" (+{remaining} more)" if remaining else ""
        return fail(
            "non-canonical DID actor aliases remain: "
            + ", ".join(sample)
            + suffix
        )

    identity_proto = STATION_IDENTITY_PROTO.read_text(encoding="utf-8")
    required_tokens = (
        "message StationIdentityRequest",
        "bytes challenge = 1;",
        "message StationIdentityStatement",
        "string station_peer_id = 2;",
        "string canonical_origin = 3;",
        "repeated string capabilities = 4;",
        "int64 issued_at_unix_ms = 5;",
        "int64 expires_at_unix_ms = 6;",
        "message StationIdentityResponse",
        "bytes statement_bytes = 1;",
        "bytes host_public_key = 2;",
        "bytes signature = 3;",
    )
    missing_tokens = [
        token for token in required_tokens if token not in identity_proto
    ]
    if missing_tokens:
        return fail(
            "Station identity Proto is incomplete: "
            + ", ".join(missing_tokens)
        )

    station_command = MOBILE_STATION_COMMAND.read_text(encoding="utf-8")
    verifier_tokens = (
        "PublicKey::try_decode_protobuf",
        "public_key.to_peer_id()",
        "public_key.verify",
        "STATION_IDENTITY_CHALLENGE_SIZE",
        "STATION_IDENTITY_MAX_LIFETIME_MS",
        "STATION_IDENTITY_CLOCK_SKEW_MS",
        "capabilities.binary_search",
    )
    missing_verifier_tokens = [
        token for token in verifier_tokens if token not in station_command
    ]
    if missing_verifier_tokens:
        return fail(
            "Mobile Rust Station verifier is incomplete: "
            + ", ".join(missing_verifier_tokens)
        )

    sys.stdout.write("mobile identity contract: PASS\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
