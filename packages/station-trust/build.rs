use std::path::PathBuf;

fn main() {
    let proto_root = PathBuf::from("../../model");
    let protos = [
        proto_root.join("domain/peer/station_identity.proto"),
        proto_root.join("domain/peer/access_endpoint.proto"),
    ];
    for proto in &protos {
        println!("cargo:rerun-if-changed={}", proto.display());
    }
    prost_build::compile_protos(&protos, &[proto_root])
        .expect("failed to compile Station trust contracts");
}
