use crate::infrastructure::storage::{self, StorageKind};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

use crate::model;

const MAX_ZIP_BYTES: usize = 512 * 1024;
const MAX_PACKAGE_FILES: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PackageFile {
    pub path: String,
    pub content: Vec<u8>,
    pub kind: model::agent::SkillResourceKind,
    pub owner: model::agent::ToolExecutionOwner,
}

#[derive(Debug, Clone)]
pub(crate) struct ExtractedSkillPackage {
    pub name: String,
    pub skill_content: String,
    pub files: Vec<PackageFile>,
}

fn invalid(message: impl Into<String>) -> String {
    message.into()
}

fn normalized_relative_path(raw: &str) -> Option<String> {
    // ZIP entries and managed package paths use '/' by spec. A backslash is
    // either a Windows separator or a traversal spoof; reject it on every
    // platform instead of relying on the host OS path parser.
    if raw.contains('\\') {
        return None;
    }
    let path = Path::new(raw);
    if path.is_absolute() {
        return None;
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let value = part.to_str()?;
                if value == "." || value == ".." || value.is_empty() {
                    return None;
                }
                parts.push(value);
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

fn is_skill_entry(path: &str) -> bool {
    path.eq_ignore_ascii_case("SKILL.md") || path.ends_with("/SKILL.md")
}

fn resource_kind_and_owner(
    path: &str,
    content: &[u8],
) -> (
    model::agent::SkillResourceKind,
    model::agent::ToolExecutionOwner,
) {
    let lower = path.to_ascii_lowercase();
    let is_script = lower.starts_with("scripts/")
        || matches!(
            Path::new(&lower).extension().and_then(|ext| ext.to_str()),
            Some("sh" | "bash" | "zsh" | "py" | "js" | "ts")
        );
    if is_script {
        return (
            model::agent::SkillResourceKind::Script,
            model::agent::ToolExecutionOwner::ClientCapability,
        );
    }

    let is_asset = matches!(
        Path::new(&lower).extension().and_then(|ext| ext.to_str()),
        Some(
            "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "svg"
                | "ico"
                | "pdf"
                | "zip"
                | "tar"
                | "gz"
                | "wasm"
                | "bin"
        )
    ) || std::str::from_utf8(content).is_err();
    if is_asset {
        return (
            model::agent::SkillResourceKind::Asset,
            model::agent::ToolExecutionOwner::ClientCapability,
        );
    }

    if lower.starts_with("templates/") {
        return (
            model::agent::SkillResourceKind::Template,
            model::agent::ToolExecutionOwner::Station,
        );
    }

    (
        model::agent::SkillResourceKind::Reference,
        model::agent::ToolExecutionOwner::Station,
    )
}

fn fallback_package_name(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.trim_end_matches(".md")
        .trim_end_matches(".SKILL")
        .trim_end_matches(".skill")
        .replace(['_', '-'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn extract_skill_zip(bytes: &[u8]) -> Result<ExtractedSkillPackage, String> {
    if bytes.len() > MAX_ZIP_BYTES {
        return Err(invalid("ZIP package exceeds 512 KiB"));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| invalid(format!("invalid ZIP package: {error}")))?;
    if archive.len() > MAX_PACKAGE_FILES {
        return Err(invalid("ZIP package contains too many files"));
    }

    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| invalid(format!("failed to read ZIP entry: {error}")))?;
        if file.is_dir() || file.is_symlink() {
            continue;
        }
        let entry_label = file.name().to_string();
        let path = file
            .enclosed_name()
            .map(|path| path.to_path_buf())
            .and_then(|path| path.into_os_string().into_string().ok())
            .and_then(|raw| normalized_relative_path(&raw))
            .ok_or_else(|| invalid(format!("unsafe ZIP entry path: {entry_label}")))?;
        if path.starts_with('.') || path.contains("/.") {
            return Err(invalid(format!(
                "hidden ZIP entries are not allowed: {path}"
            )));
        }
        let mut content = Vec::with_capacity(usize::try_from(file.size()).unwrap_or(0));
        file.read_to_end(&mut content)
            .map_err(|error| invalid(format!("failed to read ZIP entry {path}: {error}")))?;
        if content.len() > 64 * 1024 {
            return Err(invalid(format!("ZIP entry exceeds 64 KiB: {path}")));
        }
        entries.push((path, content));
    }

    let (skill_path, skill_content_bytes) = entries
        .iter()
        .find(|(path, _)| is_skill_entry(path))
        .cloned()
        .ok_or_else(|| invalid("ZIP package must contain SKILL.md"))?;
    let skill_content = String::from_utf8(skill_content_bytes)
        .map_err(|_| invalid("SKILL.md must be valid UTF-8"))?;
    let root_prefix = match skill_path.rsplit_once('/') {
        Some((root, _)) => format!("{root}/"),
        None => String::new(),
    };
    let name = if let Some(root) = root_prefix.strip_suffix('/') {
        fallback_package_name(root.rsplit('/').next().unwrap_or(root))
    } else {
        fallback_package_name(&skill_path)
    };

    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    let mut total: usize = 0;
    for (path, content) in entries {
        let relative = match path.strip_prefix(&root_prefix) {
            Some(value) => value.to_string(),
            None => continue,
        };
        if relative.eq_ignore_ascii_case("SKILL.md") {
            continue;
        }
        let normalized = normalized_relative_path(&relative)
            .ok_or_else(|| invalid(format!("unsafe packaged resource path: {relative}")))?;
        if !seen.insert(normalized.clone()) {
            return Err(invalid(format!(
                "duplicate packaged resource: {normalized}"
            )));
        }
        total += content.len();
        if total > 256 * 1024 {
            return Err(invalid("Skill package resources exceed 256 KiB"));
        }
        let (kind, owner) = resource_kind_and_owner(&normalized, &content);
        files.push(PackageFile {
            path: normalized,
            content,
            kind,
            owner,
        });
    }

    Ok(ExtractedSkillPackage {
        name,
        skill_content,
        files,
    })
}

pub(crate) fn station_resource_inputs(
    files: &[PackageFile],
) -> Vec<model::agent::SkillResourceInput> {
    files
        .iter()
        .map(|file| model::agent::SkillResourceInput {
            path: file.path.clone(),
            content: file.content.clone(),
            kind: file.kind as i32,
            execution_owner: file.owner as i32,
        })
        .collect()
}

pub(crate) fn materialize_managed_package(
    skill_id: &str,
    version: i64,
    files: &[PackageFile],
    skill_content: &str,
) -> Result<PathBuf, String> {
    if skill_id.trim().is_empty() || version <= 0 {
        return Err("invalid managed Skill identity".to_string());
    }
    let safe_id = normalized_relative_path(skill_id)
        .filter(|value| !value.contains('/'))
        .ok_or_else(|| "invalid managed Skill id".to_string())?;
    let target = storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["managed-skills", &safe_id, &version.to_string()],
    )
    .map_err(|error| format!("resolve managed Skill directory: {error}"))?;
    materialize_managed_package_at_root(&target, files, skill_content)
}

pub(crate) fn delete_managed_package(skill_id: &str) -> Result<bool, String> {
    let safe_id = normalized_relative_path(skill_id)
        .filter(|value| !value.contains('/'))
        .ok_or_else(|| "invalid managed Skill id".to_string())?;
    let root = storage::app_file_path("desktop", StorageKind::Data, &["managed-skills", &safe_id])
        .map_err(|error| format!("resolve managed Skill directory: {error}"))?;
    if !root.exists() {
        return Ok(false);
    }
    set_tree_writable(&root)?;
    fs::remove_dir_all(&root)
        .map(|_| true)
        .map_err(|error| format!("delete managed Skill package: {error}"))
}

pub(crate) fn promote_managed_package(
    skill_id: &str,
    new_version: i64,
    skill_content: &str,
) -> Result<bool, String> {
    if new_version <= 1 {
        return Ok(false);
    }
    let safe_id = normalized_relative_path(skill_id)
        .filter(|value| !value.contains('/'))
        .ok_or_else(|| "invalid managed Skill id".to_string())?;
    let data_root =
        storage::app_file_path("desktop", StorageKind::Data, &["managed-skills", &safe_id])
            .map_err(|error| format!("resolve managed Skill directory: {error}"))?;
    let previous = data_root.join((new_version - 1).to_string());
    if !previous.is_dir() {
        return Ok(false);
    }
    let target = data_root.join(new_version.to_string());
    let mut files = Vec::new();
    collect_existing_files(&previous, &previous, &mut files)?;
    materialize_managed_package_at_root(&target, &files, skill_content)?;
    Ok(true)
}

pub(crate) fn read_managed_resource(
    skill_id: &str,
    version: i64,
    relative: &str,
    expected_sha256: Option<&str>,
) -> Result<Vec<u8>, String> {
    let safe_id = normalized_relative_path(skill_id)
        .filter(|value| !value.contains('/'))
        .ok_or_else(|| "invalid managed Skill id".to_string())?;
    let target = storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["managed-skills", &safe_id, &version.to_string()],
    )
    .map_err(|error| format!("resolve managed Skill directory: {error}"))?;
    read_managed_resource_at_root(&target, relative, expected_sha256)
}

fn materialize_managed_package_at_root(
    target: &Path,
    files: &[PackageFile],
    skill_content: &str,
) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "managed Skill directory has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("create managed Skill parent: {error}"))?;
    if target.exists() {
        set_tree_writable(&target)?;
        fs::remove_dir_all(&target)
            .map_err(|error| format!("replace managed Skill directory: {error}"))?;
    }
    let staging_nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let staging = parent.join(format!(
        ".staging-{}-{}-{staging_nonce}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0),
    ));
    if staging.exists() {
        set_tree_writable(&staging)?;
        fs::remove_dir_all(&staging)
            .map_err(|error| format!("remove stale managed Skill staging directory: {error}"))?;
    }
    fs::create_dir_all(&staging)
        .map_err(|error| format!("create managed Skill staging directory: {error}"))?;

    let write_file = |relative: &str, content: &[u8]| -> Result<(), String> {
        let normalized = normalized_relative_path(relative)
            .ok_or_else(|| format!("unsafe managed Skill file path: {relative}"))?;
        let path = staging.join(&normalized);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create managed resource directory: {error}"))?;
        }
        fs::write(&path, content)
            .map_err(|error| format!("write managed Skill file {normalized}: {error}"))?;
        set_readonly(&path, false)?;
        Ok(())
    };

    write_file("SKILL.md", skill_content.as_bytes())?;
    for file in files {
        write_file(&file.path, &file.content)?;
    }

    fs::rename(&staging, &target)
        .map_err(|error| format!("install managed Skill directory: {error}"))?;
    set_tree_readonly(&target)?;
    Ok(target.to_path_buf())
}

