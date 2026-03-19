package native

import (
	"context"
	"fmt"
	"io/ioutil"
	"net/http"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativeserver "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server"
	nattransport "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/transport"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
	"github.com/stretchr/testify/assert"
)

// use native transport for e2e test

// --- Test ---

func TestServer_Start(t *testing.T) {
	// Define test handlers
	httpTestHandler := func(ctx context.Context, req server.RequestV2, rsp server.ResponseV2) error {
		fmt.Fprint(rsp, "hello http")
		return nil
	}

	streamTestHandler := func(ctx context.Context, s transport.Socket) error {
		var msg transport.Message
		err := s.Recv(&msg)
		assert.NoError(t, err)
		assert.Equal(t, "hello stream", string(msg.Body))

		resp := &transport.Message{Body: []byte("echo:hello stream")}
		err = s.Send(resp)
		assert.NoError(t, err)
		return nil
	}

	// Setup server
	httpAddr := "127.0.0.1:18080"
	p2pAddr := "/ip4/127.0.0.1/tcp/28080"

	// set root ctx first
	ctx := context.Background()

	// Initialize options properly - use the server wrapper pattern
	option.GetOptions(option.WithRootCtx(ctx), server.WithAddress(httpAddr))

	p2pTransport := nattransport.NewTransport(transport.Addrs(p2pAddr), transport.Secure(false), nattransport.EnableRelay())

	// Create server with proper options
	s := nativeserver.NewServer()
	s.SetTransport(p2pTransport)
	s.AddHTTPHandlers(server.NewHandlerV2("http", "/test", server.GETV2, server.HandlerTypeHTTP, httpTestHandler))
	s.AddStreamHandlers(server.NewStreamHandlerV2("ps", "test-stream", server.ANYV2, server.HandlerTypePS, streamTestHandler))

	// Initialize server
	err := s.Init()
	assert.NoError(t, err)

	go func() {
		err := s.Start(ctx)
		if err != nil && err != http.ErrServerClosed {
			assert.NoError(t, err)
		}
	}()

	// Wait for server to start
	time.Sleep(time.Second)

	// Test HTTP handler
	httpResp, err := http.Get("http://" + httpAddr + "/test")
	assert.NoError(t, err)
	if httpResp != nil {
		defer httpResp.Body.Close()
		body, err := ioutil.ReadAll(httpResp.Body)
		assert.NoError(t, err)
		assert.Equal(t, "hello http", string(body))
	}

	// Test Stream handler via native transport
	// reset global transport addrs for client to avoid self-dial
	option.GetOptions(transport.Addrs())
	// client transport
	clientTr := nattransport.NewTransport(transport.Secure(false), nattransport.EnableRelay())
	err = clientTr.Init()
	assert.NoError(t, err)

	remoteAddr, buildErr := nattransport.DialAddr(p2pTransport)
	assert.NoError(t, buildErr)

	c, err := clientTr.Dial(remoteAddr)
	assert.NoError(t, err)
	defer c.Close()

	err = c.Send(&transport.Message{Header: map[string]string{"service": "test-stream"}, Body: []byte("hello stream")})
	assert.NoError(t, err)

	var r transport.Message
	err = c.Recv(&r)
	assert.NoError(t, err)
	assert.Equal(t, "echo:hello stream", string(r.Body))

	// Stop server
	err = s.Stop(ctx)
	assert.NoError(t, err)
}
