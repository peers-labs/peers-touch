package main

import (
	"context"
	"fmt"
	"log"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/peer"
)

func main() {
	ctx := context.Background()

	// 创建 libp2p 主机
	h, err := libp2p.New()
	if err != nil {
		log.Fatalf("Failed to create h: %s", err)
	}

	// 创建一个 DHT 实例
	ipfsDHT, err := dht.New(ctx, h, dht.Mode(dht.ModeServer))
	if err != nil {
		log.Fatalf("Failed to create DHT: %s", err)
	}

	for _, addrStr := range dht.DefaultBootstrapPeers {
		addr, err := peer.AddrInfoFromP2pAddr(addrStr)
		if err != nil {
			log.Fatalf("Failed to parse bootstrap address: %s", err)
		}
		if err := h.Connect(ctx, *addr); err != nil {
			log.Printf("Failed to connect to bootstrap peer %s: %s", addr.ID, err)
		} else {
			log.Printf("Connected to bootstrap peer %s", addr.ID)
		}
	}

	// 确保 DHT 是被完全初始化和填充的
	if err = ipfsDHT.Bootstrap(ctx); err != nil {
		log.Fatalf("Failed to bootstrap DHT: %s", err)
	}
	// 创建一个适合 DHT 的键
	key := fmt.Sprintf("/ipns/%s", h.ID().String())

	// 存储一个键值对
	value := []byte("Hello World")
	if err := ipfsDHT.PutValue(ctx, key, value); err != nil {
		log.Fatalf("Failed to put value in DHT: %s", err)
	} else {
		fmt.Println("Successfully put value in DHT")
	}

	// 检索一个键值对
	result, err := ipfsDHT.GetValue(ctx, key)
	if err != nil {
		log.Fatalf("Failed to get value: %s", err)
	} else {
		log.Printf("Successfully retrieved value for key %s: %s", key, string(result))
	}

	fmt.Println("DHT operation completed")
}
