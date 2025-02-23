package plugin

var (
	ConfigPlugins = map[string]ConfigPlugin{}
	ClientPlugins = map[string]ClientPlugin{}
	ServerPlugins = map[string]ServerPlugin{}
	LoggerPlugins = map[string]LoggerPlugin{}
)
