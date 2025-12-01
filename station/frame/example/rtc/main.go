package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pion/webrtc/v4"
	"gopkg.in/yaml.v2"
)

type Config struct {
	SignalingURL string   `yaml:"signaling_url"`
	SelfID       string   `yaml:"self_id"`
	Role         string   `yaml:"role"`
	RemoteID     string   `yaml:"remote_id"`
	IceServers   []string `yaml:"ice_servers"`
}

type Signaling struct{ BaseURL string }

func (s *Signaling) post(path string, body map[string]interface{}) error {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, s.BaseURL+path, strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return io.ErrUnexpectedEOF
	}
	return nil
}

func (s *Signaling) get(path string) (map[string]interface{}, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(s.BaseURL + path)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, io.ErrUnexpectedEOF
	}
	var m map[string]interface{}
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Signaling) RegisterPeer(id, role string, addrs []string) error {
	return s.post("/chat/peer/register", map[string]interface{}{"id": id, "role": role, "addrs": addrs})
}

func (s *Signaling) PostOffer(sessionId, sdp string) error {
	return s.post("/chat/session/offer", map[string]interface{}{"id": sessionId, "sdp": sdp})
}

func (s *Signaling) GetOffer(sessionId string) (string, error) {
	m, err := s.get("/chat/session/offer?id=" + sessionId)
	if err != nil {
		return "", err
	}
	v, _ := m["sdp"].(string)
	return v, nil
}

func (s *Signaling) PostAnswer(sessionId, sdp string) error {
	return s.post("/chat/session/answer", map[string]interface{}{"id": sessionId, "sdp": sdp})
}

func (s *Signaling) GetAnswer(sessionId string) (string, error) {
	m, err := s.get("/chat/session/answer?id=" + sessionId)
	if err != nil {
		return "", err
	}
	v, _ := m["sdp"].(string)
	return v, nil
}

func (s *Signaling) PostCandidate(sessionId, cand, from string) error {
	return s.post("/chat/session/candidate", map[string]interface{}{"id": sessionId, "candidate": cand, "from": from})
}

func (s *Signaling) GetCandidates(sessionId, exclude string) ([]string, error) {
	path := "/chat/session/candidates?id=" + sessionId
	if exclude != "" {
		path += "&exclude=" + exclude
	}
	m, err := s.get(path)
	if err != nil {
		return nil, err
	}
	var res []string
	if v, ok := m["candidates"].([]interface{}); ok {
		for _, e := range v {
			if mm, ok := e.(map[string]interface{}); ok {
				if c, ok := mm["candidate"].(string); ok {
					res = append(res, c)
				}
			} else if s, ok := e.(string); ok {
				res = append(res, s)
			}
		}
	}
	return res, nil
}

func toString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}

type RTCPeer struct {
	cfg       Config
	signaling *Signaling
	pc        *webrtc.PeerConnection
	dc        *webrtc.DataChannel
	sessionId string
}

func (p *RTCPeer) initPC(sessionId string) error {
	p.sessionId = sessionId
	var ice []webrtc.ICEServer
	for _, u := range p.cfg.IceServers {
		ice = append(ice, webrtc.ICEServer{URLs: []string{u}})
	}
	conf := webrtc.Configuration{ICEServers: ice}
	me, err := webrtc.NewPeerConnection(conf)
	if err != nil {
		return err
	}
	p.pc = me
	p.pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		j := c.ToJSON()
		_ = p.signaling.PostCandidate(sessionId, j.Candidate, p.cfg.SelfID)
	})
	p.pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		p.dc = dc
		p.setupDC()
	})
	return nil
}

func (p *RTCPeer) setupDC() {
	if p.dc == nil {
		return
	}
	p.dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		os.Stdout.WriteString(string(msg.Data) + "\n")
	})
}

func (p *RTCPeer) createChannel() error {
	if p.pc == nil {
		return io.ErrUnexpectedEOF
	}
	dc, err := p.pc.CreateDataChannel("chat", nil)
	if err != nil {
		return err
	}
	p.dc = dc
	p.setupDC()
	return nil
}

func (p *RTCPeer) send(s string) error {
	if p.dc == nil {
		return io.ErrUnexpectedEOF
	}
	return p.dc.SendText(s)
}

func (p *RTCPeer) call(remote string) error {
	sid := p.cfg.SelfID + "-" + remote
	if err := p.initPC(sid); err != nil {
		return err
	}
	if err := p.createChannel(); err != nil {
		return err
	}
	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		return err
	}
	if err = p.pc.SetLocalDescription(offer); err != nil {
		return err
	}
	if err = p.signaling.PostOffer(sid, offer.SDP); err != nil {
		return err
	}
	var ans string
	for i := 0; i < 60 && ans == ""; i++ {
		time.Sleep(time.Second)
		a, _ := p.signaling.GetAnswer(sid)
		if a != "" {
			ans = a
			break
		}
	}
	if ans == "" {
		return io.ErrUnexpectedEOF
	}
	if err = p.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: ans}); err != nil {
		return err
	}
	time.Sleep(2 * time.Second)
	cands, _ := p.signaling.GetCandidates(sid, p.cfg.SelfID)
	for _, c := range cands {
		_ = p.pc.AddICECandidate(webrtc.ICECandidateInit{Candidate: c})
	}
	return nil
}

func (p *RTCPeer) answer(remote string) error {
	sid := remote + "-" + p.cfg.SelfID
	if err := p.initPC(sid); err != nil {
		return err
	}
	var off string
	for i := 0; i < 60 && off == ""; i++ {
		time.Sleep(time.Second)
		o, _ := p.signaling.GetOffer(sid)
		if o != "" {
			off = o
			break
		}
	}
	if off == "" {
		return io.ErrUnexpectedEOF
	}
	if err := p.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: off}); err != nil {
		return err
	}
	ans, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return err
	}
	if err = p.pc.SetLocalDescription(ans); err != nil {
		return err
	}
	if err = p.signaling.PostAnswer(sid, ans.SDP); err != nil {
		return err
	}
	time.Sleep(2 * time.Second)
	cands, _ := p.signaling.GetCandidates(sid, p.cfg.SelfID)
	for _, c := range cands {
		_ = p.pc.AddICECandidate(webrtc.ICECandidateInit{Candidate: c})
	}
	return nil
}

func loadConfig(path string) (Config, error) {
	var cfg Config
	b, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	err = yaml.Unmarshal(b, &cfg)
	return cfg, err
}

func main() {
	var cfgPath string
	var mode string
	flag.StringVar(&cfgPath, "config", "conf/rtc.yml", "config file path")
	flag.StringVar(&mode, "mode", "call", "call or answer")
	flag.Parse()
	cfg, err := loadConfig(cfgPath)
	if err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	sig := &Signaling{BaseURL: cfg.SignalingURL}
	_ = sig.RegisterPeer(cfg.SelfID, cfg.Role, []string{})
	peer := &RTCPeer{cfg: cfg, signaling: sig}
	if mode == "answer" {
		if err = peer.answer(cfg.RemoteID); err != nil {
			os.Stderr.WriteString(err.Error() + "\n")
			os.Exit(1)
		}
	} else {
		if err = peer.call(cfg.RemoteID); err != nil {
			os.Stderr.WriteString(err.Error() + "\n")
			os.Exit(1)
		}
	}
	r := bufio.NewReader(os.Stdin)
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			break
		}
		s := strings.TrimSpace(line)
		if s == "" {
			continue
		}
		_ = peer.send(s)
	}
}
