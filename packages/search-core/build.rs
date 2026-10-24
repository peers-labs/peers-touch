fn main() {
    let root = std::path::PathBuf::from("../../model");
    let proto = root.join("domain/search/search.proto");
    println!("cargo:rerun-if-changed={}", proto.display());
    prost_build::Config::new()
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&[proto], &[root])
        .expect("compile canonical Search protobuf");
}
