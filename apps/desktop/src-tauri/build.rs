use std::path::PathBuf;

const EXCLUDE_PROTOS: &[&str] = &[
    "domain/social/social.proto",
];

fn main() {
    tauri_build::build();

    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let proto_root = project_root.join("model");
    let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join("model");

    std::fs::create_dir_all(&out_dir).expect("failed to create model output dir");

    let mut proto_files = Vec::new();
    collect_protos(&proto_root.join("domain"), &proto_root, &mut proto_files);

    let includes = [proto_root.as_path()];

    prost_build::Config::new()
        .out_dir(&out_dir)
        .compile_protos(&proto_files, &includes)
        .expect("failed to compile protos");
}

fn collect_protos(dir: &PathBuf, proto_root: &PathBuf, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_protos(&path, proto_root, out);
            } else if path.extension().map_or(false, |e| e == "proto") {
                let rel = path
                    .strip_prefix(proto_root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                if !EXCLUDE_PROTOS.iter().any(|ex| rel == *ex) {
                    out.push(path);
                }
            }
        }
    }
}
