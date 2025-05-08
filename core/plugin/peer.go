package plugin

var (
	ConfigPlugins   = map[string]ConfigPlugin{}
	ClientPlugins   = map[string]ClientPlugin{}
	ServerPlugins   = map[string]ServerPlugin{}
	ServicePlugins  = map[string]ServicePlugin{}
	LoggerPlugins   = map[string]LoggerPlugin{}
	StorePlugins    = map[string]StorePlugin{}
	RegistryPlugins = map[string]RegistryPlugin{}
)
