export function installMobileWebGuards() {
  installPinchZoomGuard();
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
