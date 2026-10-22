package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"gorm.io/gorm"
)

const requesterUploadLimit = 20 * 1024 * 1024

type requesterToolArguments struct {
	Operation       string         `json:"operation"`
	Target          string         `json:"target"`
	Query           string         `json:"query"`
	Scope           string         `json:"scope"`
	Detail          string         `json:"detail"`
	DocFormat       string         `json:"doc_format"`
	Keyword         string         `json:"keyword"`
	StartBlockID    string         `json:"start_block_id"`
	EndBlockID      string         `json:"end_block_id"`
	MaxDepth        *int           `json:"max_depth"`
	ContextBefore   *int           `json:"context_before"`
	ContextAfter    *int           `json:"context_after"`
	SpaceID         string         `json:"space_id"`
	ParentNodeToken string         `json:"parent_node_token"`
	NodeToken       string         `json:"node_token"`
	ObjectType      string         `json:"object_type"`
	UserID          string         `json:"user_id"`
	UserIDType      string         `json:"user_id_type"`
	Queries         string         `json:"queries"`
	PageSize        int            `json:"page_size"`
	PageToken       string         `json:"page_token"`
	Content         string         `json:"content"`
	Pattern         string         `json:"pattern"`
	Command         string         `json:"command"`
	BlockID         string         `json:"block_id"`
	SourceBlockIDs  string         `json:"source_block_ids"`
	ParentToken     string         `json:"parent_token"`
	ParentPosition  string         `json:"parent_position"`
	FolderToken     string         `json:"folder_token"`
	FileToken       string         `json:"file_token"`
	FileType        string         `json:"file_type"`
	Name            string         `json:"name"`
	WikiToken       string         `json:"wiki_token"`
	ContentBase64   string         `json:"content_base64"`
	Schema          string         `json:"schema"`
	Method          string         `json:"method"`
	Path            string         `json:"path"`
	Params          map[string]any `json:"params"`
	Data            map[string]any `json:"data"`
}

func (s *RequesterAuthorizationService) ExecuteRequesterTool(
	ctx context.Context,
	turnID string,
	toolName string,
	arguments json.RawMessage,
) (string, error) {
	if s == nil || s.runner == nil {
		return "", errors.New("managed Lark requester tools are unavailable")
	}
	authorization, err := s.authorizationForTurn(ctx, strings.TrimSpace(turnID))
	if err != nil {
		return "", err
	}
	if authorization.Status == requesterAuthNeedsRefresh {
		refreshed, refreshErr := s.RefreshAuthorization(
			ctx,
			authorization.ActorPTID,
			authorization.BindingID,
			authorization.ID,
			authorization.Revision,
		)
		if refreshErr != nil {
			return "", refreshErr
		}
		if refreshed.Status != requesterAuthReady {
			return "", errors.New("Lark requester authorization could not be refreshed")
		}
	}
	var input requesterToolArguments
	if err := json.Unmarshal(arguments, &input); err != nil {
		return "", fmt.Errorf("invalid Lark tool arguments: %w", err)
	}
	var invocation CLIInvocation
	switch strings.TrimSpace(toolName) {
	case "lark_workspace_read":
		invocation, err = buildWorkspaceReadInvocation(input)
	case "lark_workspace_write":
		invocation, err = buildWorkspaceWriteInvocation(input)
	case "lark_api_read":
		invocation, err = buildAPIInvocation(input, false)
	case "lark_api_write":
		invocation, err = buildAPIInvocation(input, true)
	default:
		return "", fmt.Errorf("unsupported Lark requester tool %q", toolName)
	}
	if err != nil {
		return "", err
	}
	if invocation.WorkDir != "" {
		defer os.RemoveAll(invocation.WorkDir)
	}
	stdout, stderr, runErr := s.runner.Run(
		ctx,
		s.profileDir(authorization.ID),
		invocation,
	)
	if runErr != nil {
		return "", cliFailure("execute Lark requester tool", stderr, runErr)
	}
	output := strings.TrimSpace(string(stdout))
	if output == "" {
		return `{"ok":true}`, nil
	}
	return output, nil
}

