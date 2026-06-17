package stationadapter

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/apps/applets/note/service/transport"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMountedBundleServesStationAppletPath(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	bundle, err := NewBundle(context.Background(), db)
	if err != nil {
		t.Fatalf("create bundle: %v", err)
	}
	handler := bundle.Mount("/applets/note")

	createReq := httptest.NewRequest(http.MethodPost, "/applets/note/v1/notes", bytes.NewBufferString(`{"title":"Gateway","content":"real path"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set(transport.OwnerHeader, "actor-note")
	createResp := httptest.NewRecorder()

	handler.ServeHTTP(createResp, createReq)
	if createResp.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createResp.Code, createResp.Body.String())
	}

	searchReq := httptest.NewRequest(http.MethodGet, "/applets/note/v1/notes:search?q=Gateway", nil)
	searchReq.Header.Set(transport.OwnerHeader, "actor-note")
	searchResp := httptest.NewRecorder()

	handler.ServeHTTP(searchResp, searchReq)
	if searchResp.Code != http.StatusOK {
		t.Fatalf("search status = %d, body = %s", searchResp.Code, searchResp.Body.String())
	}
	if !strings.Contains(searchResp.Body.String(), "Gateway") {
		t.Fatalf("search response does not include created note: %s", searchResp.Body.String())
	}
}
