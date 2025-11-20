package native

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

type testEnv struct {
	srv        transport.Transport
	cli        transport.Transport
	listener   transport.Listener
	serverID   string
	serverAddr string
	dialAddr   string
	done       chan struct{}
}

func setupServer(t *testing.T) *testEnv {
	t.Helper()
	srv := NewTransport()
	if err := srv.Init(); err != nil {
		t.Fatal(err)
	}

	lt, ok := srv.(*libp2pTransport)
	if !ok {
		t.Fatal("unexpected transport type")
	}

	addrs := lt.host.Addrs()
	if len(addrs) == 0 {
		t.Fatal("no listen addrs")
	}

	addr := addrs[0].String()
	t.Logf("server peer=%s addrs=%v choose=%s", lt.host.ID().String(), addrs, addr)
	l, err := srv.Listen(addr)
	if err != nil {
		t.Fatal(err)
	}
	env := &testEnv{srv: srv, listener: l, serverID: lt.host.ID().String(), serverAddr: addr, done: make(chan struct{})}
	go func() {
		l.Accept(func(sock transport.Socket) {
			t.Logf("server accepts local=%s remote=%s", sock.Local(), sock.Remote())
			var m transport.Message
			if err := sock.Recv(&m); err != nil {
				t.Error(err)
				return
			}
			t.Logf("server recvs header=%v body_len=%d", m.Header, len(m.Body))
			rsp := transport.Message{Header: map[string]string{"Status": "200"}, Body: append([]byte("echo:"), m.Body...)}
			if err := sock.Send(&rsp); err != nil {
				t.Error(err)
				return
			}
			t.Logf("send header=%v body_len=%d", rsp.Header, len(rsp.Body))
			_ = sock.Close()
			close(env.done)
		})
	}()
	return env
}

func setupClient(t *testing.T, env *testEnv) {
	t.Helper()
	cli := NewTransport()
	if err := cli.Init(); err != nil {
		t.Fatal(err)
	}
	env.cli = cli
	env.dialAddr = env.serverAddr + "/p2p/" + env.serverID
	t.Logf("client dial=%s", env.dialAddr)
}

func exchange(t *testing.T, env *testEnv) {
	t.Helper()
	c, err := env.cli.Dial(env.dialAddr)
	if err != nil {
		t.Fatal(err)
	}

	msg := transport.Message{Header: map[string]string{"Path": "/echo", "Method": "POST"}, Body: []byte("hello")}
	t.Logf("client send header=%v body_len=%d", msg.Header, len(msg.Body))
	if err := c.Send(&msg); err != nil {
		t.Fatal(err)
	}
	var r transport.Message
	if err := c.Recv(&r); err != nil {
		t.Fatal(err)
	}
	t.Logf("client recv header=%v body_len=%d", r.Header, len(r.Body))

	if string(r.Body) != "echo:hello" {
		t.Fatalf("unexpected body: %s", string(r.Body))
	}
	_ = c.Close()
	_ = env.listener.Close()

	select {
	case <-env.done:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout")
	}
}

func TestTransportClientServer(t *testing.T) {
	env := setupServer(t)
	setupClient(t, env)
	exchange(t, env)
}
