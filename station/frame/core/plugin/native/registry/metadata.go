// Package native defines registry metadata constants and types.
package native

import dht_pb "github.com/libp2p/go-libp2p-kad-dht/pb"

// MetaRegisterType represents the source of a registration.
type MetaRegisterType = string

const (
	// MetaRegisterTypeDHT marks registrations discovered via DHT.
	MetaRegisterTypeDHT MetaRegisterType = "dht"
	// MetaRegisterTypeConnected marks registrations from direct connections.
	MetaRegisterTypeConnected MetaRegisterType = "connected"
)

const (
	// MetaConstantKeyRegisterType is the metadata key indicating register source.
	MetaConstantKeyRegisterType = "registerType"
	// MetaConstantKeyAddress is the metadata key listing peer addresses.
	MetaConstantKeyAddress = "address"
	// MetaConstantKeyPeerID is the libp2p node ID (ptn = peer-touch-network).
	MetaConstantKeyPeerID = "ptn:peerId"
)

const (
	// MessagePutValue maps to Kademlia DHT PUT_VALUE.
	MessagePutValue = dht_pb.Message_PUT_VALUE
	// MessageGetValue maps to Kademlia DHT GET_VALUE.
	MessageGetValue = dht_pb.Message_GET_VALUE
	// MessageAddProvider maps to Kademlia DHT ADD_PROVIDER.
	MessageAddProvider = dht_pb.Message_ADD_PROVIDER
	// MessageGetProviders maps to Kademlia DHT GET_PROVIDERS.
	MessageGetProviders = dht_pb.Message_GET_PROVIDERS
	// MessageFindNode maps to Kademlia DHT FIND_NODE.
	MessageFindNode = dht_pb.Message_FIND_NODE
	// MessagePing maps to Kademlia DHT PING.
	MessagePing = dht_pb.Message_PING
)
