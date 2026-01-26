package signaling

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type signalingURL struct{ name, path string }

func (u signalingURL) SubPath() string { return u.path }
func (u signalingURL) Name() string    { return u.name }

type peerInfo struct {
	ID        string   `json:"id"`
	Role      string   `json:"role"`
	Addrs     []string `json:"addrs"`
	UpdatedAt int64    `json:"updated_at"`
}

type session struct {
	ID        string `json:"id"`
	A         string `json:"a"`
	B         string `json:"b"`
	CreatedAt int64  `json:"created_at"`
}

type SubServer struct {
	opts       *Options
	status     server.Status
	addrs      []string
	mu         sync.RWMutex
	peers      map[string]peerInfo
	sessions   map[string]session
	offers     map[string]string
	answers    map[string]string
	candidates map[string][]candReq
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	s.peers = map[string]peerInfo{}
	s.sessions = map[string]session{}
	s.offers = map[string]string{}
	s.answers = map[string]string{}
	s.candidates = map[string][]candReq{}
	return nil
}

func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *SubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *SubServer) Name() string               { return "signaling" }
func (s *SubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *SubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *SubServer) Status() server.Status { return s.status }

func (s *SubServer) Handlers() []server.Handler {
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	return []server.Handler{
		server.NewHTTPHandler("ice-peer-register", "/api/v1/ice/peer/register", server.POST, server.HTTPHandlerFunc(s.handlePeerRegister), jwtWrapper),
		server.NewHTTPHandler("ice-peer-unregister", "/api/v1/ice/peer/unregister", server.POST, server.HTTPHandlerFunc(s.handlePeerUnregister), jwtWrapper),
		server.NewHTTPHandler("ice-peer-get", "/api/v1/ice/peer/get", server.GET, server.HTTPHandlerFunc(s.handlePeerGet)),
		server.NewHTTPHandler("ice-peers", "/api/v1/ice/peers", server.GET, server.HTTPHandlerFunc(s.handlePeers)),
		server.NewHTTPHandler("ice-stats", "/api/v1/ice/stats", server.GET, server.HTTPHandlerFunc(s.handleStats)),
		server.NewHTTPHandler("ice-sessions", "/api/v1/ice/sessions", server.GET, server.HTTPHandlerFunc(s.handleSessions)),
		server.NewHTTPHandler("ice-session-new", "/api/v1/ice/session/new", server.POST, server.HTTPHandlerFunc(s.handleSessionNew), jwtWrapper),
		server.NewHTTPHandler("ice-session-get", "/api/v1/ice/session/get", server.GET, server.HTTPHandlerFunc(s.handleSessionGet)),
		server.NewHTTPHandler("ice-session-offer-post", "/api/v1/ice/session/offer", server.POST, server.HTTPHandlerFunc(s.handleOfferPost), jwtWrapper),
		server.NewHTTPHandler("ice-session-offer-get", "/api/v1/ice/session/offer", server.GET, server.HTTPHandlerFunc(s.handleOfferGet)),
		server.NewHTTPHandler("ice-session-answer-post", "/api/v1/ice/session/answer", server.POST, server.HTTPHandlerFunc(s.handleAnswerPost), jwtWrapper),
		server.NewHTTPHandler("ice-session-answer-get", "/api/v1/ice/session/answer", server.GET, server.HTTPHandlerFunc(s.handleAnswerGet)),
		server.NewHTTPHandler("ice-session-candidate-post", "/api/v1/ice/session/candidate", server.POST, server.HTTPHandlerFunc(s.handleCandidatePost), jwtWrapper),
		server.NewHTTPHandler("ice-session-candidates-get", "/api/v1/ice/session/candidates", server.GET, server.HTTPHandlerFunc(s.handleCandidatesGet)),
	}
}

