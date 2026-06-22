package transport

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/apps/applets/note/service/application"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/domain"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/model"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const OwnerHeader = "X-Peers-Actor-Id"

type Handler struct {
	service *application.Service
}

type errorResponse struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Details map[string]string `json:"details,omitempty"`
}

func NewHandler(service *application.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	ctx := request.Context()
	ownerID := strings.TrimSpace(request.Header.Get(OwnerHeader))

	if request.URL.Path == "/healthz" && request.Method == http.MethodGet {
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	if request.URL.Path == "/v1/notes:search" && request.Method == http.MethodGet {
		h.handleSearch(ctx, writer, request, ownerID)
		return
	}

	if request.URL.Path == "/v1/notes" {
		switch request.Method {
		case http.MethodGet:
			h.handleList(ctx, writer, request, ownerID)
		case http.MethodPost:
			h.handleCreate(ctx, writer, request, ownerID)
		default:
			writeError(writer, http.StatusMethodNotAllowed, "ERROR_CODE_METHOD_NOT_ALLOWED", "method not allowed")
		}
		return
	}

	noteID, action, ok := parseNotePath(request.URL.Path)
	if !ok {
		writeError(writer, http.StatusNotFound, "ERROR_CODE_NOTE_NOT_FOUND", "note route not found")
		return
	}

	switch {
	case action == "" && request.Method == http.MethodGet:
		h.handleGet(ctx, writer, request, ownerID, noteID)
	case action == "" && request.Method == http.MethodPatch:
		h.handleUpdate(ctx, writer, request, ownerID, noteID)
	case action == "" && request.Method == http.MethodDelete:
		h.handleDelete(ctx, writer, ownerID, noteID)
	case action == "restore" && request.Method == http.MethodPost:
		h.handleRestore(ctx, writer, ownerID, noteID)
	default:
		writeError(writer, http.StatusMethodNotAllowed, "ERROR_CODE_METHOD_NOT_ALLOWED", "method not allowed")
	}
}

func (h *Handler) handleCreate(ctx context.Context, writer http.ResponseWriter, request *http.Request, ownerID string) {
	var req model.CreateNoteRequest
	if !bindProto(writer, request, &req) {
		return
	}
	resp, err := h.service.Create(ctx, ownerID, &req)
	writeProtoOrError(writer, http.StatusCreated, resp, err)
}

func (h *Handler) handleGet(ctx context.Context, writer http.ResponseWriter, request *http.Request, ownerID string, noteID string) {
	req := &model.GetNoteRequest{
		NoteId:         noteID,
		IncludeDeleted: parseBool(request.URL.Query().Get("include_deleted")),
	}
	resp, err := h.service.Get(ctx, ownerID, req)
	writeProtoOrError(writer, http.StatusOK, resp, err)
}

func (h *Handler) handleList(ctx context.Context, writer http.ResponseWriter, request *http.Request, ownerID string) {
	query := request.URL.Query()
	req := &model.ListNotesRequest{
		PageSize:       parseInt32(query.Get("page_size")),
		PageToken:      query.Get("page_token"),
		OrderBy:        query.Get("order_by"),
		IncludeDeleted: parseBool(query.Get("include_deleted")),
	}
	resp, err := h.service.List(ctx, ownerID, req)
	writeProtoOrError(writer, http.StatusOK, resp, err)
}

func (h *Handler) handleUpdate(ctx context.Context, writer http.ResponseWriter, request *http.Request, ownerID string, noteID string) {
	var req model.UpdateNoteRequest
	if !bindProto(writer, request, &req) {
		return
	}
	req.NoteId = noteID
	resp, err := h.service.Update(ctx, ownerID, &req)
	writeProtoOrError(writer, http.StatusOK, resp, err)
}

func (h *Handler) handleDelete(ctx context.Context, writer http.ResponseWriter, ownerID string, noteID string) {
	resp, err := h.service.Delete(ctx, ownerID, &model.DeleteNoteRequest{NoteId: noteID})
	writeProtoOrError(writer, http.StatusOK, resp, err)
}

func (h *Handler) handleRestore(ctx context.Context, writer http.ResponseWriter, ownerID string, noteID string) {
	resp, err := h.service.Restore(ctx, ownerID, &model.RestoreNoteRequest{NoteId: noteID})
	writeProtoOrError(writer, http.StatusOK, resp, err)
}

func (h *Handler) handleSearch(ctx context.Context, writer http.ResponseWriter, request *http.Request, ownerID string) {
	query := request.URL.Query()
	req := &model.SearchNotesRequest{
		Query:     query.Get("q"),
		PageSize:  parseInt32(query.Get("page_size")),
		PageToken: query.Get("page_token"),
		OrderBy:   query.Get("order_by"),
	}
	resp, err := h.service.Search(ctx, ownerID, req)
	writeProtoOrError(writer, http.StatusOK, resp, err)
}

func bindProto(writer http.ResponseWriter, request *http.Request, target proto.Message) bool {
	defer request.Body.Close()
	body, err := io.ReadAll(request.Body)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_FAILED_TO_READ_BODY", "failed to read request body")
		return false
	}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(body, target); err != nil {
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_INVALID_REQUEST_BODY", "invalid request body")
		return false
	}
	return true
}

