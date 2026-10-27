use std::path::PathBuf;

fn main() {
    let root = PathBuf::from("../../model");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut config = prost_build::Config::new();
    config.extern_path(".peers_touch.model.peer.v1", "::station_trust::proto");
    config
        .compile_protos(&[root.join("domain/schema/schema.proto")], &[root])
        .expect("failed to compile Schema contracts");
}
