import argparse
import hashlib
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from installer import Installation, version_key
from installation_state import atomic_json


class InstallerTests(unittest.TestCase):
    def installation(self, root):
        owner = object.__new__(Installation)
        owner.root = root
        owner.compose_root = root
        owner.compose_project = "station-test"
        owner.project = "station-test"
        owner.target = "unix://test|daemon"
        owner.state_file = root / "state.json"
        owner.args = argparse.Namespace(federation=False, port=19099, libp2p_port=4999,
                                        base_url="", public_addrs="", bootstrap_nodes="")
        return owner

    def test_verify_backup_accepts_complete_snapshot_and_rejects_damage(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            owner = self.installation(root)
            backup = root / "backups" / "snapshot"
            backup.mkdir(parents=True)
            files = {}
            for name in ("database.dump", "peers-data.tar", ".env", "docker-compose.yml", "state.json"):
                value = ("snapshot:" + name).encode()
                (backup / name).write_bytes(value)
                files[name] = {"sha256": hashlib.sha256(value).hexdigest(), "size": len(value)}
            manifest = {"instance": str(root), "project": owner.project, "target": owner.target, "files": files}
            atomic_json(backup / "manifest.json", manifest)
            self.assertEqual(owner.verify_backup(backup), manifest)
            (backup / "peers-data.tar").write_bytes(b"corrupt")
            with self.assertRaisesRegex(RuntimeError, "RD_BACKUP_CORRUPT"):
                owner.verify_backup(backup)
            manifest["files"].pop(".env")
            atomic_json(backup / "manifest.json", manifest)
            with self.assertRaisesRegex(RuntimeError, "RD_BACKUP_INCOMPLETE"):
                owner.verify_backup(backup)
            manifest["project"] = "other"
            atomic_json(backup / "manifest.json", manifest)
            with self.assertRaisesRegex(RuntimeError, "RD_BACKUP_IDENTITY_MISMATCH"):
                owner.verify_backup(backup)

    def test_write_environment_preserves_keys_and_rebinds_image(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            owner = self.installation(root)
            original = (
                "PEERS_AUTH_SECRET=first-key\nPEERS_DB_PASSWORD=second-key\n"
                "PEERS_DASHBOARD_USERNAME=operator\n"
                f"PEERS_DASHBOARD_PASSWORD={'a' * 64}\n"
                f"PEERS_DASHBOARD_JWT_SECRET={'b' * 64}\n"
                "STATION_PORT=19300\nPEERS_STATION_IMAGE=old\n"
            )
            owner.write_environment({"image": "new"}, ["new-pg", "new-data"], original=original)
            values = dict(line.split("=", 1) for line in (root / ".env").read_text().splitlines())
            self.assertEqual(values["PEERS_AUTH_SECRET"], "first-key")
            self.assertEqual(values["PEERS_DB_PASSWORD"], "second-key")
            self.assertEqual(values["PEERS_DASHBOARD_USERNAME"], "operator")
            self.assertEqual(values["PEERS_DASHBOARD_PASSWORD"], "a" * 64)
            self.assertEqual(values["PEERS_DASHBOARD_JWT_SECRET"], "b" * 64)
            self.assertEqual(values["STATION_PORT"], "19300")
            self.assertEqual(values["PEERS_STATION_IMAGE"], "new")
            self.assertEqual(values["PEERS_PG_VOLUME"], "new-pg")
            self.assertEqual((root / ".env").stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(RuntimeError, "RD_ENV_VALUE_INVALID"):
                owner.write_environment({"image": "bad\nINJECTED=value"}, ["pg", "data"], original=original)

    def test_write_environment_generates_independent_dashboard_credentials(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            owner = self.installation(root)
            listeners = []
            try:
                for _ in range(2):
                    listener = socket.socket()
                    listener.bind(("127.0.0.1", 0))
                    listeners.append(listener)
                owner.args.port = listeners[0].getsockname()[1]
                owner.args.libp2p_port = listeners[1].getsockname()[1]
            finally:
                for listener in listeners:
                    listener.close()
            generated = ["1" * 64, "2" * 64, "3" * 64, "4" * 64]
            with patch("installer.secrets.token_hex", side_effect=generated):
                owner.write_environment({"image": "new"}, ["new-pg", "new-data"], original="")
            values = dict(line.split("=", 1) for line in (root / ".env").read_text().splitlines())
            self.assertEqual(values["PEERS_AUTH_SECRET"], generated[0])
            self.assertEqual(values["PEERS_DB_PASSWORD"], generated[1])
            self.assertEqual(values["PEERS_DASHBOARD_USERNAME"], "peers")
            self.assertEqual(values["PEERS_DASHBOARD_PASSWORD"], generated[2])
            self.assertEqual(values["PEERS_DASHBOARD_JWT_SECRET"], generated[3])
            self.assertEqual(len(set(generated)), 4)

    def test_version_key_orders_release_and_prerelease_without_downgrade(self):
        ordered = ["v0.1.0-rc.2", "v0.1.0-rc.10", "v0.1.0", "v0.1.1", "v0.2.0", "v1.0.0"]
        self.assertEqual(sorted(ordered, key=version_key), ordered)
        for invalid in ["v01.0.0", "0.1.0", "v0.1.0-rc.01"]:
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, "RD_VERSION_INVALID"):
                version_key(invalid)

    def test_readback_uses_current_identity_and_object_schema(self):
        with tempfile.TemporaryDirectory() as raw:
            owner = self.installation(Path(raw))
            owner.state = {"volumes": ["pg", "data"]}
            statements = []

            def compose(*arguments, **_kwargs):
                statement = arguments[-1]
                if "to_regclass" in statement:
                    return "t"
                statements.append(statement)
                return "[]"

            with patch.object(owner, "compose", side_effect=compose), patch(
                "installer.run", return_value="digest  /app/data/bootstrap.key"
            ):
                result = owner.readback()
            query = "\n".join(statements)
            self.assertIn("SELECT ptid, fingerprint, public_key FROM actor_identity_keys", query)
            self.assertIn("SELECT ptid, device_id, revoked FROM actor_devices", query)
            self.assertIn("SELECT owner_ptid, key, size, sha256 FROM oss_files", query)
            self.assertNotIn("actor_ptid", query)
            self.assertIn("touch_actor", result["tables"])
            self.assertIn("oss_files", result["tables"])

    def test_preflight_failure_resumes_old_release_or_records_failed_restart(self):
        with tempfile.TemporaryDirectory() as raw:
            owner = self.installation(Path(raw))
            release = {"tag": "v1.0.0", "image": "old"}
            owner.state = {"release": release, "phase": "BACKING_UP"}
            with patch.object(owner, "compose") as compose, patch.object(owner, "healthy") as healthy:
                owner.resume_current(release, "RD_BACKUP_FAILED")
            compose.assert_called_once_with("start", "station")
            healthy.assert_called_once_with(release)
            self.assertEqual(owner.state["phase"], "HEALTHY")
            self.assertEqual(owner.state["lastError"], "RD_BACKUP_FAILED")

            owner.state = {"release": release, "phase": "BACKING_UP"}
            with patch.object(owner, "compose"), patch.object(
                owner, "healthy", side_effect=RuntimeError("still down")
            ):
                owner.resume_current(release, "RD_BACKUP_FAILED")
            self.assertEqual(owner.state["phase"], "FAILED")
            self.assertEqual(owner.state["error"], "RD_BACKUP_FAILED")

    def test_backup_failure_blocks_snapshot_and_restores_old_station(self):
        with tempfile.TemporaryDirectory() as raw:
            owner = self.installation(Path(raw))
            release = {"tag": "v1.0.0", "image": "old"}
            owner.state = {
                "release": release,
                "phase": "HEALTHY",
                "volumes": ["pg", "data"],
            }
            calls = []

            def compose(*arguments, **_kwargs):
                calls.append(arguments)
                if arguments[0] == "exec":
                    raise RuntimeError("dump failed")
                return ""

            with patch.object(owner, "compose", side_effect=compose), patch.object(owner, "healthy"):
                with self.assertRaisesRegex(RuntimeError, "dump failed"):
                    owner.backup(resume=False)
            self.assertIn(("stop", "station"), calls)
            self.assertIn(("start", "station"), calls)
            self.assertEqual(owner.state["phase"], "HEALTHY")
            self.assertEqual(owner.state["lastError"], "RD_BACKUP_FAILED")

    def test_stopped_upgraded_instance_restarts_without_discarding_rollback_metadata(self):
        with tempfile.TemporaryDirectory() as raw:
            owner = self.installation(Path(raw))
            release = {"tag": "v1.1.0", "image": "current"}
            owner.state = {
                "release": release,
                "previous": {"tag": "v1.0.0", "image": "old"},
                "attempted": release,
                "phase": "STOPPED",
            }
            with patch.object(owner, "release", return_value=release), patch.object(
                owner, "compose"
            ) as compose, patch.object(owner, "healthy"):
                owner.install()
            compose.assert_called_once_with("up", "-d")
            self.assertEqual(owner.state["phase"], "HEALTHY")
            self.assertEqual(owner.state["previous"]["tag"], "v1.0.0")
            self.assertEqual(owner.state["attempted"], release)


if __name__ == "__main__":
    unittest.main()
