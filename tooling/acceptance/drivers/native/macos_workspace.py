"""Read NSWorkspace's current frontmost PID through typed Objective-C calls."""

from __future__ import annotations

import ctypes


_APPKIT = ctypes.CDLL("/System/Library/Frameworks/AppKit.framework/AppKit")
_OBJC = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
_REF = ctypes.c_void_p
_OBJC.objc_getClass.argtypes = [ctypes.c_char_p]
_OBJC.objc_getClass.restype = _REF
_OBJC.sel_registerName.argtypes = [ctypes.c_char_p]
_OBJC.sel_registerName.restype = _REF
_OBJC.objc_autoreleasePoolPush.argtypes = []
_OBJC.objc_autoreleasePoolPush.restype = _REF
_OBJC.objc_autoreleasePoolPop.argtypes = [_REF]
_OBJC.objc_autoreleasePoolPop.restype = None
_SEND_REF = ctypes.CFUNCTYPE(_REF, _REF, _REF)(
    ctypes.cast(_OBJC.objc_msgSend, _REF).value,
)
_SEND_PID = ctypes.CFUNCTYPE(ctypes.c_int32, _REF, _REF)(
    ctypes.cast(_OBJC.objc_msgSend, _REF).value,
)
_WORKSPACE = _OBJC.objc_getClass(b"NSWorkspace")
_SHARED = _OBJC.sel_registerName(b"sharedWorkspace")
_FRONTMOST = _OBJC.sel_registerName(b"frontmostApplication")
_PROCESS_ID = _OBJC.sel_registerName(b"processIdentifier")


def frontmost_pid() -> int:
    """Query fresh OS state; retain no application or observation between calls."""
    pool = _OBJC.objc_autoreleasePoolPush()
    try:
        if not _WORKSPACE:
            raise RuntimeError("NSWorkspace class is unavailable")
        workspace = _SEND_REF(_WORKSPACE, _SHARED)
        if not workspace:
            raise RuntimeError("NSWorkspace shared instance is unavailable")
        application = _SEND_REF(workspace, _FRONTMOST)
        return int(_SEND_PID(application, _PROCESS_ID)) if application else -1
    finally:
        _OBJC.objc_autoreleasePoolPop(pool)