func (s *RequesterAuthorizationService) authorizationForTurn(
	ctx context.Context,
	turnID string,
) (*persistence.ChannelRequesterAuthorization, error) {
	if turnID == "" {
		return nil, errors.New("channel turn identity is required")
	}
	var inbound persistence.ChannelInboundEvent
	err := s.db.WithContext(ctx).
		Where("turn_id = ?", turnID).
		Order("created_at DESC").
		First(&inbound).Error
	if err != nil {
		return nil, errors.New("Lark requester tools require a Channel turn")
	}
	binding, err := s.bindings.GetRecord(ctx, inbound.BindingID)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(binding.ProviderKind, "lark") {
		return nil, errors.New("requester tools require a Lark Channel turn")
	}
	providerUserID := strings.TrimSpace(inbound.SenderID)
	tenantKey := strings.TrimSpace(inbound.SenderTenantKey)
	if strings.HasPrefix(providerUserID, "automation:") ||
		strings.HasPrefix(providerUserID, "automation-") {
		providerUserID = strings.TrimSpace(binding.OwnerProviderUserID)
		tenantKey = strings.TrimSpace(binding.TenantKey)
	}
	if providerUserID == "" {
		return nil, errors.New("the Channel requester has no provider identity")
	}
	if tenantKey == "" {
		return nil, errors.New("the Channel requester has no tenant identity")
	}
	query := s.db.WithContext(ctx).Where(
		"actor_ptid = ? AND binding_id = ? AND provider_user_id = ? AND tenant_key = ? AND region = ? AND status IN ?",
		binding.ActorPTID,
		binding.ID,
		providerUserID,
		tenantKey,
		normalizedRegion(binding.Region, binding.Domain),
		[]string{requesterAuthReady, requesterAuthNeedsRefresh},
	)
	var authorization persistence.ChannelRequesterAuthorization
	if err := query.Order("last_verified_at DESC, updated_at DESC").
		First(&authorization).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("this Lark requester has not authorized workspace access")
		}
		return nil, err
	}
	if authorization.ExpiresAt != nil && !authorization.ExpiresAt.After(s.now()) {
		_ = s.db.WithContext(ctx).Model(&authorization).Updates(map[string]any{
			"status": requesterAuthExpired, "recovery_action": "reconnect",
			"revision": gorm.Expr("revision + 1"), "updated_at": s.now(),
		}).Error
		return nil, errors.New("the Lark requester authorization has expired")
	}
	if authorization.TenantKey != tenantKey {
		return nil, errors.New("the Lark requester tenant does not match the authorization")
	}
	return &authorization, nil
}