fn collect_existing_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<PackageFile>,
) -> Result<(), String> {
    for entry in
        fs::read_dir(current).map_err(|error| format!("read managed Skill tree: {error}"))?
    {
        let entry = entry.map_err(|error| format!("read managed Skill entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_existing_files(root, &path, files)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "managed Skill file escaped package root".to_string())?
            .to_str()
            .ok_or_else(|| "managed Skill file path is not UTF-8".to_string())?
            .replace('\\', "/");
        if relative.eq_ignore_ascii_case("SKILL.md") {
            continue;
        }
        let content = fs::read(&path)
            .map_err(|error| format!("read managed Skill file {relative}: {error}"))?;
        let (kind, owner) = resource_kind_and_owner(&relative, &content);
        files.push(PackageFile {
            path: relative,
            content,
            kind,
            owner,
        });
    }
    Ok(())
}

fn read_managed_resource_at_root(
    root: &Path,
    relative: &str,
    expected_sha256: Option<&str>,
) -> Result<Vec<u8>, String> {
    let normalized = normalized_relative_path(relative)
        .ok_or_else(|| "unsafe managed Skill resource path".to_string())?;
    let path = root.join(&normalized);
    if !path.is_file() {
        return Err("managed Skill resource not found".to_string());
    }
    let content = fs::read(&path)
        .map_err(|error| format!("read managed Skill resource {normalized}: {error}"))?;
    if let Some(expected) = expected_sha256 {
        let mut hasher = Sha256::new();
        hasher.update(&content);
        if !expected.eq_ignore_ascii_case(&hex::encode(hasher.finalize())) {
            return Err("managed Skill resource integrity mismatch".to_string());
        }
    }
    Ok(content)
}

fn walk_tree(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        paths.push(current.clone());
        if current.is_dir() {
            for entry in fs::read_dir(&current)
                .map_err(|error| format!("read managed Skill tree: {error}"))?
            {
                let entry = entry.map_err(|error| format!("read managed Skill entry: {error}"))?;
                stack.push(entry.path());
            }
        }
    }
    Ok(paths)
}

fn set_tree_readonly(root: &Path) -> Result<(), String> {
    let mut paths = walk_tree(root)?;
    paths.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for path in paths {
        set_readonly(&path, path.is_dir())?;
    }
    Ok(())
}

fn set_tree_writable(root: &Path) -> Result<(), String> {
    for path in walk_tree(root)? {
        set_writable(&path, path.is_dir())?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_readonly(path: &Path, directory: bool) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if directory { 0o555 } else { 0o444 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|error| format!("set managed Skill permissions: {error}"))
}

#[cfg(unix)]
fn set_writable(path: &Path, directory: bool) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if directory { 0o755 } else { 0o644 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|error| format!("restore managed Skill permissions: {error}"))
}

#[cfg(not(unix))]
fn set_readonly(path: &Path, _directory: bool) -> Result<(), String> {
    let mut permissions = fs::metadata(path)
        .map_err(|error| format!("read managed Skill metadata: {error}"))?
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("set managed Skill permissions: {error}"))
}