func NewSignalingSubServer(opts ...option.Option) server.Subserver {
	return &SubServer{
		opts:   option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

type reqRegister struct {
	ID    string   `json:"id"`
	Role  string   `json:"role"`
	Addrs []string `json:"addrs"`
}

type reqUnregister struct {
	ID string `json:"id"`
}

func (s *SubServer) handlePeerRegister(w http.ResponseWriter, r *http.Request) {
	var req reqRegister
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.ID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	pi := peerInfo{ID: req.ID, Role: req.Role, Addrs: req.Addrs, UpdatedAt: time.Now().Unix()}
	s.mu.Lock()
	s.peers[req.ID] = pi
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(pi)
}

func (s *SubServer) handlePeerUnregister(w http.ResponseWriter, r *http.Request) {
	var req reqUnregister
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.ID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	delete(s.peers, req.ID)
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *SubServer) handlePeerGet(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	s.mu.RLock()
	pi, ok := s.peers[id]
	s.mu.RUnlock()
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if time.Now().Unix()-pi.UpdatedAt > 60 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(pi)
}

func (s *SubServer) handlePeers(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	res := make([]peerInfo, 0, len(s.peers))
	for _, v := range s.peers {
		res = append(res, v)
	}
	s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func (s *SubServer) handleSessions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("peer")
	s.mu.RLock()
	out := make([]session, 0, len(s.sessions))
	for _, v := range s.sessions {
		if q == "" || v.A == q || v.B == q {
			out = append(out, v)
		}
	}
	s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (s *SubServer) handleStats(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	peersCount := len(s.peers)
	sessionsCount := len(s.sessions)
	offersCount := len(s.offers)
	answersCount := len(s.answers)
	candidatesCount := 0
	for _, list := range s.candidates {
		candidatesCount += len(list)
	}
	s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peers":      peersCount,
		"sessions":   sessionsCount,
		"offers":     offersCount,
		"answers":    answersCount,
		"candidates": candidatesCount,
		"status":     s.status,
	})
}

type reqSessionNew struct {
	A string `json:"a"`
	B string `json:"b"`
}

func (s *SubServer) handleSessionNew(w http.ResponseWriter, r *http.Request) {
	var req reqSessionNew
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.A == "" || req.B == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	sid := req.A + "-" + req.B
	sess := session{ID: sid, A: req.A, B: req.B, CreatedAt: time.Now().Unix()}
	s.mu.Lock()
	s.sessions[sid] = sess
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sess)
}

func (s *SubServer) handleSessionGet(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	s.mu.RLock()
	sess, ok := s.sessions[id]
	s.mu.RUnlock()
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sess)
}

type sdpReq struct {
	ID  string `json:"id"`
	SDP string `json:"sdp"`
}

type candReq struct {
	ID        string `json:"id"`
	Candidate string `json:"candidate"`
	Mid       string `json:"mid,omitempty"`
	MLine     int    `json:"mline,omitempty"`
	From      string `json:"from,omitempty"`
}

func (s *SubServer) handleOfferPost(w http.ResponseWriter, r *http.Request) {
	var req sdpReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.ID == "" || req.SDP == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.offers[req.ID] = req.SDP
	delete(s.answers, req.ID)
	delete(s.candidates, req.ID)
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *SubServer) handleOfferGet(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	s.mu.RLock()
	sdp, ok := s.offers[id]
	s.mu.RUnlock()
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id, "sdp": sdp})
}

func (s *SubServer) handleAnswerPost(w http.ResponseWriter, r *http.Request) {
	var req sdpReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.ID == "" || req.SDP == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.answers[req.ID] = req.SDP
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *SubServer) handleAnswerGet(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	s.mu.RLock()
	sdp, ok := s.answers[id]
	s.mu.RUnlock()
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id, "sdp": sdp})
}

func (s *SubServer) handleCandidatePost(w http.ResponseWriter, r *http.Request) {
	var req candReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.ID == "" || req.Candidate == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.candidates[req.ID] = append(s.candidates[req.ID], req)
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *SubServer) handleCandidatesGet(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	exclude := r.URL.Query().Get("exclude")
	s.mu.RLock()
	raw := s.candidates[id]
	s.mu.RUnlock()
	if exclude != "" {
		filtered := make([]candReq, 0, len(raw))
		for _, c := range raw {
			if c.From != exclude {
				filtered = append(filtered, c)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "candidates": filtered})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "candidates": raw})
}
