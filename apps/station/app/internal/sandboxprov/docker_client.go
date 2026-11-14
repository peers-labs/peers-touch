package sandboxprov

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// dockerSock is the conventional Engine API socket inside the provisioner
// container (mounted from the host).
const dockerSock = "/var/run/docker.sock"

// dockerClient is a minimal stdlib-only Docker Engine API client for the PTY
// lifecycle. It uses the HTTP API over the unix socket and a hijacked raw
// connection for the bidirectional exec stream, avoiding the heavy SDK.
type dockerClient struct {
	sock    string
	http    *http.Client
	dialer  func(ctx context.Context) (net.Conn, error)
	version string
}

func newDockerClient() *dockerClient {
	dialer := func(ctx context.Context) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "unix", dockerSock)
	}
	c := &dockerClient{
		sock:    dockerSock,
		version: "v1.43",
		dialer:  dialer,
	}
	c.http = &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return dialer(ctx)
			},
		},
	}
	return c
}

func (c *dockerClient) doJSON(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("docker api %s: %w", path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("docker api %s -> %d: %s", path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("docker api %s bad json: %w", path, err)
		}
	}
	return nil
}

type execCreateBody struct {
	AttachStdin  bool     `json:"AttachStdin"`
	AttachStdout bool     `json:"AttachStdout"`
	AttachStderr bool     `json:"AttachStderr"`
	Tty          bool     `json:"Tty"`
	Cmd          []string `json:"Cmd"`
	WorkingDir   string   `json:"WorkingDir,omitempty"`
	User         string   `json:"User,omitempty"`
}

type execCreateResponse struct {
	ID string `json:"Id"`
}

// execInspectResponse is the subset of /exec/{id}/json used for lifecycle.
type execInspectResponse struct {
	Running  bool `json:"Running"`
	ExitCode int  `json:"ExitCode"`
}

// execCreate creates a TTY-backed exec instance in the container.
func (c *dockerClient) execCreate(ctx context.Context, container string, cmd []string, cwd, user string) (string, error) {
	var resp execCreateResponse
	err := c.doJSON(ctx, http.MethodPost,
		fmt.Sprintf("/%s/containers/%s/exec", c.version, container),
		execCreateBody{
			AttachStdin: true, AttachStdout: true, AttachStderr: true,
			Tty: true, Cmd: cmd, WorkingDir: cwd, User: user,
		}, &resp)
	if err != nil {
		return "", err
	}
	if resp.ID == "" {
		return "", fmt.Errorf("docker exec create returned empty id")
	}
	return resp.ID, nil
}

// execStart opens the hijacked bidirectional stream for a TTY exec. With
// Tty:true the stream is raw bytes (no 8-byte multiplexed header): output
// from the PTY and input to it share this one connection.
func (c *dockerClient) execStart(ctx context.Context, execID string) (net.Conn, error) {
	conn, err := c.dialer(ctx)
	if err != nil {
		return nil, fmt.Errorf("dial docker socket: %w", err)
	}
	payload := `{"Detach":false,"Tty":true}`
	// Docker hijacks exec/start on the endpoint itself (no Upgrade headers);
	// adding Upgrade:tcp makes the daemon take a different path and can drop
	// stdin. A plain POST returns 200 followed by the raw bidirectional stream.
	request := fmt.Sprintf(
		"POST /%s/exec/%s/start HTTP/1.1\r\n"+
			"Host: docker\r\n"+
			"Content-Type: application/json\r\n"+
			"Content-Length: %d\r\n\r\n%s",
		c.version, execID, len(payload), payload,
	)
	if _, err := conn.Write([]byte(request)); err != nil {
		conn.Close()
		return nil, fmt.Errorf("write exec start: %w", err)
	}
	br := bufio.NewReader(conn)
	status, err := http.ReadResponse(br, &http.Request{Method: http.MethodPost})
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("read exec start response: %w", err)
	}
	if status.StatusCode != http.StatusSwitchingProtocols && status.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(status.Body, 1<<16))
		status.Body.Close()
		conn.Close()
		return nil, fmt.Errorf("exec start -> %d: %s", status.StatusCode, strings.TrimSpace(string(raw)))
	}
	// For a hijacked stream (101 or raw-stream 200) the response body IS the
	// bidirectional PTY connection; it must NOT be closed here or the exec
	// dies immediately. After a 101 the remainder of the buffered reader (if
	// any) already belongs to the PTY stream.
	if buffered := br.Buffered(); buffered > 0 {
		peek, _ := br.Peek(buffered)
		return &prefixConn{Conn: conn, prefix: append([]byte(nil), peek...)}, nil
	}
	return conn, nil
}

func (c *dockerClient) execResize(ctx context.Context, execID string, cols, rows uint32) error {
	path := fmt.Sprintf("/%s/exec/%s/resize?w=%d&h=%d", c.version, execID, cols, rows)
	return c.doJSON(ctx, http.MethodPost, path, nil, nil)
}

func (c *dockerClient) execInspect(ctx context.Context, execID string) (*execInspectResponse, error) {
	var resp execInspectResponse
	if err := c.doJSON(ctx, http.MethodGet,
		fmt.Sprintf("/%s/exec/%s/json", c.version, execID), nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// prefixConn returns any over-read buffered bytes before the raw connection.
type prefixConn struct {
	net.Conn
	prefix []byte
}

func (p *prefixConn) Read(b []byte) (int, error) {
	if len(p.prefix) > 0 {
		n := copy(b, p.prefix)
		p.prefix = p.prefix[n:]
		return n, nil
	}
	return p.Conn.Read(b)
}
