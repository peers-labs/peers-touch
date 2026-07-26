use serde::Deserialize;

const CATALOG_YAML: &str = include_str!("providers.default.yaml");

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogProvider {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub builtin: bool,
    #[serde(default)]
    pub show_checker: bool,
    #[serde(default)]
    pub show_api_key: Option<bool>,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub discovery: String,
    #[serde(default)]
    pub home_url: String,
    #[serde(default)]
    pub api_key_url: String,
    #[serde(default)]
    pub default_base_url: String,
    #[serde(default)]
    pub runtime_kind: Option<String>,
    #[serde(default)]
    pub cli_command: Option<String>,
    #[serde(default)]
    pub models_command: Option<String>,
    #[serde(default)]
    pub models: Vec<CatalogModel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogModel {
    pub id: String,
    pub display_name: String,
    #[serde(rename = "type", default)]
    pub model_type: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub context_window: u64,
}

#[derive(Deserialize)]
struct CatalogRoot {
    providers: Vec<CatalogProvider>,
}

fn default_true() -> bool {
    true
}

pub fn list_catalog() -> &'static [CatalogProvider] {
    use std::sync::OnceLock;
    static CATALOG: OnceLock<Vec<CatalogProvider>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let root: CatalogRoot =
            serde_yaml::from_str(CATALOG_YAML).expect("embedded provider catalog is invalid YAML");
        root.providers
    })
}

pub fn find_in_catalog(provider_id: &str) -> Option<&'static CatalogProvider> {
    list_catalog().iter().find(|p| p.id == provider_id)
}
