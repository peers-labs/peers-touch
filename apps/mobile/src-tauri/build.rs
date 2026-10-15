use std::io::{self, Write};

fn main() {
    tauri_build::build();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    emit_build_identity(&mut output);
    emit_acceptance_harness_linker_contract(&mut output);
    write_native_resource_manifest();

    let proto_root = "../../../model";
    let protos = [
        "../../../model/domain/activity/activity.proto",
        "../../../model/domain/peer/station_identity.proto",
        "../../../model/domain/activity/activity.proto",
        "../../../model/domain/common/common.proto",
        "../../../model/domain/actor/actor.proto",
        "../../../model/domain/auth/auth.proto",
        "../../../model/domain/access_gate/access_gate.proto",
        "../../../model/domain/common/common.proto",
        "../../../model/domain/error/error.proto",
        "../../../model/domain/federation/federation_resolve.proto",
        "../../../model/domain/federation/federation_projection_service.proto",
        "../../../model/domain/federation/delivery.proto",
        "../../../model/domain/federation/profile.proto",
        "../../../model/domain/key_exchange/key_exchange.proto",
        "../../../model/domain/oauth/mobile_oauth.proto",
        "../../../model/domain/notification/notification.proto",
        "../../../model/domain/secure_content/content.proto",
        "../../../model/domain/secure_content/prekey.proto",
        "../../../model/domain/secure_content/object.proto",
        "../../../model/domain/social/post.proto",
        "../../../model/domain/social/comment.proto",
        "../../../model/domain/social/poll.proto",
        "../../../model/domain/social/circle.proto",
        "../../../model/domain/social/private_content.proto",
        "../../../model/domain/social/private_federation.proto",
        "../../../model/domain/social/media.proto",
        "../../../model/domain/social/relationship.proto",
        "../../../model/domain/mobile/reliability.proto",
        "../../../model/domain/mobile/security.proto",
    ];
    for proto in protos {
        writeln!(output, "cargo:rerun-if-changed={proto}")
            .expect("failed to emit Cargo rerun directive");
    }
    prost_build::compile_protos(&protos, &[proto_root])
        .expect("failed to compile Mobile Rust proto contracts");
}

fn write_native_resource_manifest() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }
    let manifest_root = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory missing"),
    );
    let target_root = std::env::var_os("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| manifest_root.join("target"));
    let target_root = if target_root.is_absolute() {
        target_root
    } else {
        manifest_root.join(target_root)
    };
    let target = std::env::var("TARGET").expect("Cargo target missing");
    let profile = std::env::var("PROFILE").expect("Cargo profile missing");
    let path = target_root
        .join(target)
        .join(profile)
        .join("mobile-native-resource-bundles");
    let mut bundles = std::env::vars()
        .filter(|(name, _)| name.starts_with("DEP_") && name.ends_with("_IOS_RESOURCE_BUNDLE"))
        .map(|(_, value)| value)
        .collect::<Vec<_>>();
    bundles.sort();
    bundles.dedup();
    assert!(
        !bundles.is_empty(),
        "iOS native resource bundle metadata missing"
    );
    for bundle in &bundles {
        assert!(
            !bundle.contains(['\r', '\n']) && std::path::Path::new(bundle).is_dir(),
            "iOS native resource bundle path invalid"
        );
    }
    std::fs::create_dir_all(
        path.parent()
            .expect("native resource manifest parent missing"),
    )
    .expect("failed to prepare native resource manifest directory");
    std::fs::write(path, bundles.join("\n")).expect("failed to write native resource manifest");
}

fn emit_build_identity(output: &mut impl Write) {
    writeln!(
        output,
        "cargo:rerun-if-env-changed=PT_MOBILE_BUILD_IDENTITY_JSON"
    )
    .expect("failed to emit Cargo environment directive");

    let identity = std::env::var("PT_MOBILE_BUILD_IDENTITY_JSON").unwrap_or_default();
    assert!(
        !identity.contains('\r') && !identity.contains('\n'),
        "Mobile build identity must be canonical single-line JSON"
    );
    writeln!(
        output,
        "cargo:rustc-env=PT_MOBILE_BUILD_IDENTITY_JSON={identity}"
    )
    .expect("failed to emit Cargo build identity");
}

fn emit_acceptance_harness_linker_contract(output: &mut impl Write) {
    writeln!(
        output,
        "cargo:rerun-if-env-changed=CARGO_FEATURE_ACCEPTANCE_HARNESS"
    )
    .expect("failed to emit Cargo feature directive");
    if std::env::var_os("CARGO_FEATURE_ACCEPTANCE_HARNESS").is_none() {
        return;
    }

    let symbols = if std::env::var("CARGO_CFG_TARGET_VENDOR").as_deref() == Ok("apple") {
        [
            "_PT_MOBILE_ACCEPTANCE_HARNESS_MARKER",
            "_PT_MOBILE_BUILD_IDENTITY_JSON",
        ]
    } else {
        [
            "PT_MOBILE_ACCEPTANCE_HARNESS_MARKER",
            "PT_MOBILE_BUILD_IDENTITY_JSON",
        ]
    };
    for symbol in symbols {
        writeln!(output, "cargo:rustc-link-arg=-Wl,-u,{symbol}")
            .expect("failed to retain Mobile Acceptance build evidence");
    }
}
