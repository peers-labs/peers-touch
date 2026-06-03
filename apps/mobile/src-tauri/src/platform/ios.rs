use serde::Serialize;

#[derive(Clone)]
pub struct MobilePlatform {
    shell: &'static str,
    kernel: &'static str,
}

#[derive(Serialize)]
pub struct MobileHealth {
    shell: &'static str,
    platform: &'static str,
    kernel: &'static str,
}

impl MobilePlatform {
    pub fn ios_first() -> Self {
        Self {
            shell: "tauri-mobile-ios",
            kernel: "rust-capability-kernel",
        }
    }

    pub fn health(&self) -> MobileHealth {
        MobileHealth {
            shell: self.shell,
            platform: std::env::consts::OS,
            kernel: self.kernel,
        }
    }
}
