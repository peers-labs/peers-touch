package native

import dht_pb "github.com/libp2p/go-libp2p-kad-dht/pb"

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

const (
	MessagePutValue     = dht_pb.Message_PUT_VALUE
	MessageGetValue     = dht_pb.Message_GET_VALUE
	MessageAddProvider  = dht_pb.Message_ADD_PROVIDER
	MessageGetProviders = dht_pb.Message_GET_PROVIDERS
	MessageFindNode     = dht_pb.Message_FIND_NODE
	MessagePing         = dht_pb.Message_PING
)
