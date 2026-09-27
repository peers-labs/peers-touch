#!/usr/bin/env python3
"""Deterministic source audit for the Secure Content W11 hard cut."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

CHECKER_PATH = "tooling/scripts/secure-content-hard-cut-check.py"
RESET_OWNER_PATHS = frozenset(
    {
        "apps/station/app/subserver/social/infrastructure/"
        "secure_content_reset_store.go",
        "apps/station/app/subserver/social/infrastructure/"
        "secure_content_reset_store_test.go",
        "apps/station/app/subserver/social/infrastructure/"
        "secure_content_reset_types.go",
        "tooling/development/secure_content/schema_activation.py",
    }
)
NEGATIVE_FIXTURE_MARKER = "W11_NEGATIVE_FIXTURE"

GENERATED_BINDINGS = (
    "apps/station/frame/touch/model/post.pb.go",
    "apps/station/frame/touch/model/media.pb.go",
    "apps/desktop/src/gen/proto/domain/social/post_pb.ts",
    "apps/desktop/src/gen/proto/domain/social/media_pb.ts",
    "apps/mobile/src/gen/proto/domain/social/post_pb.ts",
    "apps/mobile/src/gen/proto/domain/social/media_pb.ts",
)

SOURCE_SUFFIXES = {".go", ".rs", ".ts", ".tsx", ".proto", ".py", ".mjs"}
SKIPPED_PARTS = {"node_modules", "target", "dist", "__pycache__", ".git"}


@dataclass(frozen=True)
class Violation:
    rule: str
    path: str
    line: int
    detail: str


@dataclass(frozen=True)
class ProtoMessage:
    fields: frozenset[tuple[str, int]]
    reserved_names: frozenset[str]
    reserved_ranges: tuple[tuple[int, int], ...]


def run(root: Path, *args: str) -> bytes:
    completed = subprocess.run(
        args,
        cwd=root,
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{' '.join(args)} failed: {stderr}")
    return completed.stdout


def tracked_source_files(root: Path) -> list[Path]:
    output = run(root, "git", "ls-files", "-z")
    files: list[Path] = []
    for raw in output.split(b"\0"):
        if not raw:
            continue
        relative = raw.decode("utf-8")
        path = root / relative
        if (
            path.is_file()
            and path.suffix in SOURCE_SUFFIXES
            and not any(part in SKIPPED_PARTS for part in path.parts)
        ):
            files.append(path)
    return sorted(files)


def relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan_pattern(
    root: Path,
    files: Iterable[Path],
    *,
    rule: str,
    pattern: str,
    detail: str,
    allow_reset: bool = False,
    allow_negative_fixture: bool = False,
) -> list[Violation]:
    regex = re.compile(pattern)
    violations: list[Violation] = []
    for path in files:
        relative = relative_path(root, path)
        if relative == CHECKER_PATH:
            continue
        if allow_reset and relative in RESET_OWNER_PATHS:
            continue
        text = path.read_text(encoding="utf-8")
        if allow_negative_fixture and NEGATIVE_FIXTURE_MARKER in text:
            continue
        for match in regex.finditer(text):
            violations.append(
                Violation(
                    rule=rule,
                    path=relative,
                    line=line_number(text, match.start()),
                    detail=detail,
                )
            )
    return violations


def files_under(files: Iterable[Path], root: Path, prefixes: Iterable[str]) -> list[Path]:
    normalized = tuple(prefix.rstrip("/") + "/" for prefix in prefixes)
    return [
        path
        for path in files
        if relative_path(root, path).startswith(normalized)
    ]


def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7
        if shift > 63:
            raise ValueError("descriptor varint exceeds 64 bits")
    raise ValueError("truncated descriptor varint")


def decode_wire_message(data: bytes) -> dict[int, list[int | bytes]]:
    fields: dict[int, list[int | bytes]] = {}
    offset = 0
    while offset < len(data):
        key, offset = read_varint(data, offset)
        field_number = key >> 3
        wire_type = key & 7
        if wire_type == 0:
            value, offset = read_varint(data, offset)
        elif wire_type == 1:
            value = data[offset : offset + 8]
            offset += 8
        elif wire_type == 2:
            size, offset = read_varint(data, offset)
            value = data[offset : offset + size]
            offset += size
        elif wire_type == 5:
            value = data[offset : offset + 4]
            offset += 4
        else:
            raise ValueError(f"unsupported descriptor wire type {wire_type}")
        if offset > len(data):
            raise ValueError("truncated descriptor field")
        fields.setdefault(field_number, []).append(value)
    return fields


def text_field(fields: dict[int, list[int | bytes]], number: int) -> str:
    values = fields.get(number, [])
    if not values or not isinstance(values[0], bytes):
        return ""
    return values[0].decode("utf-8")


def int_field(fields: dict[int, list[int | bytes]], number: int) -> int:
    values = fields.get(number, [])
    if not values or not isinstance(values[0], int):
        return 0
    return values[0]


def parse_descriptor_set(data: bytes) -> tuple[dict[str, ProtoMessage], set[str]]:
    messages: dict[str, ProtoMessage] = {}
    enums: set[str] = set()

    def parse_enum(data: bytes, prefix: str) -> None:
        fields = decode_wire_message(data)
        name = text_field(fields, 1)
        if name:
            enums.add(f"{prefix}.{name}")

    def parse_message(data: bytes, prefix: str) -> None:
        fields = decode_wire_message(data)
        short_name = text_field(fields, 1)
        name = f"{prefix}.{short_name}"
        message_fields: set[tuple[str, int]] = set()
        for raw_field in fields.get(2, []):
            if not isinstance(raw_field, bytes):
                continue
            field = decode_wire_message(raw_field)
            message_fields.add((text_field(field, 1), int_field(field, 3)))
        reserved_ranges: list[tuple[int, int]] = []
        for raw_range in fields.get(9, []):
            if not isinstance(raw_range, bytes):
                continue
            reserved = decode_wire_message(raw_range)
            reserved_ranges.append((int_field(reserved, 1), int_field(reserved, 2)))
        reserved_names = frozenset(
            value.decode("utf-8")
            for value in fields.get(10, [])
            if isinstance(value, bytes)
        )
        messages[name] = ProtoMessage(
            fields=frozenset(message_fields),
            reserved_names=reserved_names,
            reserved_ranges=tuple(reserved_ranges),
        )
        for raw_enum in fields.get(4, []):
            if isinstance(raw_enum, bytes):
                parse_enum(raw_enum, name)
        for raw_nested in fields.get(3, []):
            if isinstance(raw_nested, bytes):
                parse_message(raw_nested, name)

    descriptor_set = decode_wire_message(data)
    for raw_file in descriptor_set.get(1, []):
        if not isinstance(raw_file, bytes):
            continue
        file_descriptor = decode_wire_message(raw_file)
        package = text_field(file_descriptor, 2)
        for raw_enum in file_descriptor.get(5, []):
            if isinstance(raw_enum, bytes):
                parse_enum(raw_enum, package)
        for raw_message in file_descriptor.get(4, []):
            if isinstance(raw_message, bytes):
                parse_message(raw_message, package)
    return messages, enums


def reserved_field(message: ProtoMessage, *, name: str, number: int) -> bool:
    name_reserved = name in message.reserved_names
    number_reserved = any(
        start <= number < end
        for start, end in message.reserved_ranges
    )
    return name_reserved and number_reserved


def check_proto_descriptors(root: Path) -> list[Violation]:
    with tempfile.TemporaryDirectory(prefix="secure-content-hard-cut-") as temp_dir:
        descriptor_path = Path(temp_dir) / "social.pb"
        run(
            root,
            "protoc",
            "-I",
            "model",
            "--include_imports",
            f"--descriptor_set_out={descriptor_path}",
            "model/domain/social/post.proto",
            "model/domain/social/media.proto",
        )
        messages, enums = parse_descriptor_set(descriptor_path.read_bytes())
    package = "peers_touch.model.social.v1"
    violations: list[Violation] = []

    forbidden_enums = {f"{package}.PostVisibility"}
    forbidden_messages = {f"{package}.AudienceKeyEnvelope"}
    for symbol in sorted((forbidden_enums & enums) | (forbidden_messages & messages.keys())):
        violations.append(
            Violation("proto-symbol", "model/domain/social", 1, f"retired symbol remains: {symbol}")
        )

    required_reservations = {
        f"{package}.Post": ("visibility", 4),
        f"{package}.CreatePostRequest": ("visibility", 2),
        f"{package}.UpdatePostRequest": ("visibility", 3),
        f"{package}.PostFilter": ("visibility", 2),
        f"{package}.Audience": ("key_envelopes", 5),
        f"{package}.UploadMediaRequest": ("audience_key_envelopes", 7),
        f"{package}.UploadMediaResponse": ("audience_key_envelopes", 10),
    }
    for message_name, (field_name, field_number) in required_reservations.items():
        message = messages.get(message_name)
        if message is None:
            violations.append(
                Violation("proto-message", "model/domain/social", 1, f"missing message: {message_name}")
            )
            continue
        if any(
            name == field_name or number == field_number
            for name, number in message.fields
        ):
            violations.append(
                Violation(
                    "proto-field",
                    "model/domain/social",
                    1,
                    f"{message_name} still exposes {field_name}/{field_number}",
                )
            )
        if not reserved_field(message, name=field_name, number=field_number):
            violations.append(
                Violation(
                    "proto-reservation",
                    "model/domain/social",
                    1,
                    f"{message_name} must reserve {field_name}/{field_number}",
                )
            )
    return violations


def check_generated_bindings(root: Path) -> list[Violation]:
    violations: list[Violation] = []
    forbidden = re.compile(
        r"\bPostVisibility\b|\bAudienceKeyEnvelope\b|"
        r"\baudience_key_envelopes\b|\baudienceKeyEnvelopes\b|"
        r"\bkey_envelopes\b"
    )
    for relative in GENERATED_BINDINGS:
        path = root / relative
        if not path.is_file():
            violations.append(Violation("generated-binding", relative, 1, "binding is missing"))
            continue
        text = path.read_text(encoding="utf-8")
        for match in forbidden.finditer(text):
            violations.append(
                Violation(
                    "generated-binding",
                    relative,
                    line_number(text, match.start()),
                    f"retired generated symbol remains: {match.group(0)}",
                )
            )

    for prefix in (
        "apps/desktop/src-tauri/src/model/",
        "apps/mobile/src-tauri/src/model/",
    ):
        for path in (root / prefix).glob("*.rs"):
            text = path.read_text(encoding="utf-8")
            for match in forbidden.finditer(text):
                violations.append(
                    Violation(
                        "generated-rust-binding",
                        relative_path(root, path),
                        line_number(text, match.start()),
                        f"retired generated symbol remains: {match.group(0)}",
                    )
                )
    return violations


def check_sources(root: Path, files: list[Path]) -> list[Violation]:
    violations: list[Violation] = []
    product_roots = files_under(
        files,
        root,
        (
            "apps/station/app/subserver/social",
            "apps/station/app/subserver/dashboard",
            "apps/station/frame/touch/model",
            "apps/desktop",
            "apps/mobile",
            "packages",
            "tooling/acceptance",
            "tooling/development/secure_content",
        ),
    )
    route_roots = files_under(
        files,
        root,
        ("apps/station/app/subserver/social", "apps/desktop", "apps/mobile"),
    )
    social_crypto_roots = files_under(
        files,
        root,
        (
            "apps/station/app/subserver/social",
            "apps/desktop/src-tauri/src/social",
            "apps/mobile/src-tauri/src/social",
        ),
    )
    chat_adapter_roots = files_under(
        files,
        root,
        (
            "apps/desktop/src-tauri/src/messaging",
            "apps/mobile/src-tauri/src/messaging",
        ),
    )

    violations += scan_pattern(
        root,
        route_roots,
        rule="legacy-social-route",
        pattern=r"/api/v1/social/posts(?:/|\b)",
        detail="legacy Social Post route remains",
        allow_negative_fixture=True,
    )
    violations += scan_pattern(
        root,
        product_roots,
        rule="legacy-social-symbol",
        pattern=(
            r"\bPostVisibility\b|\baudiences?FromLegacyVisibility\b|"
            r"\bAudienceKeyEnvelope\b|\bSocialPrivatePost\b|"
            r"\bSocialPrivateAudienceGrant\b|\bprivatePostRepo\b|"
            r"\bprivateCommentRepo\b"
        ),
        detail="retired Social owner or compatibility symbol remains",
        allow_reset=True,
        allow_negative_fixture=True,
    )
    violations += scan_pattern(
        root,
        product_roots,
        rule="legacy-private-column",
        pattern=r"\baudience_key_envelopes_json\b",
        detail="legacy audience-envelope column remains in production source",
        allow_reset=True,
        allow_negative_fixture=True,
    )
    violations += scan_pattern(
        root,
        social_crypto_roots,
        rule="social-local-crypto",
        pattern=(
            r"\b(?:use|import)\s+(?:aes_gcm|x25519_dalek|chacha20poly1305|hkdf)"
            r"|(?:pub\s+)?fn\s+(?:encrypt_payload|decrypt_payload|derive_payload_key)\b"
        ),
        detail="Social defines or imports a local crypto algorithm instead of Secure Content Core",
        allow_negative_fixture=True,
    )
    violations += scan_pattern(
        root,
        social_crypto_roots,
        rule="social-signaling-envelope",
        pattern=r"\bsignaling_envelope_(?:seal|open)\b|\bsignalingEnvelope(?:Seal|Open)\b",
        detail="Social still calls the standalone signaling-envelope API",
        allow_negative_fixture=True,
    )
    violations += scan_pattern(
        root,
        chat_adapter_roots,
        rule="chat-generic-crypto",
        pattern=(
            r"\buse\s+aes_gcm(?:::|\s)|\buse\s+x25519_dalek(?:::|\s)|"
            r"\buse\s+chacha20poly1305(?:::|\s)|\buse\s+hkdf(?:::|\s)|"
            r"(?:pub\s+)?fn\s+(?:encrypt_payload|decrypt_payload|derive_payload_key)\b"
        ),
        detail="Chat adapter retains a generic crypto implementation",
        allow_negative_fixture=True,
    )

    legacy_private_columns = re.compile(
        r"\b(?:text_body|attachments_json|mentions_json|link_preview_json)\b"
    )
    for path in product_roots:
        relative = relative_path(root, path)
        if relative in RESET_OWNER_PATHS:
            continue
        text = path.read_text(encoding="utf-8")
        if NEGATIVE_FIXTURE_MARKER in text:
            continue
        if "social_private_posts" not in text and "social_private_comments" not in text:
            continue
        for match in legacy_private_columns.finditer(text):
            violations.append(
                Violation(
                    "legacy-private-plaintext",
                    relative,
                    line_number(text, match.start()),
                    f"legacy private plaintext column remains: {match.group(0)}",
                )
            )
    return violations


def self_test() -> None:
    route = re.compile(r"/api/v1/social/posts(?:/|\b)")
    symbol = re.compile(r"\bPostVisibility\b")
    assert route.search('const route = "/api/v1/social/posts/:id"')
    assert not route.search('const route = "/api/v1/social/moments/:id"')
    assert symbol.search("PostVisibility")
    assert not symbol.search("defaultPostVisibility")
    assert (
        "tooling/development/secure_content/schema_activation.py"
        in RESET_OWNER_PATHS
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", dest="json_output")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    self_test()
    if args.self_test:
        print("secure-content-hard-cut-check self-test: PASS")
        return 0

    root = Path(__file__).resolve().parents[2]
    files = tracked_source_files(root)
    violations = check_proto_descriptors(root)
    violations += check_generated_bindings(root)
    violations += check_sources(root, files)
    violations = sorted(set(violations), key=lambda item: (item.path, item.line, item.rule))

    result = {
        "status": "PASS" if not violations else "FAIL",
        "trackedSourceFiles": len(files),
        "violations": [asdict(item) for item in violations],
    }
    if args.json_output:
        print(json.dumps(result, sort_keys=True))
    elif violations:
        for violation in violations:
            print(
                f"{violation.path}:{violation.line}: "
                f"{violation.rule}: {violation.detail}",
                file=sys.stderr,
            )
        print(f"secure-content hard cut: FAIL ({len(violations)} violations)", file=sys.stderr)
    else:
        print(
            "secure-content hard cut: PASS "
            f"({len(files)} tracked source files inspected)"
        )
    return 0 if not violations else 1


if __name__ == "__main__":
    raise SystemExit(main())
