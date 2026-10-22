use std::path::PathBuf;

fn main() {
    let proto_root = PathBuf::from("../../model");
    let proto = proto_root.join("domain/x_config/x_config.proto");
    println!("cargo:rerun-if-changed={}", proto.display());
    let mut config = prost_build::Config::new();
    config.extern_path(".peers_touch.model.peer.v1", "::station_trust::proto");
    config
        .compile_protos(&[proto], &[proto_root])
        .expect("failed to compile X Config contracts");
}
