// Shared build-script helper for XCFG-D05 distribution identity.
//
// Both Desktop and Mobile `build.rs` include this file and call
// `peers_distribution_emit_env()`. Packaging sets `PT_DIST_*` in the
// environment; ordinary development builds leave them unset.

const DISTRIBUTION_VARS: &[&str] = &[
    "PT_DIST_PRODUCT",
    "PT_DIST_FLAVOR",
    "PT_DIST_CHANNEL",
    "PT_DIST_VERSION",
    "PT_DIST_BUILD_NUMBER",
    "PT_DIST_COMMIT",
    "PT_DIST_IDENTIFIER",
    "PT_DIST_REGION",
    "PT_DIST_LABELS_JSON",
];

pub fn peers_distribution_emit_env() {
    println!("cargo:rerun-if-env-changed=PT_DIST_PACKAGING");
    for name in DISTRIBUTION_VARS {
        println!("cargo:rerun-if-env-changed={name}");
        if let Ok(value) = std::env::var(name) {
            assert!(!value.contains('\r') && !value.contains('\n'), "{name} must be single-line");
            println!("cargo:rustc-env={name}={value}");
        }
    }
}
