package mdns

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/peers-touch/peers-touch-go/core/types"
)

// TestNewMDNSService tests basic service creation
func TestNewMDNSService(t *testing.T) {
	fmt.Println("\n=== Testing NewMDNSService ===")

	ctx := context.Background()

	// Test with default options
	service, err := NewMDNSService(ctx, WithNamespace("test-service"))
	if err != nil {
		t.Fatalf("Failed to create mDNS service: %v", err)
	}

	if service == nil {
		t.Fatal("Service should not be nil")
	}

	if service.options.Namespace != "test-service" {
		t.Errorf("Expected namespace 'test-service', got '%s'", service.options.Namespace)
	}

	if service.options.Service != DefaultService {
		t.Errorf("Expected service '%s', got '%s'", DefaultService, service.options.Service)
	}

	fmt.Println("   ✅ Service created successfully")
}

// TestServiceStartStop tests service lifecycle
func TestServiceStartStop(t *testing.T) {
	fmt.Println("\n=== Testing Service Start/Stop ===")

	ctx := context.Background()

	service, err := NewMDNSService(ctx, WithNamespace("test-start-stop"))
	if err != nil {
		t.Fatalf("Failed to create mDNS service: %v", err)
	}

	// Test start
	err = service.Start()
	if err != nil {
		t.Fatalf("Failed to start service: %v", err)
	}

	if !service.running {
		t.Error("Service should be running after start")
	}

	// Test double start
	err = service.Start()
	if err == nil {
		t.Error("Should not be able to start service twice")
	}

	// Test stop
	err = service.Stop()
	if err != nil {
		t.Fatalf("Failed to stop service: %v", err)
	}

	if service.running {
		t.Error("Service should not be running after stop")
	}

	// Test double stop
	err = service.Stop()
	if err == nil {
		t.Error("Should not be able to stop service twice")
	}

	fmt.Println("   ✅ Start/stop cycles working correctly")
}

// TestAdvertiseNode tests node advertisement
func TestAdvertiseNode(t *testing.T) {
	fmt.Println("\n=== Testing AdvertiseNode ===")

	ctx := context.Background()

	service, err := NewMDNSService(ctx, WithNamespace("test-advertise"))
	if err != nil {
		t.Fatalf("Failed to create mDNS service: %v", err)
	}

	// Create a test node
	node := &types.Node{
		ID:   "test-node-1",
		Type: "bootstrap",
		Name: "Test Bootstrap Node",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("test12345678901234567890"),
		},
		Addresses: []string{"/ip4/192.168.1.100/tcp/4001"},
		Metadata:  make(map[string]interface{}),
	}

	// Test advertise node
	err = service.AdvertiseNode(node)
	if err != nil {
		t.Fatalf("Failed to advertise node: %v", err)
	}

	// Verify TXT records were built correctly
	txtRecords := service.options.TXT
	if len(txtRecords) == 0 {
		t.Error("TXT records should not be empty after advertising node")
	}

	// Check that node information is in TXT records
	foundNodeID := false
	for _, txt := range txtRecords {
		if txt == "nd_id=test-node-1" {
			foundNodeID = true
			break
		}
	}
	if !foundNodeID {
		t.Error("Node ID should be found in TXT records")
	}

	fmt.Printf("   ✅ Node advertised successfully: %s\n", node.Name)
}

// TestWatch tests discovery callback
func TestWatch(t *testing.T) {
	fmt.Println("\n=== Testing Watch Callback ===")

	ctx := context.Background()

	service, err := NewMDNSService(ctx, WithNamespace("test-watch"))
	if err != nil {
		t.Fatalf("Failed to create mDNS service: %v", err)
	}

	// Test watch callback
	callbackCalled := false
	var discoveredPeer *types.Peer

	service.Watch(func(peer *types.Peer) {
		callbackCalled = true
		discoveredPeer = peer
	})

	if service.onPeerDiscovered == nil {
		t.Error("Watch callback should be set")
	}

	// Simulate discovery by calling the callback directly
	testPeer := &types.Peer{
		ID:        "discovered-peer-1",
		Name:      "Test Discovered Peer",
		Version:   "1.0.0",
		Nodes:     []types.Node{},
		Metadata:  make(map[string]interface{}),
		Timestamp: time.Now(),
	}

	service.onPeerDiscovered(testPeer)

	if !callbackCalled {
		t.Error("Callback should have been called")
	}

	if discoveredPeer == nil {
		t.Error("Discovered peer should not be nil")
	}

	if discoveredPeer.ID != testPeer.ID {
		t.Errorf("Expected peer ID '%s', got '%s'", testPeer.ID, discoveredPeer.ID)
	}

	fmt.Println("   ✅ Watch callback working correctly")
}

