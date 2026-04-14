// Infrastructure layer: i18n language pack management service.
// Owns the i18n root path, handles deploying built-in packs and
// scanning/loading language packs from the filesystem at runtime.
//
// Dev mode: reads directly from packages/locales/ source tree for
// instant reflection of changes — no version bump required.
// Production: deploys from Tauri bundled resources to config/i18n/,
// using metadata.json version comparison as a fast-path cache.
// 2026-04-09: Initial creation for i18n architecture landing.
// 2026-04-09: Refactored from procedural functions to I18nService struct.
// 2026-04-14: Dev-mode direct-read — load_resources bypasses config/i18n
//             in debug builds, reading from packages/locales/ directly.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const BUILTIN_LANGUAGES: &[&str] = &["en", "zh-CN"];
const I18N_DIR: &str = "i18n";

#[derive(Debug, Clone, serde::Serialize)]
pub struct LanguageInfo {
    pub code: String,
    pub name: Option<String>,
    pub native_name: Option<String>,
    pub namespaces: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct I18nResources {
    pub languages: Vec<LanguageInfo>,
    pub resources: HashMap<String, HashMap<String, serde_json::Value>>,
}

/// Core i18n infrastructure service.
///
/// In debug builds, `dev_source` is resolved at construction time from
/// the monorepo layout (packages/locales/). When present, `load_resources`
/// and `resolve_key` read from the source tree directly — locale edits
/// are reflected on the next app reload without touching metadata.json.
///
/// In release builds, `dev_source` is always `None`; the service reads
/// from the deployed `config/i18n/` directory as before.
#[derive(Debug, Clone)]
pub struct I18nService {
    i18n_root: PathBuf,
    dev_source: Option<PathBuf>,
}

impl I18nService {
    /// Create a new I18nService from a config directory path.
    ///
    /// The i18n root is resolved as `{config_dir}/i18n/`.
    /// In debug builds, also probes for the monorepo source tree
    /// (`packages/locales/`) to enable direct-read dev mode.
    pub fn new(config_dir: &Path) -> Self {
        let dev_source = Self::detect_dev_source();
        if let Some(ref src) = dev_source {
            tracing::info!(
                path = %src.display(),
                "Dev-mode i18n: will read directly from source tree"
            );
        }
        Self {
            i18n_root: config_dir.join(I18N_DIR),
            dev_source,
        }
    }

    /// In debug builds, resolve packages/locales/ from the monorepo layout.
    /// Returns None in release builds or if the path doesn't exist.
    fn detect_dev_source() -> Option<PathBuf> {
        #[cfg(debug_assertions)]
        {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let project_root = manifest_dir
                .parent()    // desktop
                .and_then(|p| p.parent())    // apps
                .and_then(|p| p.parent());   // project_root

            if let Some(root) = project_root {
                let dev_locales = root.join("packages").join("locales");
                if dev_locales.exists() && dev_locales.join("en").is_dir() {
                    return Some(dev_locales);
                }
            }
            None
        }
        #[cfg(not(debug_assertions))]
        {
            None
        }
    }

