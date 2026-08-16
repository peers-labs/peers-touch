from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


class BaseDriver(ABC):
    @abstractmethod
    def start(self) -> Any:
        ...

    @abstractmethod
    def stop(self) -> None:
        ...

    @abstractmethod
    def wait_for_ready(self, timeout: float) -> None:
        ...

    @abstractmethod
    def is_alive(self) -> bool:
        ...

    def __enter__(self) -> "BaseDriver":
        self.start()
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.stop()


class DomDriver(BaseDriver):
    @abstractmethod
    def execute_script(self, script: str, *args: Any) -> Any:
        ...

    @abstractmethod
    def execute_async_script(self, script: str, *args: Any) -> Any:
        ...

    @abstractmethod
    def find_element(self, selector: str, timeout: float = 10.0) -> Any:
        ...

    @abstractmethod
    def find_elements(self, selector: str) -> list[Any]:
        ...

    @abstractmethod
    def save_screenshot(self, path: str | Path) -> None:
        ...

    @abstractmethod
    def get_page_source(self) -> str:
        ...

    @abstractmethod
    def get_current_url(self) -> str:
        ...
