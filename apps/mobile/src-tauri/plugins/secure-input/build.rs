const COMMANDS: &[&str] = &["requestSecret"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build()
        .expect("failed to build the Peers secure-input plugin");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        let target = std::env::var("TARGET").expect("Cargo target missing");
        let simulator = target.ends_with("-sim") || target.starts_with("x86_64");
        let profile = if std::env::var("PROFILE").as_deref() == Ok("release") {
            "Release"
        } else {
            "Debug"
        };
        let sdk = if simulator {
            "iphonesimulator"
        } else {
            "iphoneos"
        };
        let bundle =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output missing"))
                .join(format!(
                    "swift-rs/tauri-plugin-peers-secure-input/out/Products/{profile}-{sdk}/\
                 tauri-plugin-peers-secure-input_tauri-plugin-peers-secure-input.bundle"
                ));
        assert!(
            bundle.is_dir(),
            "native secure-input resource bundle missing"
        );
        use std::io::Write;
        writeln!(
            std::io::stdout(),
            "cargo:ios_resource_bundle={}",
            bundle.display()
        )
        .expect("failed to emit native bundle metadata");
    }
}