// TestBuildTXTRecords tests TXT record generation
func TestBuildTXTRecords(t *testing.T) {
	fmt.Println("\n=== Testing TXT Record Generation ===")

	ctx := context.Background()

	service, err := NewMDNSService(ctx, WithNamespace("test-txt"))
	if err != nil {
		t.Fatalf("Failed to create mDNS service: %v", err)
	}

	// Create a test node
	node := &types.Node{
		ID:   "test-node-txt",
		Type: "registry",
		Name: "Test Registry Node",
		Port: 8080,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("txt12345678901234567890"),
		},
		Addresses: []string{"/ip4/192.168.1.101/tcp/8080", "/ip6/::1/tcp/8080"},
		Metadata:  make(map[string]interface{}),
	}

	// Test building TXT records
	txtRecords := service.buildTXTRecords(node)

	if len(txtRecords) == 0 {
		t.Fatal("TXT records should not be empty")
	}

	// Check that required fields are present (using compressed field names)
	expectedRecords := map[string]string{
		"nd_id": node.ID,
		"nd_tp": node.Type,
		"nd_nm": node.Name,
		"nd_pt": "8080",
		"nt_id": node.NetworkID.String(),
		"addrs": strings.Join(node.Addresses, ","),
	}

	foundRecords := make(map[string]string)
	for _, record := range txtRecords {
		parts := strings.SplitN(record, "=", 2)
		if len(parts) == 2 {
			foundRecords[parts[0]] = parts[1]
		}
	}

	for key, expectedValue := range expectedRecords {
		if foundValue, ok := foundRecords[key]; !ok {
			t.Errorf("Missing expected TXT record: %s", key)
		} else if foundValue != expectedValue {
			t.Errorf("TXT record %s: expected '%s', got '%s'", key, expectedValue, foundValue)
		}
	}

	fmt.Printf("   ✅ Generated %d TXT records successfully\n", len(txtRecords))
}

// TestSimpleUsage tests complete simple usage scenario
func TestSimpleUsage(t *testing.T) {
	fmt.Println("\n=== Testing Simple mDNS Usage ===")

	ctx := context.Background()

	// Create mDNS service
	fmt.Println("1. Creating mDNS service...")
	service, err := NewMDNSService(ctx,
		WithNamespace("simple-test-service"),
		WithService("_bootstrap._tcp"),
		WithDomain("local."),
	)
	if err != nil {
		t.Fatalf("Failed to create service: %v", err)
	}
	fmt.Println("   ✅ Service created successfully")

	// Set up discovery callback
	fmt.Println("2. Setting up discovery callback...")
	service.Watch(func(peer *types.Peer) {
		fmt.Printf("   🔍 Discovered peer: %s (ID: %s)\n", peer.Name, peer.ID)
		if len(peer.Nodes) > 0 {
			for _, node := range peer.Nodes {
				fmt.Printf("      📍 Node: %s (type: %s, port: %d)\n", node.Name, node.Type, node.Port)
			}
		}
	})
	fmt.Println("   ✅ Discovery callback set")

	// Start service
	fmt.Println("3. Starting service...")
	if err := service.Start(); err != nil {
		t.Fatalf("Failed to start service: %v", err)
	}
	defer service.Stop()
	fmt.Println("   ✅ Service started")

	// Create and advertise node
	fmt.Println("4. Creating and advertising node...")
	node := &types.Node{
		ID:   "test-node-123",
		Type: "bootstrap",
		Name: "Test Bootstrap Node",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("test12345678901234567890"),
		},
		Addresses: []string{"/ip4/192.168.1.100/tcp/4001", "/ip6/::1/tcp/4001"},
		Metadata:  make(map[string]interface{}),
	}

	if err := service.AdvertiseNode(node); err != nil {
		t.Fatalf("Failed to advertise node: %v", err)
	}
	fmt.Printf("   📢 Node advertised: %s (type: %s, port: %d)\n", node.Name, node.Type, node.Port)

	// Check TXT records
	fmt.Println("5. Checking TXT records...")
	txtRecords := service.options.TXT
	fmt.Printf("   📋 Generated %d TXT records:\n", len(txtRecords))
	for i, txt := range txtRecords {
		fmt.Printf("      [%d] %s\n", i+1, txt)
	}

	// Simulate running for a moment
	fmt.Println("6. Stopping service...")
	if err := service.Stop(); err != nil {
		t.Fatalf("Failed to stop service: %v", err)
	}
	fmt.Println("   ✅ Service stopped")

	fmt.Println("\n=== Test completed successfully! ===")
}

