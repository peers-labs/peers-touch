export function installMobileWebGuards() {
  installDoubleTapZoomGuard();
  installPinchZoomGuard();
}

function installDoubleTapZoomGuard() {
  let lastTouchEnd = 0;

  document.addEventListener(
    'touchend',
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false },
  );
}

function installPinchZoomGuard() {
  for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(
      eventName,
      (event) => {
        event.preventDefault();
      },
      { passive: false },
    );
  }
}
