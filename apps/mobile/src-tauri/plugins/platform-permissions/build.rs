const COMMANDS: &[&str] = &[
    "check",
    "request",
    "startNetworkObservation",
    "armPush",
    "drainPushCallbacks",
    "disarmPush",
    "scheduleReconcile",
    "drainScheduledCallbacks",
    "completeScheduledCallback",
    "pickMedia",
    "register_listener",
    "remove_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build()
        .expect("failed to build the Peers platform-permissions plugin");
}