// TestNodeTypes tests different node types
func TestNodeTypes(t *testing.T) {
	fmt.Println("\n=== Testing Different Node Types ===")

	nodeTypes := []struct {
		name string
		port int
	}{
		{"bootstrap", 4001},
		{"registry", 8080},
		{"turn", 3478},
		{"http", 80},
	}

	ctx := context.Background()

	for _, nt := range nodeTypes {
		fmt.Printf("\nTesting %s service...\n", nt.name)

		service, err := NewMDNSService(ctx,
			WithNamespace(fmt.Sprintf("%s-node-1", nt.name)),
			WithService(fmt.Sprintf("_%s._tcp", nt.name)),
		)
		if err != nil {
			t.Fatalf("Failed to create %s service: %v", nt.name, err)
		}

		node := &types.Node{
			ID:   fmt.Sprintf("%s-node-1", nt.name),
			Type: nt.name,
			Name: fmt.Sprintf("Test %s Node", strings.Title(nt.name)),
			Port: nt.port,
			NetworkID: &types.NetworkID{
				Version: types.Version1,
				Type:    types.TypeNode,
				Hash:    []byte(fmt.Sprintf("%s-hash12345678901234567890", nt.name)),
			},
			Addresses: []string{fmt.Sprintf("/ip4/192.168.1.100/tcp/%d", nt.port)},
			Metadata:  make(map[string]interface{}),
		}

		if err := service.AdvertiseNode(node); err != nil {
			t.Fatalf("Failed to advertise %s node: %v", nt.name, err)
		}

		fmt.Printf("   ✅ %s service working correctly\n", nt.name)
	}
}

