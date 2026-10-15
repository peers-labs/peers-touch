from __future__ import annotations

import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.provisioners.preset_actor import (
    actor_identity_fixture_root,
    actor_identity_key_name,
    ensure_preset_actor_identity_fixture,
)


STATION_PEER_ID = "12D3KooWStationOne"
ACTOR_PTID = "ptid:v1:actor:peers:p:alice"
FINGERPRINT = "a" * 64


class PresetActorIdentityFixtureTests(unittest.TestCase):
    @staticmethod
    def _source(root: Path, *, mode: int = 0o600) -> Path:
        source = (
            root
            / "import"
            / actor_identity_key_name(STATION_PEER_ID, ACTOR_PTID)
        )
        source.parent.mkdir(parents=True)
        source.write_text("01" * 32, encoding="ascii")
        source.chmod(mode)
        return source

    def test_fixture_scope_uses_station_and_actor_digest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            machine_root = Path(directory) / "fixtures"
            identity_root = actor_identity_fixture_root(
                STATION_PEER_ID,
                ACTOR_PTID,
                machine_root=machine_root,
            )

        self.assertEqual(
            identity_root.parents[2].name,
            STATION_PEER_ID,
        )
        self.assertEqual(identity_root.parent.parent.name, "actors")
        self.assertEqual(len(identity_root.parent.name), 64)
        self.assertNotIn("ptid:", str(identity_root))

    def test_fixture_migrates_once_and_reuses_private_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            machine_root = root / "fixtures"
            source = self._source(root)
            with patch(
                "tooling.acceptance.provisioners.preset_actor."
                "_seed_fingerprint",
                return_value=FINGERPRINT,
            ):
                fixture = ensure_preset_actor_identity_fixture(
                    role="alice",
                    station_peer_id=STATION_PEER_ID,
                    actor_ptid=ACTOR_PTID,
                    actor_identity_fingerprint=FINGERPRINT,
                    machine_root=machine_root,
                    migration_source=source,
                )
                reused = ensure_preset_actor_identity_fixture(
                    role="alice",
                    station_peer_id=STATION_PEER_ID,
                    actor_ptid=ACTOR_PTID,
                    actor_identity_fingerprint=FINGERPRINT,
                    machine_root=machine_root,
                )

            identity_root = Path(fixture.root)
            key_root = (
                identity_root
                / "peers-touch"
                / "desktop"
                / "data"
                / "secure-store"
                / "identity-keys"
            )
            key = key_root / actor_identity_key_name(
                STATION_PEER_ID,
                ACTOR_PTID,
            )
            self.assertEqual(reused, fixture)
            self.assertEqual(key.read_text(encoding="ascii"), "01" * 32)
            self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
            for path in (
                identity_root.parent,
                *(
                    item
                    for item in identity_root.parent.rglob("*")
                    if item.is_dir()
                ),
            ):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
            self.assertEqual(fixture.lifecycle, "machine-retained")
            self.assertEqual(len(fixture.scope_digest), 64)

    def test_fixture_rejects_ambiguous_key_set(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            machine_root = root / "fixtures"
            source = self._source(root)
            with patch(
                "tooling.acceptance.provisioners.preset_actor."
                "_seed_fingerprint",
                return_value=FINGERPRINT,
            ):
                fixture = ensure_preset_actor_identity_fixture(
                    role="alice",
                    station_peer_id=STATION_PEER_ID,
                    actor_ptid=ACTOR_PTID,
                    actor_identity_fingerprint=FINGERPRINT,
                    machine_root=machine_root,
                    migration_source=source,
                )
                extra = (
                    Path(fixture.root)
                    / "peers-touch"
                    / "desktop"
                    / "data"
                    / "secure-store"
                    / "identity-keys"
                    / ("b" * 64)
                )
                extra.write_text("02" * 32, encoding="ascii")
                extra.chmod(0o600)

                with self.assertRaisesRegex(
                    BlockedError,
                    "unexpected files",
                ):
                    ensure_preset_actor_identity_fixture(
                        role="alice",
                        station_peer_id=STATION_PEER_ID,
                        actor_ptid=ACTOR_PTID,
                        actor_identity_fingerprint=FINGERPRINT,
                        machine_root=machine_root,
                    )

    def test_fixture_rejects_station_fingerprint_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._source(root)
            with patch(
                "tooling.acceptance.provisioners.preset_actor."
                "_seed_fingerprint",
                return_value="b" * 64,
            ), self.assertRaisesRegex(
                BlockedError,
                "does not match Station authority",
            ):
                ensure_preset_actor_identity_fixture(
                    role="alice",
                    station_peer_id=STATION_PEER_ID,
                    actor_ptid=ACTOR_PTID,
                    actor_identity_fingerprint=FINGERPRINT,
                    machine_root=root / "fixtures",
                    migration_source=source,
                )

    def test_fixture_rejects_symlink_and_non_private_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected_name = actor_identity_key_name(
                STATION_PEER_ID,
                ACTOR_PTID,
            )
            real_source = root / "real-source"
            real_source.write_text("01" * 32, encoding="ascii")
            real_source.chmod(0o600)
            symlink_source = root / "import" / expected_name
            symlink_source.parent.mkdir()
            symlink_source.symlink_to(real_source)
            with patch(
                "tooling.acceptance.provisioners.preset_actor.shutil.which",
                return_value="/usr/bin/openssl",
            ), self.assertRaisesRegex(
                BlockedError,
                "regular non-symlink",
            ):
                ensure_preset_actor_identity_fixture(
                    role="alice",
                    station_peer_id=STATION_PEER_ID,
                    actor_ptid=ACTOR_PTID,
                    actor_identity_fingerprint=FINGERPRINT,
                    machine_root=root / "fixtures-symlink",
                    migration_source=symlink_source,
                )

            private_source = self._source(root / "mode", mode=0o644)
            with patch(
                "tooling.acceptance.provisioners.preset_actor.shutil.which",
                return_value="/usr/bin/openssl",
            ), self.assertRaisesRegex(BlockedError, "mode 0600"):
                ensure_preset_actor_identity_fixture(
                    role="alice",
                    station_peer_id=STATION_PEER_ID,
                    actor_ptid=ACTOR_PTID,
                    actor_identity_fingerprint=FINGERPRINT,
                    machine_root=root / "fixtures-mode",
                    migration_source=private_source,
                )

    def test_fixture_rejects_unscoped_station_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(BlockedError, "scope is invalid"):
                actor_identity_fixture_root(
                    "station/peer",
                    ACTOR_PTID,
                    machine_root=Path(directory),
                )


if __name__ == "__main__":
    unittest.main()
