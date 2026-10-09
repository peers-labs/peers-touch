const COMMANDS: &[&str] = &["requestSecret"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build()
        .expect("failed to build the Peers secure-input plugin");
}
