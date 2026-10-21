import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from installation_state import atomic_json, digest, instance_lock, private_directory


class InstallationStateTests(unittest.TestCase):
    def test_atomic_json_preserves_private_complete_state(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            file = root / "state.json"
            atomic_json(file, {"phase": "INSTALLING", "digest": "old"})
            atomic_json(file, {"phase": "HEALTHY", "digest": "new"})
            self.assertEqual(json.loads(file.read_text()), {"phase": "HEALTHY", "digest": "new"})
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(root.iterdir()), [file])
            self.assertEqual(digest(file), hashlib.sha256(file.read_bytes()).hexdigest())

    def test_private_directory_rejects_shared_permissions_and_symlink(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            shared = root / "shared"
            shared.mkdir(mode=0o755)
            shared.chmod(0o755)
            with self.assertRaisesRegex(RuntimeError, "RD_ROOT_PERMISSIONS"):
                private_directory(shared)
            link = root / "link"
            link.symlink_to(shared)
            with self.assertRaisesRegex(RuntimeError, "RD_ROOT_SYMLINK"):
                private_directory(link)
            created = private_directory(root / "private")
            self.assertEqual(created.stat().st_mode & 0o777, 0o700)

    def test_instance_lock_blocks_other_process_and_releases(self):
        # Use a unique target; the OS lock itself is exercised, never mocked.
        with tempfile.TemporaryDirectory() as raw:
            target = str(Path(raw).resolve())
            child = (
                "from installation_state import instance_lock\n"
                f"with instance_lock({target!r}, 'station-test'): pass\n"
            )
            with instance_lock(target, "station-test"):
                result = subprocess.run([sys.executable, "-c", child], cwd=Path(__file__).parent, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"RD_INSTANCE_BUSY", result.stderr)
            result = subprocess.run([sys.executable, "-c", child], cwd=Path(__file__).parent, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