    /// Deploy built-in language packs to config/i18n/.
    ///
    /// Resolves source from Tauri resource_dir (production) or
    /// packages/locales/ (dev mode fallback via CARGO_MANIFEST_DIR).
    ///
    /// Compares the `version` field in source and deployed metadata.json.
    /// If they match, no IO is performed (fast path).
    /// If they differ (or no deployed metadata exists), all built-in packs
    /// are re-deployed. User / community packs are never touched.
    pub fn deploy_builtin_packs(&self, resource_dir: &Path) -> Result<(), String> {
        fs::create_dir_all(&self.i18n_root)
            .map_err(|e| format!("Failed to create i18n directory: {e}"))?;

        let source = Self::resolve_source_dir(resource_dir);

        let source_meta_path = source.join("metadata.json");
        let target_meta_path = self.i18n_root.join("metadata.json");

        let source_version = Self::read_metadata_version(&source_meta_path);
        let deployed_version = Self::read_metadata_version(&target_meta_path);

        if source_version.is_some() && source_version == deployed_version {
            tracing::debug!(
                version = source_version.as_deref().unwrap_or("?"),
                "Built-in i18n packs already up-to-date, skipping deploy"
            );
            return Ok(());
        }

        tracing::info!(
            source = source_version.as_deref().unwrap_or("none"),
            deployed = deployed_version.as_deref().unwrap_or("none"),
            "i18n version mismatch — deploying built-in packs"
        );

        // Deploy each built-in language pack (overwrite stale data)
        for lang in BUILTIN_LANGUAGES {
            let source_dir = source.join(lang);
            if !source_dir.is_dir() {
                tracing::warn!(lang = %lang, "Built-in pack not found in source");
                continue;
            }

            let target_dir = self.i18n_root.join(lang);
            if target_dir.exists() {
                fs::remove_dir_all(&target_dir)
                    .map_err(|e| format!("Failed to clean old {lang} pack: {e}"))?;
            }

            Self::copy_dir_recursive(&source_dir, &target_dir)
                .map_err(|e| format!("Failed to deploy {lang}: {e}"))?;
            tracing::info!(lang = %lang, "Built-in language pack deployed");
        }

        // Stamp the deployed version by copying metadata.json last
        if source_meta_path.exists() {
            fs::copy(&source_meta_path, &target_meta_path)
                .map_err(|e| format!("Failed to deploy metadata.json: {e}"))?;
        }

        Self::deploy_readme(&self.i18n_root);

        Ok(())
    }

    /// Scan language directories, discover all available languages
    /// and load their translation resources.
    ///
    /// In dev mode (debug build with packages/locales/ available),
    /// reads from the source tree directly for instant changes.
    /// In production, reads from the deployed config/i18n/ directory,
    /// which also includes community packs.
    pub fn load_resources(&self) -> Result<I18nResources, String> {
        if let Some(ref source) = self.dev_source {
            tracing::debug!("Loading i18n resources from dev source");
            return self.scan_and_load(source);
        }
        self.scan_and_load(&self.i18n_root)
    }

