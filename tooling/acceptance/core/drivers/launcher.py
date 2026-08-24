from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppLaunchMetadata:
    webdriver_host: str
    webdriver_port: int
    gateway_port: int
    profile: str
    storage_root: str
    process_id: int | None = None
    log_path: Path | None = None


class AppLauncher(ABC):
    @property
    @abstractmethod
    def metadata(self) -> AppLaunchMetadata:
        ...

    @abstractmethod
    def start(self) -> AppLaunchMetadata:
        ...

    @abstractmethod
    def stop(self) -> None:
        ...

    @abstractmethod
    def is_alive(self) -> bool:
        ...
