from __future__ import annotations

from enum import Enum


class RemotePlatform(str, Enum):
    POSIX = "posix"
    WINDOWS = "windows"