    /// Core scan-and-load: reads all language directories under `root_dir`.
    fn scan_and_load(&self, root_dir: &Path) -> Result<I18nResources, String> {
        if !root_dir.exists() {
            return Ok(I18nResources {
                languages: vec![],
                resources: HashMap::new(),
            });
        }

        let metadata = Self::load_metadata_from(root_dir);

        let mut languages = Vec::new();
        let mut resources: HashMap<String, HashMap<String, serde_json::Value>> = HashMap::new();

        let entries = fs::read_dir(root_dir)
            .map_err(|e| format!("Failed to read i18n directory: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let lang_code = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };

            let (ns_list, lang_resources) = Self::load_language_dir_static(&path, &lang_code);

            let meta_entry = metadata.get(&lang_code);
            languages.push(LanguageInfo {
                code: lang_code.clone(),
                name: meta_entry.and_then(|m| m.name.clone()),
                native_name: meta_entry.and_then(|m| m.native_name.clone()),
                namespaces: ns_list,
            });

            resources.insert(lang_code, lang_resources);
        }

        languages.sort_by(|a, b| a.code.cmp(&b.code));

        Ok(I18nResources {
            languages,
            resources,
        })
    }

    pub fn resolve_key(&self, lang: &str, ns: &str, key: &str) -> String {
        if let Some(val) = self.lookup_key(lang, ns, key) {
            return val;
        }
        if lang != "en" {
            if let Some(val) = self.lookup_key("en", ns, key) {
                return val;
            }
        }
        key.to_string()
    }

    /// Read a single key from the appropriate root (dev_source or i18n_root).
    fn lookup_key(&self, lang: &str, ns: &str, key: &str) -> Option<String> {
        let root = self.dev_source.as_ref().unwrap_or(&self.i18n_root);
        Self::read_key_from_file(&root.join(lang).join(format!("{ns}.json")), key)
    }

    fn read_key_from_file(path: &Path, key: &str) -> Option<String> {
        let content = fs::read_to_string(path).ok()?;
        let obj: serde_json::Value = serde_json::from_str(&content).ok()?;
        obj.get(key).and_then(|v| v.as_str()).map(String::from)
    }

    // -- Private helpers --

    /// Write a README to config/i18n/ explaining the directory layout.
    fn deploy_readme(i18n_root: &Path) {
        let readme_path = i18n_root.join("README.md");
        let content = r#"# Peers Touch — Language Packs

This directory is managed by Peers Touch at startup.

## Built-in packs (auto-managed)

`en/` and `zh-CN/` are re-deployed when the built-in pack version
changes (tracked by the `version` field in `metadata.json`).
Do NOT edit files inside them — your changes will be overwritten
on the next app update.

## Adding a community / custom language pack

1. Create a new directory named with the BCP-47 language tag, e.g. `ja/`, `ko/`, `fr/`.
2. Copy the JSON files from `en/` as a template.
3. Translate each key-value pair; keep the keys unchanged.
4. (Optional) Add an entry in `metadata.json` with `name` and `nativeName`.
5. Restart the app — the new language will appear in the language switcher.

Community packs are **never touched** by the app.
"#;
        if let Err(e) = fs::write(&readme_path, content) {
            tracing::warn!(error = %e, "Failed to write i18n README");
        }
    }

    /// Read the `version` field from a metadata.json file, if present.
    fn read_metadata_version(path: &Path) -> Option<String> {
        let content = fs::read_to_string(path).ok()?;
        let obj: serde_json::Value = serde_json::from_str(&content).ok()?;
        obj.get("version").and_then(|v| v.as_str()).map(String::from)
    }

    /// Resolve the source directory containing built-in locale files.
    ///
    /// In production: Tauri resource_dir contains bundled i18n/ files.
    /// In dev mode: fallback to packages/locales/ in the project source tree.
    fn resolve_source_dir(resource_dir: &Path) -> PathBuf {
        let bundled = resource_dir.join(I18N_DIR);
        if bundled.exists() && bundled.join("en").is_dir() {
            return bundled;
        }

        // Dev mode fallback: walk up from src-tauri to find packages/locales.
        // src-tauri -> desktop -> apps -> project_root -> packages/locales
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()   // desktop
            .and_then(|p| p.parent())   // apps
            .and_then(|p| p.parent());  // project_root

        if let Some(root) = project_root {
            let dev_locales = root.join("packages").join("locales");
            if dev_locales.exists() {
                tracing::info!(
                    path = %dev_locales.display(),
                    "Using dev source for i18n packs"
                );
                return dev_locales;
            }
        }

        tracing::warn!("No i18n source found (neither bundled nor dev)");
        bundled
    }

    fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            if src_path.is_dir() {
                Self::copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                fs::copy(&src_path, &dst_path)?;
            }
        }
        Ok(())
    }

    /// Load and parse all namespace JSON files from a language directory.
    fn load_language_dir_static(
        lang_path: &Path,
        lang_code: &str,
    ) -> (Vec<String>, HashMap<String, serde_json::Value>) {
        let mut ns_list = Vec::new();
        let mut lang_resources: HashMap<String, serde_json::Value> = HashMap::new();

        let ns_entries = match fs::read_dir(lang_path) {
            Ok(entries) => entries,
            Err(_) => return (ns_list, lang_resources),
        };

        for ns_entry in ns_entries.flatten() {
            let ns_path = ns_entry.path();
            if ns_path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let ns_name = ns_path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();

            match fs::read_to_string(&ns_path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(value) => {
                        ns_list.push(ns_name.clone());
                        lang_resources.insert(ns_name, value);
                    }
                    Err(e) => {
                        tracing::warn!(
                            lang = %lang_code, ns = %ns_name,
                            error = %e, "Failed to parse namespace file, skipping"
                        );
                    }
                },
                Err(e) => {
                    tracing::warn!(
                        lang = %lang_code, ns = %ns_name,
                        error = %e, "Failed to read namespace file, skipping"
                    );
                }
            }
        }

        ns_list.sort();
        (ns_list, lang_resources)
    }

    /// Load metadata.json from a given root directory.
    fn load_metadata_from(root: &Path) -> HashMap<String, MetadataEntry> {
        let meta_path = root.join("metadata.json");
        if !meta_path.exists() {
            return HashMap::new();
        }
        fs::read_to_string(&meta_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    }
}

#[derive(serde::Deserialize)]
struct MetadataEntry {
    name: Option<String>,
    #[serde(rename = "nativeName")]
    native_name: Option<String>,
}
