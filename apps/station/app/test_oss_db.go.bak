package main

import (
	"context"
	"fmt"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

func main() {
	ctx := context.Background()
	
	// Try to get RDS with name "oss"
	db, err := store.GetRDS(ctx, store.WithRDSDBName("oss"))
	if err != nil {
		fmt.Printf("❌ Error getting RDS 'oss': %v\n", err)
		return
	}
	
	fmt.Printf("✅ Got RDS 'oss': %v\n", db)
}
