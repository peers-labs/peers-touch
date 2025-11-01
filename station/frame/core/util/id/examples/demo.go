package main

import (
	"fmt"
	"github.com/peers-touch/peers-touch/station/frame/core/util/id"
)

func main() {
	// Numeric IDs
	fmt.Println("Sonyflake ID:", id.NextID(id.WithSonyflake()))
	fmt.Println("Timing ID:", id.NextID(id.WithTiming()))

	// String IDs
	fmt.Println("Readable ID:", id.NextIDS(id.WithReadable()))
	fmt.Println("Random ID:", id.NextIDS(id.WithRandom()))
	fmt.Println("Readable with prefix/suffix:", id.NextIDS(id.WithReadable(), id.WithPrefix("usr-"), id.WithSuffix("-dev")))

	// Quick helper functions
	fmt.Println("NextSonyflakeID:", id.NextSonyflakeID())
	fmt.Println("NextReadableID:", id.NextReadableID("user"))
	fmt.Println("NextRandomID:", id.NextRandomID(12))
}