func parseNotePath(path string) (string, string, bool) {
	suffix := strings.TrimPrefix(path, "/v1/notes/")
	if suffix == path || suffix == "" {
		return "", "", false
	}
	if strings.HasSuffix(suffix, ":restore") {
		return strings.TrimSuffix(suffix, ":restore"), "restore", true
	}
	if strings.Contains(suffix, "/") || strings.Contains(suffix, ":") {
		return "", "", false
	}
	return suffix, "", true
}

func parseInt32(value string) int32 {
	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil {
		return 0
	}
	return int32(parsed)
}

func parseBool(value string) bool {
	return value == "true" || value == "1"
}

func writeProtoOrError(writer http.ResponseWriter, statusCode int, message proto.Message, err error) {
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	payload, marshalErr := protojson.MarshalOptions{EmitUnpopulated: true}.Marshal(message)
	if marshalErr != nil {
		writeError(writer, http.StatusInternalServerError, "ERROR_CODE_INTERNAL_SERVER_ERROR", "failed to encode response")
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)
	_, _ = writer.Write(payload)
}

func writeDomainError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrOwnerRequired):
		writeError(writer, http.StatusUnauthorized, "ERROR_CODE_UNAUTHORIZED", "authentication required")
	case errors.Is(err, domain.ErrNoteIDRequired):
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_NOTE_ID_REQUIRED", "note id is required")
	case errors.Is(err, domain.ErrNoteNotFound):
		writeError(writer, http.StatusNotFound, "ERROR_CODE_NOTE_NOT_FOUND", "note not found")
	case errors.Is(err, domain.ErrEmptyContent):
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_NOTE_EMPTY_CONTENT", "note title or content is required")
	case errors.Is(err, domain.ErrNoUpdateFields):
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_INVALID_REQUEST_BODY", "note update has no fields")
	case errors.Is(err, domain.ErrInvalidPageToken):
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_INVALID_QUERY_PARAMETERS", "invalid page token")
	case errors.Is(err, domain.ErrUnsupportedOrder):
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_INVALID_QUERY_PARAMETERS", "unsupported order_by")
	case errors.Is(err, domain.ErrSearchQueryEmpty):
		writeError(writer, http.StatusBadRequest, "ERROR_CODE_INVALID_QUERY_PARAMETERS", "search query is required")
	default:
		writeError(writer, http.StatusInternalServerError, "ERROR_CODE_INTERNAL_SERVER_ERROR", "note service failed")
	}
}

func writeError(writer http.ResponseWriter, statusCode int, code string, message string) {
	writeJSON(writer, statusCode, errorResponse{Code: code, Message: message})
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		writer.WriteHeader(http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)
	_, _ = writer.Write(data)
}