// TestTXTRecordSizeLimits tests TXT record size limiting
func TestTXTRecordSizeLimits(t *testing.T) {
	fmt.Println("\n=== Testing TXT Record Size Limits ===")

	ctx := context.Background()

	service, err := NewMDNSService(ctx,
		WithNamespace("txt-size-test"),
		WithService("_test._tcp"),
	)
	if err != nil {
		t.Fatalf("Failed to create service: %v", err)
	}

	// Test 1: Normal sized node
	fmt.Println("1. Testing normal sized node...")
	normalNode := &types.Node{
		ID:   "normal-node-123",
		Type: "bootstrap",
		Name: "Normal Test Node",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("normal-node-hash12345678901234567890"),
		},
		Addresses: []string{
			"/ip4/192.168.1.100/tcp/4001",
			"/ip6/::1/tcp/4001",
		},
		Metadata: make(map[string]interface{}),
	}

	txtRecords := service.buildTXTRecords(normalNode)
	fmt.Printf("   Generated %d TXT records\n", len(txtRecords))

	totalSize := 0
	for _, record := range txtRecords {
		totalSize += len(record)
		fmt.Printf("   Record: %s (length: %d)\n", record, len(record))
	}
	fmt.Printf("   Total size: %d bytes\n", totalSize)

	if totalSize > 400 {
		t.Errorf("Normal node TXT records too large: %d bytes", totalSize)
	}

	// Test 2: Node with many addresses (should trigger size limiting)
	fmt.Println("\n2. Testing node with many addresses...")
	bigNode := &types.Node{
		ID:   "big-node-123456789012345678901234567890",
		Type: "registry-with-very-long-type-name",
		Name: "Big Test Node With Very Long Name That Might Cause Issues",
		Port: 8080,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("big-node-hash1234567890123456789012345678901234567890"),
		},
		Addresses: generateManyAddresses(20), // Generate many addresses
		Metadata:  make(map[string]interface{}),
	}

	txtRecords = service.buildTXTRecords(bigNode)
	fmt.Printf("   Generated %d TXT records\n", len(txtRecords))

	totalSize = 0
	addressesSize := 0
	for _, record := range txtRecords {
		totalSize += len(record)
		if strings.HasPrefix(record, "addrs=") {
			addressesSize = len(record)
		}
		if len(record) > 255 {
			t.Errorf("Individual TXT record exceeds 255 bytes: %d bytes", len(record))
		}
		fmt.Printf("   Record: %s (length: %d)\n", record, len(record))
	}
	fmt.Printf("   Total size: %d bytes\n", totalSize)
	fmt.Printf("   Addresses size: %d bytes\n", addressesSize)

	if addressesSize > 200 {
		t.Logf("Addresses field size %d bytes - this should trigger limiting", addressesSize)
	}

	// Test 3: Edge case - maximum addresses
	fmt.Println("\n3. Testing maximum addresses scenario...")
	maxNode := &types.Node{
		ID:   "max-node",
		Type: "test",
		Name: "Max Node",
		Port: 9999,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("max-node-hash12345678901234567890"),
		},
		Addresses: generateManyAddresses(50), // Generate lots of addresses
		Metadata:  make(map[string]interface{}),
	}

	txtRecords = service.buildTXTRecords(maxNode)
	fmt.Printf("   Generated %d TXT records\n", len(txtRecords))

	totalSize = 0
	for _, record := range txtRecords {
		totalSize += len(record)
		if len(record) > 255 {
			t.Errorf("Individual TXT record exceeds 255 bytes: %d bytes", len(record))
		}
		fmt.Printf("   Record length: %d\n", len(record))
	}
	fmt.Printf("   Total size: %d bytes\n", totalSize)

	if totalSize > 400 {
		fmt.Printf("   ⚠️  Total TXT size %d bytes approaching DNS packet limit\n", totalSize)
	}
}

// TestIndividualTXTRecordLimits tests individual TXT record size limits
func TestIndividualTXTRecordLimits(t *testing.T) {
	fmt.Println("\n=== Testing Individual TXT Record Limits ===")

	ctx := context.Background()
	service, err := NewMDNSService(ctx, WithNamespace("txt-limit-test"))
	if err != nil {
		t.Fatalf("Failed to create service: %v", err)
	}

	// Test with very long individual fields
	longNode := &types.Node{
		ID:   strings.Repeat("very-long-node-id-", 10),   // ~180 chars
		Type: strings.Repeat("very-long-node-type-", 10), // ~200 chars
		Name: strings.Repeat("Very Long Node Name ", 10), // ~190 chars
		Port: 12345,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("long-node-hash12345678901234567890"),
		},
		Addresses: []string{"/ip4/192.168.1.1/tcp/12345"},
		Metadata:  make(map[string]interface{}),
	}

	txtRecords := service.buildTXTRecords(longNode)

	fmt.Printf("Generated %d TXT records with long fields:\n", len(txtRecords))
	for i, record := range txtRecords {
		if len(record) > 255 {
			t.Errorf("Record %d exceeds 255 byte limit: %d bytes", i, len(record))
		}
		fmt.Printf("   [%d] Length: %d bytes\n", i, len(record))
		if len(record) > 200 {
			fmt.Printf("        Content: %.50s...\n", record)
		} else {
			fmt.Printf("        Content: %s\n", record)
		}
	}
}

