package service

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func requireArgsContain(t *testing.T, args []string, expected ...string) {
	t.Helper()
	for _, value := range expected {
		if !slices.Contains(args, value) {
			t.Fatalf("args %v do not contain %q", args, value)
		}
	}
}

func TestBuildWorkspaceReadInvocationSupportsBoundedDocumentSlices(t *testing.T) {
	maxDepth := 3
	contextBefore := 1
	contextAfter := 2
	invocation, err := buildWorkspaceReadInvocation(requesterToolArguments{
		Operation: "document_fetch", Target: "docx-token",
		Scope: "range", Detail: "with-ids", DocFormat: "xml",
		StartBlockID: "block-a", EndBlockID: "block-b",
		MaxDepth: &maxDepth, ContextBefore: &contextBefore, ContextAfter: &contextAfter,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireArgsContain(
		t,
		invocation.Args,
		"--api-version",
		"v2",
		"--start-block-id",
		"block-a",
		"--end-block-id",
		"block-b",
		"--max-depth",
		"3",
		"--context-before",
		"1",
		"--context-after",
		"2",
		"--as",
		"user",
	)
}

func TestBuildWorkspaceReadInvocationRequiresScopeInputs(t *testing.T) {
	for _, test := range []requesterToolArguments{
		{Operation: "document_fetch", Target: "doc", Scope: "keyword"},
		{Operation: "document_fetch", Target: "doc", Scope: "section"},
		{Operation: "document_fetch", Target: "doc", Scope: "range"},
		{Operation: "document_fetch", Target: "doc", Scope: "unknown"},
	} {
		if _, err := buildWorkspaceReadInvocation(test); err == nil {
			t.Fatalf("invalid document input unexpectedly succeeded: %+v", test)
		}
	}
}

func TestBuildWorkspaceReadInvocationKeepsWikiPaginationBounded(t *testing.T) {
	invocation, err := buildWorkspaceReadInvocation(requesterToolArguments{
		Operation: "wiki_node_list", SpaceID: "space-a",
		PageSize: 50, PageToken: "next",
	})
	if err != nil {
		t.Fatal(err)
	}
	requireArgsContain(t, invocation.Args, "--page-size", "50", "--page-token", "next")
	if slices.Contains(invocation.Args, "--page-all") {
		t.Fatalf("wiki list unexpectedly requested unbounded pagination: %v", invocation.Args)
	}
}

func TestBuildWorkspaceReadInvocationUsesUserSearchForKnownOpenID(t *testing.T) {
	invocation, err := buildWorkspaceReadInvocation(requesterToolArguments{
		Operation: "contact_get", UserID: "ou_requester", UserIDType: "open_id",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !commandContains(invocation.Args, "contact", "+search-user", "--user-ids", "ou_requester") {
		t.Fatalf("known user lookup did not use requester search: %v", invocation.Args)
	}
}

func TestBuildDocumentUpdateInvocationEnforcesCommandContract(t *testing.T) {
	tests := []struct {
		name  string
		input requesterToolArguments
	}{
		{
			name: "replace requires pattern",
			input: requesterToolArguments{
				Operation: "document_update", Target: "doc", Command: "str_replace",
			},
		},
		{
			name: "delete requires block",
			input: requesterToolArguments{
				Operation: "document_update", Target: "doc", Command: "block_delete",
			},
		},
		{
			name: "insert requires content",
			input: requesterToolArguments{
				Operation: "document_update", Target: "doc",
				Command: "block_insert_after", BlockID: "block",
			},
		},
		{
			name: "copy requires sources",
			input: requesterToolArguments{
				Operation: "document_update", Target: "doc",
				Command: "block_copy_insert_after", BlockID: "block",
			},
		},
		{
			name: "append requires content",
			input: requesterToolArguments{
				Operation: "document_update", Target: "doc", Command: "append",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := buildWorkspaceWriteInvocation(test.input); err == nil {
				t.Fatalf("invalid update unexpectedly succeeded: %+v", test.input)
			}
		})
	}

	invocation, err := buildWorkspaceWriteInvocation(requesterToolArguments{
		Operation: "document_update", Target: "doc", Command: "str_replace",
		Pattern: "old", Content: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	requireArgsContain(t, invocation.Args, "--pattern", "old", "--content", "-")
}

func TestBuildDriveUploadInvocationSupportsSafeUnicodeName(t *testing.T) {
	invocation, err := buildWorkspaceWriteInvocation(requesterToolArguments{
		Operation: "drive_upload", Name: "验收结果 2026.txt",
		ContentBase64: base64.StdEncoding.EncodeToString([]byte("proof")),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(invocation.WorkDir)
	filePath := filepath.Join(invocation.WorkDir, "验收结果 2026.txt")
	body, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "proof" {
		t.Fatalf("uploaded body = %q", body)
	}
	for _, name := range []string{"../secret", "folder/file", "folder\\file", "bad\nname"} {
		if _, err := buildWorkspaceWriteInvocation(requesterToolArguments{
			Operation: "drive_upload", Name: name,
			ContentBase64: base64.StdEncoding.EncodeToString([]byte("proof")),
		}); err == nil {
			t.Fatalf("unsafe upload name %q was accepted", name)
		}
	}
}

func TestBuildAPIInvocationRejectsNonCanonicalPaths(t *testing.T) {
	for _, path := range []string{
		"https://open.larksuite.com/open-apis/contact/v3/users",
		"/open-apis/contact/v3/../users",
		"/open-apis/contact/v3/%2e%2e/users",
		"/open-apis/contact/v3/users?user_id=ou_x",
		"/open-apis//contact/v3/users",
		"/open-apis/contact/v3/users ",
	} {
		if _, err := buildAPIInvocation(requesterToolArguments{
			Method: "GET", Path: path,
		}, false); err == nil {
			t.Fatalf("non-canonical API path %q was accepted", path)
		}
	}
	invocation, err := buildAPIInvocation(requesterToolArguments{
		Method: "GET", Path: "/open-apis/contact/v3/users/ou_requester",
		Params: map[string]any{"user_id_type": "open_id"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(invocation.Args, " ") == "" ||
		!commandContains(invocation.Args, "api", "GET", "/open-apis/contact/v3/users/ou_requester") {
		t.Fatalf("canonical API invocation is incomplete: %v", invocation.Args)
	}
}
