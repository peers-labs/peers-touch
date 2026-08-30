use std::io::{self, Write};

fn main() {
    tauri_build::build();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    emit_build_identity(&mut output);
    emit_acceptance_harness_linker_contract(&mut output);

    let proto_root = "../../../model";
    let protos = [
        "../../../model/domain/peer/station_identity.proto",
        "../../../model/domain/actor/actor.proto",
        "../../../model/domain/auth/auth.proto",
        "../../../model/domain/access_gate/access_gate.proto",
        "../../../model/domain/oauth/mobile_oauth.proto",
    ];
    for proto in protos {
        writeln!(output, "cargo:rerun-if-changed={proto}")
            .expect("failed to emit Cargo rerun directive");
    }
    prost_build::compile_protos(&protos, &[proto_root])
        .expect("failed to compile Mobile Rust proto contracts");
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