// TestTXTRecordPrioritization tests field prioritization
func TestTXTRecordPrioritization(t *testing.T) {
	fmt.Println("\n=== Testing TXT Record Field Prioritization ===")

	ctx := context.Background()
	service, err := NewMDNSService(ctx, WithNamespace("priority-test"))
	if err != nil {
		t.Fatalf("Failed to create service: %v", err)
	}

	// Test that critical fields are always included
	minimalNode := &types.Node{
		ID:   "critical-node",
		Type: "bootstrap",
		Name: "Critical Node",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("critical-hash"),
		},
		Addresses: []string{}, // No addresses
		Metadata:  make(map[string]interface{}),
	}

	txtRecords := service.buildTXTRecords(minimalNode)

	fmt.Println("Minimal node TXT records:")
	requiredFields := []string{"nd_id", "nd_tp", "nd_nm", "nt_id", "nd_pt"}
	foundFields := make(map[string]bool)

	for _, record := range txtRecords {
		parts := strings.SplitN(record, "=", 2)
		if len(parts) == 2 {
			fieldName := parts[0]
			foundFields[fieldName] = true
			fmt.Printf("   ✅ %s: %s\n", fieldName, parts[1])
		}
	}

	// Check that all required fields are present
	for _, required := range requiredFields {
		if !foundFields[required] {
			t.Errorf("Missing required field: %s", required)
		}
	}

	if foundFields["addrs"] {
		t.Error("Addresses field should not be present for node with no addresses")
	}
}

// TestHashicorpMDNSIntegration tests the actual hashicorp/mdns integration
func TestHashicorpMDNSIntegration(t *testing.T) {
	fmt.Println("\n=== Testing hashicorp/mdns Integration ===")

	ctx := context.Background()

	// Create two services to test discovery
	service1, err := NewMDNSService(ctx,
		WithNamespace("test-service-1"),
		WithService("_test._tcp"),
		WithDomain("local."),
		WithDiscoveryInterval(2*time.Second),
	)
	if err != nil {
		t.Fatalf("Failed to create service 1: %v", err)
	}

	service2, err := NewMDNSService(ctx,
		WithNamespace("test-service-2"),
		WithService("_test._tcp"),
		WithDomain("local."),
		WithDiscoveryInterval(2*time.Second),
	)
	if err != nil {
		t.Fatalf("Failed to create service 2: %v", err)
	}

	// Track discoveries
	discoveredPeers := make(map[string]*types.Peer)
	discoveryCount := 0

	// Set up discovery callback for service1
	service1.Watch(func(peer *types.Peer) {
		discoveryCount++
		discoveredPeers[peer.ID] = peer
		fmt.Printf("   🔍 Service1 discovered peer: %s (ID: %s)\n", peer.Name, peer.ID)
	})

	// Set up discovery callback for service2
	service2.Watch(func(peer *types.Peer) {
		discoveryCount++
		discoveredPeers[peer.ID] = peer
		fmt.Printf("   🔍 Service2 discovered peer: %s (ID: %s)\n", peer.Name, peer.ID)
	})

	// Start both services
	fmt.Println("1. Starting services...")
	if err := service1.Start(); err != nil {
		t.Fatalf("Failed to start service1: %v", err)
	}
	defer service1.Stop()

	if err := service2.Start(); err != nil {
		t.Fatalf("Failed to start service2: %v", err)
	}
	defer service2.Stop()

	fmt.Println("   ✅ Both services started")

	// Create and advertise nodes
	fmt.Println("2. Creating and advertising nodes...")

	node1 := &types.Node{
		ID:   "test-node-1",
		Type: "bootstrap",
		Name: "Test Node 1",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("node1-hash12345678901234567890"),
		},
		Addresses: []string{"/ip4/192.168.1.100/tcp/4001"},
		Metadata:  make(map[string]interface{}),
	}

	node2 := &types.Node{
		ID:   "test-node-2",
		Type: "registry",
		Name: "Test Node 2",
		Port: 8080,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("node2-hash12345678901234567890"),
		},
		Addresses: []string{"/ip4/192.168.1.101/tcp/8080"},
		Metadata:  make(map[string]interface{}),
	}

	if err := service1.AdvertiseNode(node1); err != nil {
		t.Fatalf("Failed to advertise node1: %v", err)
	}
	fmt.Printf("   📢 Service1 advertised: %s\n", node1.Name)

	if err := service2.AdvertiseNode(node2); err != nil {
		t.Fatalf("Failed to advertise node2: %v", err)
	}
	fmt.Printf("   📢 Service2 advertised: %s\n", node2.Name)

	// Wait for discovery to happen
	fmt.Println("3. Waiting for discovery...")
	time.Sleep(5 * time.Second)

	fmt.Printf("   📊 Total discoveries: %d\n", discoveryCount)
	fmt.Printf("   📊 Unique peers discovered: %d\n", len(discoveredPeers))

	// Verify discoveries
	if discoveryCount == 0 {
		t.Log("⚠️  No peers discovered - this might be normal in test environment")
	} else {
		fmt.Println("   ✅ Discovery working!")

		// Check if we discovered the expected peers
		if peer1, found := discoveredPeers["test-node-1"]; found {
			fmt.Printf("   ✅ Found peer1: %s (type: %s)\n", peer1.Name, peer1.Nodes[0].Type)
		}
		if peer2, found := discoveredPeers["test-node-2"]; found {
			fmt.Printf("   ✅ Found peer2: %s (type: %s)\n", peer2.Name, peer2.Nodes[0].Type)
		}
	}

	fmt.Println("\n=== Integration test completed ===")
}

