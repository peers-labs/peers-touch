package broker

var (
	defaultBroker Broker
	brokers       = map[string]Broker{}
)

// Register adds a named broker instance for lookup.
func Register(name string, b Broker) { brokers[name] = b }

// SetDefault sets the process-wide default broker instance (called by plugin init).
func SetDefault(b Broker) { defaultBroker = b }

// Get returns a broker instance by name; empty name returns the default.
func Get(opts ...GetOption) Broker {
	getOptions := &GetOptions{}
	for _, o := range opts {
		o(getOptions)
	}

	if getOptions.Name == "" {
		return defaultBroker
	}

	if b, ok := brokers[getOptions.Name]; ok {
		return b
	}

	return defaultBroker
}