#[cfg(not(unix))]
fn set_writable(path: &Path, _directory: bool) -> Result<(), String> {
    let mut permissions = fs::metadata(path)
        .map_err(|error| format!("read managed Skill metadata: {error}"))?
        .permissions();
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("restore managed Skill permissions: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha256_hex(content: &[u8]) -> String {
        hex::encode(Sha256::digest(content))
    }
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn test_zip() -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();
        writer.start_file("my-skill/SKILL.md", options).unwrap();
        writer
            .write_all(b"---\nname: My Skill\n---\n# My Skill\n")
            .unwrap();
        writer
            .start_file("my-skill/references/api.md", options)
            .unwrap();
        writer.write_all(b"# API").unwrap();
        writer
            .start_file("my-skill/scripts/run.sh", options)
            .unwrap();
        writer.write_all(b"#!/bin/sh\n").unwrap();
        writer
            .start_file("my-skill/assets/logo.bin", options)
            .unwrap();
        writer.write_all(&[0, 159, 146, 150]).unwrap();
        let cursor = writer.finish().unwrap();
        cursor.into_inner()
    }

    #[test]
    fn extracts_versioned_text_script_and_asset_resources() {
        let package = extract_skill_zip(&test_zip()).expect("extract package");
        assert_eq!(package.name, "My Skill");
        assert!(package.skill_content.contains("# My Skill"));
        let by_path: std::collections::HashMap<_, _> = package
            .files
            .iter()
            .map(|file| (file.path.as_str(), file))
            .collect();
        assert_eq!(
            by_path["references/api.md"].owner,
            model::agent::ToolExecutionOwner::Station
        );
        assert_eq!(
            by_path["scripts/run.sh"].kind,
            model::agent::SkillResourceKind::Script
        );
        assert_eq!(
            by_path["scripts/run.sh"].owner,
            model::agent::ToolExecutionOwner::ClientCapability
        );
        assert_eq!(
            by_path["assets/logo.bin"].owner,
            model::agent::ToolExecutionOwner::ClientCapability
        );
    }

    #[test]
    fn rejects_path_traversal_in_zip_entries() {
        let mut cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default();
        writer.start_file("SKILL.md", options).unwrap();
        writer.write_all(b"# Skill").unwrap();
        writer.start_file("../evil.md", options).unwrap();
        writer.write_all(b"evil").unwrap();
        writer.finish().unwrap();
        assert!(extract_skill_zip(&cursor.into_inner()).is_err());
    }

    #[test]
    fn rejects_backslash_separator_in_zip_entries() {
        let mut cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default();
        writer.start_file("SKILL.md", options).unwrap();
        writer.write_all(b"# Skill").unwrap();
        writer.start_file("..\\evil.sh", options).unwrap();
        writer.write_all(b"evil").unwrap();
        writer.finish().unwrap();
        assert!(extract_skill_zip(&cursor.into_inner()).is_err());
    }

    #[test]
    fn materializes_readonly_managed_tree_and_reads_hashed_resource() {
        let temp = unique_temp_dir("managed-skill-package");
        let target = temp.join("skill_123").join("1");
        let files = vec![PackageFile {
            path: "references/api.md".to_string(),
            content: b"# API".to_vec(),
            kind: model::agent::SkillResourceKind::Reference,
            owner: model::agent::ToolExecutionOwner::Station,
        }];
        materialize_managed_package_at_root(&target, &files, "# Skill").unwrap();
        let content = read_managed_resource_at_root(
            &target,
            "references/api.md",
            Some(&sha256_hex(b"# API")),
        )
        .unwrap();
        assert_eq!(content, b"# API");
        assert!(read_managed_resource_at_root(&target, "../secret", None).is_err());

        set_tree_writable(&target).unwrap();
        let _ = fs::remove_dir_all(&temp);
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{nanos}"))
    }
}