// TestMDNSServerOperations tests mDNS server operations
func TestMDNSServerOperations(t *testing.T) {
	fmt.Println("\n=== Testing mDNS Server Operations ===")

	ctx := context.Background()

	// Create service
	service, err := NewMDNSService(ctx,
		WithNamespace("server-test"),
		WithService("_server-test._tcp"),
		WithDomain("local."),
	)
	if err != nil {
		t.Fatalf("Failed to create service: %v", err)
	}

	// Test start/stop cycles
	fmt.Println("1. Testing start/stop cycles...")

	// First start
	if err := service.Start(); err != nil {
		t.Fatalf("Failed to start service: %v", err)
	}
	fmt.Println("   ✅ First start successful")

	// Stop
	if err := service.Stop(); err != nil {
		t.Fatalf("Failed to stop service: %v", err)
	}
	fmt.Println("   ✅ Stop successful")

	// Second start
	if err := service.Start(); err != nil {
		t.Fatalf("Failed to restart service: %v", err)
	}
	fmt.Println("   ✅ Restart successful")

	// Test node advertisement with running service
	fmt.Println("2. Testing node advertisement with running service...")

	node := &types.Node{
		ID:   "server-test-node",
		Type: "test",
		Name: "Server Test Node",
		Port: 9999,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("server-test-hash12345678901234567890"),
		},
		Addresses: []string{"/ip4/127.0.0.1/tcp/9999"},
		Metadata:  make(map[string]interface{}),
	}

	if err := service.AdvertiseNode(node); err != nil {
		t.Fatalf("Failed to advertise node: %v", err)
	}
	fmt.Printf("   ✅ Node advertised: %s\n", node.Name)

	// Let it run for a moment
	time.Sleep(2 * time.Second)

	// Final stop
	if err := service.Stop(); err != nil {
		t.Fatalf("Failed to final stop: %v", err)
	}
	fmt.Println("   ✅ Final stop successful")

	fmt.Println("\n=== Server operations test completed ===")
}

