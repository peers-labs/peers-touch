package peer

import (
	"encoding/json"
	"net/http"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/gorilla/mux"
)

// RegisterRegistryEndpoints registers all registry-related HTTP endpoints
func RegisterRegistryEndpoints(router *mux.Router) {
	// Peer management endpoints
	router.HandleFunc("/api/v1/peers", ListPeersHandler).Methods("GET")
	router.HandleFunc("/api/v1/peers/{id}", GetPeerHandler).Methods("GET")
	router.HandleFunc("/api/v1/peers", RegisterPeerHandler).Methods("POST")
	router.HandleFunc("/api/v1/peers/{id}", DeregisterPeerHandler).Methods("DELETE")
	
	// Registry management endpoints
	router.HandleFunc("/api/v1/registry/status", GetRegistryStatusHandler).Methods("GET")
}

// ListPeersResponse represents the response for listing peers
type ListPeersResponse struct {
	Peers []*registry.Peer `json:"peers"`
	Total int              `json:"total"`
}

// PeerResponse represents a single peer response
type PeerResponse struct {
	Peer *registry.Peer `json:"peer"`
}

// RegistryStatusResponse represents registry status
type RegistryStatusResponse struct {
	HasDefaultRegistry bool   `json:"has_default_registry"`
	RegistryCount      int    `json:"registry_count"`
	Namespace          string `json:"namespace"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// ListPeersHandler handles GET /api/v1/peers
func ListPeersHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	// Parse query parameters
	var opts []registry.GetOption
	
	// Check for 'me' parameter
	if r.URL.Query().Get("me") == "true" {
		opts = append(opts, registry.GetMe())
	}
	
	// Check for 'name' parameter
	if name := r.URL.Query().Get("name"); name != "" {
		opts = append(opts, registry.WithName(name))
	}
	
	// Check for 'id' parameter
	if id := r.URL.Query().Get("id"); id != "" {
		opts = append(opts, registry.WithId(id))
	}
	
	peers, err := registry.ListPeers(ctx, opts...)
	if err != nil {
		log.Errorf(ctx, "[ListPeersHandler] Failed to list peers: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to list peers", err.Error())
		return
	}
	
	response := ListPeersResponse{
		Peers: peers,
		Total: len(peers),
	}
	
	respondWithJSON(w, http.StatusOK, response)
}

// GetPeerHandler handles GET /api/v1/peers/{id}
func GetPeerHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	peerID := vars["id"]
	
	if peerID == "" {
		respondWithError(w, http.StatusBadRequest, "Peer ID is required", "")
		return
	}
	
	peer, err := registry.GetPeer(ctx, registry.WithId(peerID))
	if err != nil {
		if registry.IsNotFound(err) {
			respondWithError(w, http.StatusNotFound, "Peer not found", err.Error())
		} else {
			log.Errorf(ctx, "[GetPeerHandler] Failed to get peer %s: %v", peerID, err)
			respondWithError(w, http.StatusInternalServerError, "Failed to get peer", err.Error())
		}
		return
	}
	
	response := PeerResponse{
		Peer: peer,
	}
	
	respondWithJSON(w, http.StatusOK, response)
}

// RegisterPeerHandler handles POST /api/v1/peers
func RegisterPeerHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	var peer registry.Peer
	if err := json.NewDecoder(r.Body).Decode(&peer); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid JSON payload", err.Error())
		return
	}
	
	// Validate required fields
	if peer.ID == "" {
		respondWithError(w, http.StatusBadRequest, "Peer ID is required", "")
		return
	}
	
	// Register the peer using the default registry
	if registry.GetDefaultRegistry() == nil {
		respondWithError(w, http.StatusServiceUnavailable, "No registry available", "")
		return
	}
	
	err := registry.GetDefaultRegistry().Register(ctx, &peer)
	if err != nil {
		if registry.IsPeerExists(err) {
			respondWithError(w, http.StatusConflict, "Peer already exists", err.Error())
		} else {
			log.Errorf(ctx, "[RegisterPeerHandler] Failed to register peer %s: %v", peer.ID, err)
			respondWithError(w, http.StatusInternalServerError, "Failed to register peer", err.Error())
		}
		return
	}
	
	response := PeerResponse{
		Peer: &peer,
	}
	
	respondWithJSON(w, http.StatusCreated, response)
}

// DeregisterPeerHandler handles DELETE /api/v1/peers/{id}
func DeregisterPeerHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	peerID := vars["id"]
	
	if peerID == "" {
		respondWithError(w, http.StatusBadRequest, "Peer ID is required", "")
		return
	}
	
	// Get the peer first
	peer, err := registry.GetPeer(ctx, registry.WithId(peerID))
	if err != nil {
		if registry.IsNotFound(err) {
			respondWithError(w, http.StatusNotFound, "Peer not found", err.Error())
		} else {
			log.Errorf(ctx, "[DeregisterPeerHandler] Failed to get peer %s: %v", peerID, err)
			respondWithError(w, http.StatusInternalServerError, "Failed to get peer", err.Error())
		}
		return
	}
	
	// Deregister the peer
	if registry.GetDefaultRegistry() == nil {
		respondWithError(w, http.StatusServiceUnavailable, "No registry available", "")
		return
	}
	
	err = registry.GetDefaultRegistry().Deregister(ctx, peer)
	if err != nil {
		log.Errorf(ctx, "[DeregisterPeerHandler] Failed to deregister peer %s: %v", peerID, err)
		respondWithError(w, http.StatusInternalServerError, "Failed to deregister peer", err.Error())
		return
	}
	
	w.WriteHeader(http.StatusNoContent)
}

// GetRegistryStatusHandler handles GET /api/v1/registry/status
func GetRegistryStatusHandler(w http.ResponseWriter, r *http.Request) {
	response := RegistryStatusResponse{
		HasDefaultRegistry: registry.GetDefaultRegistry() != nil,
		RegistryCount:      len(registry.GetRegistries()),
		Namespace:          registry.DefaultPeersNetworkNamespace,
	}
	
	respondWithJSON(w, http.StatusOK, response)
}

// Helper functions

func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

func respondWithError(w http.ResponseWriter, code int, message, details string) {
	errorResp := ErrorResponse{
		Error:   message,
		Message: details,
	}
	respondWithJSON(w, code, errorResp)
}