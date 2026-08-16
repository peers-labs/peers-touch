from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from .._paths import REPO_ROOT


class BaseFixture(ABC):

    def __init__(self) -> None:
        self.repo_root: Path = REPO_ROOT

    @abstractmethod
    def setup(self) -> None:
        ...

    @abstractmethod
    def teardown(self) -> None:
        ...

    def reset(self) -> None:
        self.teardown()
        self.setup()