func buildWorkspaceReadInvocation(input requesterToolArguments) (CLIInvocation, error) {
	base := []string{"--profile", requesterAuthProfile}
	jsonFlags := []string{"--as", "user", "--format", "json"}
	switch strings.ToLower(strings.TrimSpace(input.Operation)) {
	case "document_fetch":
		if strings.TrimSpace(input.Target) == "" {
			return CLIInvocation{}, errors.New("target is required for document_fetch")
		}
		scope, err := enumArgument(
			"scope",
			input.Scope,
			"full",
			"full",
			"outline",
			"range",
			"keyword",
			"section",
		)
		if err != nil {
			return CLIInvocation{}, err
		}
		detail, err := enumArgument(
			"detail",
			input.Detail,
			"simple",
			"simple",
			"with-ids",
			"full",
		)
		if err != nil {
			return CLIInvocation{}, err
		}
		format, err := enumArgument("doc_format", input.DocFormat, "xml", "xml", "markdown")
		if err != nil {
			return CLIInvocation{}, err
		}
		switch scope {
		case "keyword":
			if strings.TrimSpace(input.Keyword) == "" {
				return CLIInvocation{}, errors.New("keyword is required for keyword document scope")
			}
		case "section":
			if strings.TrimSpace(input.StartBlockID) == "" {
				return CLIInvocation{}, errors.New("start_block_id is required for section document scope")
			}
		case "range":
			if strings.TrimSpace(input.StartBlockID) == "" &&
				strings.TrimSpace(input.EndBlockID) == "" {
				return CLIInvocation{}, errors.New("start_block_id or end_block_id is required for range document scope")
			}
		}
		args := append(base, "docs", "+fetch", "--api-version", "v2",
			"--doc", input.Target, "--scope", scope, "--detail", detail,
			"--doc-format", format)
		if input.Keyword != "" {
			args = append(args, "--keyword", input.Keyword)
		}
		if input.StartBlockID != "" {
			args = append(args, "--start-block-id", input.StartBlockID)
		}
		if input.EndBlockID != "" {
			args = append(args, "--end-block-id", input.EndBlockID)
		}
		args, err = appendOptionalIntFlag(args, "--max-depth", input.MaxDepth, -1, 100)
		if err != nil {
			return CLIInvocation{}, err
		}
		args, err = appendOptionalIntFlag(args, "--context-before", input.ContextBefore, 0, 100)
		if err != nil {
			return CLIInvocation{}, err
		}
		args, err = appendOptionalIntFlag(args, "--context-after", input.ContextAfter, 0, 100)
		if err != nil {
			return CLIInvocation{}, err
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "resource_search":
		args := append(base, "drive", "+search", "--query", input.Query)
		if input.PageSize < 0 {
			return CLIInvocation{}, errors.New("page_size cannot be negative")
		}
		if input.PageSize > 0 {
			args = append(args, "--page-size", strconv.Itoa(min(input.PageSize, 20)))
		}
		if input.PageToken != "" {
			args = append(args, "--page-token", input.PageToken)
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "drive_inspect":
		if strings.TrimSpace(input.Target) == "" {
			return CLIInvocation{}, errors.New("target is required for drive_inspect")
		}
		args := append(base, "drive", "+inspect", "--url", input.Target)
		if input.ObjectType != "" {
			args = append(args, "--type", input.ObjectType)
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "wiki_space_list":
		args := append(base, "wiki", "+space-list")
		args, err := appendPagination(args, input.PageSize, input.PageToken, 50)
		if err != nil {
			return CLIInvocation{}, err
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "wiki_node_list":
		if strings.TrimSpace(input.SpaceID) == "" {
			return CLIInvocation{}, errors.New("space_id is required for wiki_node_list")
		}
		args := append(base, "wiki", "+node-list", "--space-id", input.SpaceID)
		if input.ParentNodeToken != "" {
			args = append(args, "--parent-node-token", input.ParentNodeToken)
		}
		args, err := appendPagination(args, input.PageSize, input.PageToken, 50)
		if err != nil {
			return CLIInvocation{}, err
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "wiki_node_get":
		if strings.TrimSpace(input.NodeToken) == "" {
			return CLIInvocation{}, errors.New("node_token is required for wiki_node_get")
		}
		args := append(base, "wiki", "+node-get", "--node-token", input.NodeToken)
		if input.SpaceID != "" {
			args = append(args, "--space-id", input.SpaceID)
		}
		if input.ObjectType != "" {
			args = append(args, "--obj-type", input.ObjectType)
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "contact_search":
		if strings.TrimSpace(input.Query) == "" &&
			strings.TrimSpace(input.Queries) == "" &&
			strings.TrimSpace(input.UserID) == "" {
			return CLIInvocation{}, errors.New("query, queries, or user_id is required for contact_search")
		}
		if input.Queries != "" && (input.Query != "" || input.UserID != "") {
			return CLIInvocation{}, errors.New("queries cannot be combined with query or user_id")
		}
		args := append(base, "contact", "+search-user")
		if input.Query != "" {
			args = append(args, "--query", input.Query)
		}
		if input.Queries != "" {
			args = append(args, "--queries", input.Queries)
		}
		if input.UserID != "" {
			args = append(args, "--user-ids", input.UserID)
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "contact_get":
		userIDType, err := enumArgument(
			"user_id_type",
			input.UserIDType,
			"open_id",
			"open_id",
			"union_id",
			"user_id",
		)
		if err != nil {
			return CLIInvocation{}, err
		}
		if input.UserID != "" {
			if userIDType != "open_id" {
				return CLIInvocation{}, errors.New("requester contact lookup by ID supports open_id only")
			}
			args := append(base, "contact", "+search-user", "--user-ids", input.UserID)
			return CLIInvocation{Args: append(args, jsonFlags...)}, nil
		}
		args := append(base, "contact", "+get-user")
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "schema":
		if !validSchemaName(input.Schema) {
			return CLIInvocation{}, errors.New("a valid service.resource.method schema is required")
		}
		return CLIInvocation{Args: append(base, "schema", input.Schema, "--format", "json")}, nil
	default:
		return CLIInvocation{}, fmt.Errorf("unsupported Lark workspace read operation %q", input.Operation)
	}
}

func buildWorkspaceWriteInvocation(input requesterToolArguments) (CLIInvocation, error) {
	base := []string{"--profile", requesterAuthProfile}
	jsonFlags := []string{"--as", "user", "--format", "json"}
	switch strings.ToLower(strings.TrimSpace(input.Operation)) {
	case "document_create":
		if input.Content == "" {
			return CLIInvocation{}, errors.New("content is required for document_create")
		}
		if input.ParentToken != "" && input.ParentPosition != "" {
			return CLIInvocation{}, errors.New("parent_token and parent_position are mutually exclusive")
		}
		format, err := enumArgument("doc_format", input.DocFormat, "xml", "xml", "markdown")
		if err != nil {
			return CLIInvocation{}, err
		}
		args := append(base, "docs", "+create", "--api-version", "v2",
			"--content", "-", "--doc-format", format)
		if input.ParentToken != "" {
			args = append(args, "--parent-token", input.ParentToken)
		} else if input.ParentPosition != "" {
			args = append(args, "--parent-position", input.ParentPosition)
		}
		return CLIInvocation{Args: append(args, jsonFlags...), Stdin: []byte(input.Content)}, nil
	case "document_update":
		if strings.TrimSpace(input.Target) == "" || strings.TrimSpace(input.Command) == "" {
			return CLIInvocation{}, errors.New("target and command are required for document_update")
		}
		command, err := enumArgument("command", input.Command, "", "str_replace", "block_delete",
			"block_insert_after", "block_copy_insert_after", "block_replace",
			"block_move_after", "overwrite", "append")
		if err != nil {
			return CLIInvocation{}, err
		}
		format, err := enumArgument("doc_format", input.DocFormat, "xml", "xml", "markdown")
		if err != nil {
			return CLIInvocation{}, err
		}
		requiresContent := false
		switch command {
		case "str_replace":
			if input.Pattern == "" {
				return CLIInvocation{}, errors.New("pattern is required for str_replace")
			}
			requiresContent = true
		case "block_delete":
			if input.BlockID == "" {
				return CLIInvocation{}, errors.New("block_id is required for block_delete")
			}
		case "block_insert_after", "block_replace":
			if input.BlockID == "" || input.Content == "" {
				return CLIInvocation{}, fmt.Errorf("block_id and content are required for %s", command)
			}
			requiresContent = true
		case "block_copy_insert_after", "block_move_after":
			if input.BlockID == "" || input.SourceBlockIDs == "" {
				return CLIInvocation{}, fmt.Errorf("block_id and source_block_ids are required for %s", command)
			}
		case "overwrite", "append":
			if input.Content == "" {
				return CLIInvocation{}, fmt.Errorf("content is required for %s", command)
			}
			requiresContent = true
		}
		args := append(base, "docs", "+update", "--api-version", "v2",
			"--doc", input.Target, "--command", command, "--doc-format", format)
		if requiresContent {
			args = append(args, "--content", "-")
		}
		if input.Pattern != "" {
			args = append(args, "--pattern", input.Pattern)
		}
		if input.BlockID != "" {
			args = append(args, "--block-id", input.BlockID)
		}
		if input.SourceBlockIDs != "" {
			args = append(args, "--src-block-ids", input.SourceBlockIDs)
		}
		return CLIInvocation{Args: append(args, jsonFlags...), Stdin: []byte(input.Content)}, nil
	case "drive_create_folder":
		if err := validateRemoteName(input.Name, 256); err != nil {
			return CLIInvocation{}, fmt.Errorf("invalid drive folder name: %w", err)
		}
		args := append(base, "drive", "+create-folder", "--name", input.Name)
		if input.FolderToken != "" {
			args = append(args, "--folder-token", input.FolderToken)
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "drive_move":
		if input.FileToken == "" || input.FileType == "" {
			return CLIInvocation{}, errors.New("file_token and file_type are required for drive_move")
		}
		fileType, err := enumArgument(
			"file_type",
			input.FileType,
			"",
			"file",
			"docx",
			"bitable",
			"doc",
			"sheet",
			"mindnote",
			"folder",
			"slides",
		)
		if err != nil {
			return CLIInvocation{}, err
		}
		args := append(base, "drive", "+move", "--file-token", input.FileToken,
			"--type", fileType)
		if input.FolderToken != "" {
			args = append(args, "--folder-token", input.FolderToken)
		}
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "drive_create_shortcut":
		if input.FileToken == "" || input.FileType == "" || input.FolderToken == "" {
			return CLIInvocation{}, errors.New("file_token, file_type and folder_token are required for drive_create_shortcut")
		}
		fileType, err := enumArgument(
			"file_type",
			input.FileType,
			"",
			"file",
			"docx",
			"doc",
			"sheet",
			"bitable",
			"mindnote",
			"slides",
		)
		if err != nil {
			return CLIInvocation{}, err
		}
		args := append(base, "drive", "+create-shortcut",
			"--file-token", input.FileToken, "--type", fileType,
			"--folder-token", input.FolderToken)
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "drive_delete":
		if input.FileToken == "" || input.FileType == "" {
			return CLIInvocation{}, errors.New("file_token and file_type are required for drive_delete")
		}
		fileType, err := enumArgument(
			"file_type",
			input.FileType,
			"",
			"file",
			"docx",
			"bitable",
			"doc",
			"sheet",
			"mindnote",
			"folder",
			"shortcut",
			"slides",
		)
		if err != nil {
			return CLIInvocation{}, err
		}
		args := append(base, "drive", "+delete",
			"--file-token", input.FileToken, "--type", fileType, "--yes")
		return CLIInvocation{Args: append(args, jsonFlags...)}, nil
	case "drive_upload":
		if err := validateRemoteName(input.Name, 200); err != nil {
			return CLIInvocation{}, fmt.Errorf("invalid drive upload name: %w", err)
		}
		if input.FolderToken != "" && input.WikiToken != "" {
			return CLIInvocation{}, errors.New("folder_token and wiki_token are mutually exclusive")
		}
		body, err := base64.StdEncoding.DecodeString(input.ContentBase64)
		if err != nil {
			return CLIInvocation{}, errors.New("content_base64 is invalid")
		}
		if len(body) == 0 || len(body) > requesterUploadLimit {
			return CLIInvocation{}, fmt.Errorf("drive_upload content must be between 1 and %d bytes", requesterUploadLimit)
		}
		workDir, err := os.MkdirTemp("", "peers-lark-upload-")
		if err != nil {
			return CLIInvocation{}, err
		}
		fileName := filepath.Base(input.Name)
		if err := os.WriteFile(filepath.Join(workDir, fileName), body, 0o600); err != nil {
			_ = os.RemoveAll(workDir)
			return CLIInvocation{}, err
		}
		args := append(base, "drive", "+upload", "--file", fileName, "--name", input.Name)
		if input.FolderToken != "" {
			args = append(args, "--folder-token", input.FolderToken)
		} else if input.WikiToken != "" {
			args = append(args, "--wiki-token", input.WikiToken)
		}
		if input.FileToken != "" {
			args = append(args, "--file-token", input.FileToken)
		}
		return CLIInvocation{Args: append(args, jsonFlags...), WorkDir: workDir}, nil
	default:
		return CLIInvocation{}, fmt.Errorf("unsupported Lark workspace write operation %q", input.Operation)
	}
}

func buildAPIInvocation(input requesterToolArguments, write bool) (CLIInvocation, error) {
	method := strings.ToUpper(strings.TrimSpace(input.Method))
	if write {
		if method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
			return CLIInvocation{}, errors.New("lark_api_write method must be POST, PUT, PATCH, or DELETE")
		}
	} else if method != "GET" {
		return CLIInvocation{}, errors.New("lark_api_read method must be GET")
	}
	path := strings.TrimSpace(input.Path)
	if path != input.Path {
		return CLIInvocation{}, errors.New("path must not contain surrounding whitespace")
	}
	if err := validateOpenAPIPath(path); err != nil {
		return CLIInvocation{}, err
	}
	args := []string{
		"--profile", requesterAuthProfile,
		"api", method, path, "--as", "user", "--format", "json",
	}
	if len(input.Params) > 0 {
		params, err := json.Marshal(input.Params)
		if err != nil {
			return CLIInvocation{}, err
		}
		args = append(args, "--params", string(params))
	}
	if len(input.Data) > 0 {
		data, err := json.Marshal(input.Data)
		if err != nil {
			return CLIInvocation{}, err
		}
		args = append(args, "--data", string(data))
	}
	return CLIInvocation{Args: args}, nil
}

func enumArgument(
	name, value, fallback string,
	allowed ...string,
) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		value = fallback
	}
	for _, candidate := range allowed {
		if value == candidate {
			return value, nil
		}
	}
	return "", fmt.Errorf("unsupported %s %q", name, value)
}

func appendPagination(
	args []string,
	pageSize int,
	pageToken string,
	maxPageSize int,
) ([]string, error) {
	if pageSize < 0 {
		return nil, errors.New("page_size cannot be negative")
	}
	if pageSize > 0 {
		args = append(args, "--page-size", strconv.Itoa(min(pageSize, maxPageSize)))
	}
	if strings.TrimSpace(pageToken) != "" {
		args = append(args, "--page-token", pageToken)
	}
	return args, nil
}

func appendOptionalIntFlag(
	args []string,
	flag string,
	value *int,
	minimum, maximum int,
) ([]string, error) {
	if value == nil {
		return args, nil
	}
	if *value < minimum || *value > maximum {
		return nil, fmt.Errorf("%s must be between %d and %d", flag, minimum, maximum)
	}
	return append(args, flag, strconv.Itoa(*value)), nil
}

func validateRemoteName(value string, maximumRunes int) error {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value || value == "" {
		return errors.New("name must be non-empty valid UTF-8 without surrounding whitespace")
	}
	if value == "." || value == ".." || utf8.RuneCountInString(value) > maximumRunes {
		return fmt.Errorf("name must be at most %d characters", maximumRunes)
	}
	for _, character := range value {
		if character == '/' || character == '\\' || unicode.IsControl(character) {
			return errors.New("name contains a path separator or control character")
		}
	}
	return nil
}

func validateOpenAPIPath(value string) error {
	if !strings.HasPrefix(value, "/open-apis/") ||
		strings.ContainsAny(value, "\\\x00\r\n\t ") {
		return errors.New("path must be a canonical /open-apis/ path")
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil ||
		parsed.Scheme != "" ||
		parsed.Host != "" ||
		parsed.Opaque != "" ||
		parsed.RawPath != "" ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" ||
		parsed.Path != value {
		return errors.New("path must be a canonical /open-apis/ path without query or fragment")
	}
	segments := strings.Split(value, "/")
	for index, segment := range segments {
		if index == 0 {
			continue
		}
		if segment == "" || segment == "." || segment == ".." {
			return errors.New("path contains an empty or traversal segment")
		}
	}
	return nil
}

func validSchemaName(value string) bool {
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if part == "" {
			return false
		}
		for _, character := range part {
			if (character < 'a' || character > 'z') &&
				(character < 'A' || character > 'Z') &&
				(character < '0' || character > '9') &&
				character != '_' {
				return false
			}
		}
	}
	return true
}