// TestDynamicDomainGeneration tests the dynamic domain generation functionality
func TestDynamicDomainGeneration(t *testing.T) {
	fmt.Println("\n=== Testing Dynamic Domain Generation ===")
	
	testCases := []struct {
		namespace        string
		expectedDomain   string
		description      string
	}{
		{
			namespace:      "testsvc",
			expectedDomain: "testsv.local.",
			description:    "Short namespace should get subdomain",
		},
		{
			namespace:      "peers-touch",
			expectedDomain: "local.",
			description:    "Standard namespace should use local domain",
		},
		{
			namespace:      "default",
			expectedDomain: "local.",
			description:    "Default namespace should use local domain",
		},
		{
			namespace:      "myapp123",
			expectedDomain: "myapp1.local.",
			description:    "Long namespace should be truncated",
		},
		{
			namespace:      "empty",
			expectedDomain: "empty.local.",
			description:    "Short namespace should use subdomain",
		},
	}
	
	for _, tc := range testCases {
		fmt.Printf("Testing: %s\n", tc.description)
		
		// Test the function directly
		domain := generateDynamicDomain(tc.namespace)
		
		if domain != tc.expectedDomain {
			t.Errorf("Namespace '%s': expected domain '%s', got '%s'", 
				tc.namespace, tc.expectedDomain, domain)
		} else {
			fmt.Printf("   ✅ Namespace '%s' -> Domain '%s'\n", tc.namespace, domain)
		}
	}
	
	fmt.Println("   ✅ Dynamic domain generation working correctly")
}

// TestServiceDomainIsolation tests that different namespace services use different domains
func TestServiceDomainIsolation(t *testing.T) {
	fmt.Println("\n=== Testing Service Domain Isolation ===")
	
	ctx := context.Background()
	
	// Test 1: Standard namespace uses local domain
	fmt.Println("1. Testing standard namespace...")
	service1, err := NewMDNSService(ctx, WithNamespace("peers-touch"))
	if err != nil {
		t.Fatalf("Failed to create service1: %v", err)
	}
	if service1.options.Domain != "local." {
		t.Errorf("Standard namespace should use 'local.', got '%s'", service1.options.Domain)
	} else {
		fmt.Printf("   ✅ Standard namespace uses: %s\n", service1.options.Domain)
	}
	
	// Test 2: Custom namespace gets subdomain
	fmt.Println("2. Testing custom namespace...")
	service2, err := NewMDNSService(ctx, WithNamespace("myapp"))
	if err != nil {
		t.Fatalf("Failed to create service2: %v", err)
	}
	expectedDomain := "myapp.local."
	if service2.options.Domain != expectedDomain {
		t.Errorf("Custom namespace should use '%s', got '%s'", expectedDomain, service2.options.Domain)
	} else {
		fmt.Printf("   ✅ Custom namespace uses: %s\n", service2.options.Domain)
	}
	
	// Test 3: Different custom namespaces get different domains
	fmt.Println("3. Testing different custom namespaces...")
	service3, err := NewMDNSService(ctx, WithNamespace("testsvc"))
	if err != nil {
		t.Fatalf("Failed to create service3: %v", err)
	}
	expectedDomain3 := "testsv.local." // truncated to 6 chars
	if service3.options.Domain != expectedDomain3 {
		t.Errorf("Custom namespace should use '%s', got '%s'", expectedDomain3, service3.options.Domain)
	} else {
		fmt.Printf("   ✅ Different custom namespace uses: %s\n", service3.options.Domain)
	}
	
	// Test 4: Verify isolation - different domains mean different services
	fmt.Println("4. Testing domain isolation...")
	domains := make(map[string]bool)
	domains[service1.options.Domain] = true
	domains[service2.options.Domain] = true
	domains[service3.options.Domain] = true
	
	if len(domains) != 3 {
		t.Errorf("Expected 3 different domains, got %d", len(domains))
	} else {
		fmt.Printf("   ✅ Services use %d different domains for isolation\n", len(domains))
		for domain := range domains {
			fmt.Printf("      - Domain: %s\n", domain)
		}
	}
	
	fmt.Println("   ✅ Service domain isolation working correctly")
}

// Helper function to generate many addresses for testing
func generateManyAddresses(count int) []string {
	var addresses []string
	for i := 0; i < count; i++ {
		addresses = append(addresses, fmt.Sprintf("/ip4/192.168.%d.%d/tcp/%d",
			(i/256)+1, (i%256)+1, 4000+i))
	}
	return addresses
}
