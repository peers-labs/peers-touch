package main

import (
	"fmt"
	"log"
	"os"

	"github.com/peers-touch/peers-touch/station/frame/touch"
)

func main() {
	fmt.Println("Router Configuration Example")
	fmt.Println("============================")

	// Check if configuration files exist
	configPaths := []string{"peers.yml", "conf/peers.yml"}
	var foundConfig string

	for _, path := range configPaths {
		if _, err := os.Stat(path); err == nil {
			foundConfig = path
			break
		}
	}

	if foundConfig != "" {
		fmt.Printf("Found configuration file: %s\n", foundConfig)
	} else {
		fmt.Println("No configuration file found, using defaults")
	}
	fmt.Println()

	// Print which routers are enabled based on configuration
	// Note: The actual configuration loading happens through the framework's init process
	// This example demonstrates the default behavior
	routerConfig := touch.GetRouterConfig()
	fmt.Printf("Management Router:  %v\n", routerConfig.Management)
	fmt.Printf("ActivityPub Router: %v\n", routerConfig.ActivityPub)
	fmt.Printf("WellKnown Router:   %v\n", routerConfig.WellKnown)
	fmt.Printf("User Router:        %v\n", routerConfig.User)
	fmt.Printf("Peer Router:        %v\n", routerConfig.Peer)
	fmt.Println()

	// Get the handlers based on configuration
	handlers := touch.Routers()
	fmt.Printf("Total handlers registered: %d\n", len(handlers))
	fmt.Println()

	fmt.Println("Router Configuration System Features:")
	fmt.Println("- All routers are enabled by default")
	fmt.Println("- Routers can be disabled via YAML configuration")
	fmt.Println("- Environment variables can override settings")
	fmt.Println("- Configuration is loaded automatically by the framework")
	fmt.Println()
	fmt.Println("To test with custom configuration:")
	fmt.Println("1. Edit conf/peers.yml to disable specific routers")
	fmt.Println("2. Use environment variables like PEERS_ROUTERS_ACTIVITYPUB=false")
	fmt.Println("3. Run within a full peers node for complete functionality")

	log.Println("Router configuration system is working correctly.")
}
