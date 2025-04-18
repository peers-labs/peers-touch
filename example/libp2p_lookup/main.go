package main

import (
	"context"
	"fmt"
	"log"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p-core/host"
	"github.com/libp2p/go-libp2p-core/peer"
	"github.com/libp2p/go-libp2p-core/peerstore"
	"github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p-kad-dht/record"
)

// NameKeyPrefix 是自定义键的前缀
const NameKeyPrefix = "/name/"

// NameValidator 是自定义的记录验证器
type NameValidator struct{}

// Validate 验证记录的合法性
func (v *NameValidator) Validate(key string, val []byte) error {
	// 简单验证，确保键以指定前缀开头
	if key[:len(NameKeyPrefix)] != NameKeyPrefix {
		return fmt.Errorf("invalid key for name record: %s", key)
	}
	// 验证值是否为有效的 peer.ID
	_, err := peer.Decode(string(val))
	return err
}

// Select 选择合适的记录，这里简单返回 nil
func (v *NameValidator) Select(key string, vals [][]byte) (int, error) {
	return 0, nil
}

// storeNameToPeerID 存储名字和 peer.ID 的映射关系
func storeNameToPeerID(ctx context.Context, dht *dht.IpfsDHT, name string, peerID peer.ID) error {
	// 构建自定义键
	key := NameKeyPrefix + name
	// 将 peer.ID 转换为字符串
	peerIDStr := peerID.Pretty()
	// 创建记录
	record := &record.Record{
		Key:   key,
		Value: []byte(peerIDStr),
	}
	// 存储记录
	err := dht.PutValue(ctx, key, []byte(peerIDStr))
	if err != nil {
		return fmt.Errorf("failed to store name to peer ID mapping: %w", err)
	}
	return nil
}

// lookupPeerIDByName 通过名字查找 peer.ID
func lookupPeerIDByName(ctx context.Context, dht *dht.IpfsDHT, name string) (peer.ID, error) {
	// 构建自定义键
	key := NameKeyPrefix + name
	// 从 DHT 中查找记录
	data, err := dht.GetValue(ctx, key)
	if err != nil {
		return "", fmt.Errorf("failed to lookup peer ID by name: %w", err)
	}
	// 将记录的值转换为 peer.ID
	peerID, err := peer.Decode(string(data))
	if err != nil {
		return "", fmt.Errorf("failed to decode peer ID: %w", err)
	}
	return peerID, nil
}

func main() {
	ctx := context.Background()

	// 创建第一个节点
	host1, dht1 := createNode(ctx)
	fmt.Printf("Node 1 ID: %s\n", host1.ID().Pretty())

	// 创建第二个节点
	host2, dht2 := createNode(ctx)
	fmt.Printf("Node 2 ID: %s\n", host2.ID().Pretty())

	// 连接两个节点
	connectNodes(ctx, host1, host2)

	// 注册自定义验证器
	dht1.Validator = record.NamespacedValidator{
		"":            record.PublicKeyValidator{},
		NameKeyPrefix: &NameValidator{},
	}
	dht2.Validator = record.NamespacedValidator{
		"":            record.PublicKeyValidator{},
		NameKeyPrefix: &NameValidator{},
	}

	// 节点 1 存储名字和 peer.ID 的映射关系
	name := "node1"
	err := storeNameToPeerID(ctx, dht1, name, host1.ID())
	if err != nil {
		log.Fatalf("Failed to store name to peer ID mapping: %v", err)
	}
	fmt.Printf("Stored name '%s' to peer ID mapping\n", name)

	// 节点 2 通过名字查找节点 1 的 peer.ID
	foundPeerID, err := lookupPeerIDByName(ctx, dht2, name)
	if err != nil {
		log.Fatalf("Failed to lookup peer ID by name: %v", err)
	}
	fmt.Printf("Found peer ID by name '%s': %s\n", name, foundPeerID.Pretty())

	// 节点 2 连接到节点 1
	info := peer.AddrInfo{
		ID:    foundPeerID,
		Addrs: host1.Addrs(),
	}
	host2.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.PermanentAddrTTL)
	err = host2.Connect(ctx, info)
	if err != nil {
		log.Fatalf("Failed to connect to peer: %v", err)
	}
	fmt.Printf("Connected to peer %s\n", foundPeerID.Pretty())
}

// 创建节点
func createNode(ctx context.Context) (host.Host, *dht.IpfsDHT) {
	h, err := libp2p.New(ctx)
	if err != nil {
		log.Fatalf("Failed to create host: %v", err)
	}

	dht, err := dht.New(ctx, h)
	if err != nil {
		log.Fatalf("Failed to create DHT: %v", err)
	}

	// 启动 DHT
	err = dht.Bootstrap(ctx)
	if err != nil {
		log.Fatalf("Failed to bootstrap DHT: %v", err)
	}

	return h, dht
}

// 连接两个节点
func connectNodes(ctx context.Context, h1, h2 host.Host) {
	info := peer.AddrInfo{
		ID:    h2.ID(),
		Addrs: h2.Addrs(),
	}
	h1.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.PermanentAddrTTL)
	err := h1.Connect(ctx, info)
	if err != nil {
		log.Fatalf("Failed to connect nodes: %v", err)
	}
	fmt.Printf("Connected node %s to node %s\n", h1.ID().Pretty(), h2.ID().Pretty())
}
