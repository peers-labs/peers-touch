package native

type MetaRegisterType = string

const (
	MetaRegisterTypeDHT       MetaRegisterType = "dht"
	MetaRegisterTypeConnected MetaRegisterType = "connected"
)

const (
	MetaConstantKeyRegisterType = "registerType"
	MetaConstantKeyAddress      = "address"
	// MetaConstantKeyPeerID is the libp2p node's id. ptn is abbreviated for peer-touch-network
	MetaConstantKeyPeerID = "ptn:peerId"
)
