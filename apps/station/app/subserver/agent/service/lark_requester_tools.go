package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
)

var channelRequesterToolNames = []string{
	"lark_workspace_read",
	"lark_workspace_write",
	"lark_api_read",
	"lark_api_write",
}

func RegisterChannelRequesterTools(
	registry *ToolRegistryService,
	executor channelsvc.RequesterToolExecutor,
) {
	if registry == nil {
		return
	}
	register := func(name, description, schema string) {
		registry.Register(&domain.ToolDefinition{
			Name: name, Description: description, JSONSchema: json.RawMessage(schema),
			Handler: func(
				ctx context.Context,
				meta *domain.ToolCallMeta,
				arguments json.RawMessage,
			) (*domain.ToolResult, error) {
				if executor == nil {
					return nil, errors.New("Lark requester tool executor is unavailable")
				}
				content, err := executor.ExecuteRequesterTool(
					ctx, meta.TurnID, name, arguments,
				)
				if err != nil {
					return nil, err
				}
				return &domain.ToolResult{Content: content}, nil
			},
		})
	}
	register(
		"lark_workspace_read",
		"Read the current Lark requester's documents, Drive, Wiki, or contacts. The requester identity is fixed by the Channel turn and cannot fall back to another profile.",
		`{
  "type":"object",
  "additionalProperties":false,
  "properties":{
    "operation":{"type":"string","enum":["document_fetch","resource_search","drive_inspect","wiki_space_list","wiki_node_list","wiki_node_get","contact_search","contact_get","schema"]},
    "target":{"type":"string","description":"Document URL/token or Drive URL/token, depending on operation"},
    "query":{"type":"string"},
    "queries":{"type":"string"},
    "scope":{"type":"string","enum":["full","outline","range","keyword","section"]},
    "detail":{"type":"string","enum":["simple","with-ids","full"]},
    "doc_format":{"type":"string","enum":["xml","markdown"]},
    "keyword":{"type":"string"},
    "start_block_id":{"type":"string"},
    "end_block_id":{"type":"string"},
    "max_depth":{"type":"integer","minimum":-1,"maximum":100},
    "context_before":{"type":"integer","minimum":0,"maximum":100},
    "context_after":{"type":"integer","minimum":0,"maximum":100},
    "space_id":{"type":"string"},
    "parent_node_token":{"type":"string"},
    "node_token":{"type":"string"},
    "object_type":{"type":"string"},
    "user_id":{"type":"string"},
    "user_id_type":{"type":"string","enum":["open_id","union_id","user_id"]},
    "page_size":{"type":"integer","minimum":1,"maximum":50},
    "page_token":{"type":"string"},
    "schema":{"type":"string","description":"service.resource.method"}
  },
  "required":["operation"]
}`,
	)
	register(
		"lark_workspace_write",
		"Create or edit a requester-owned Lark document, or create, upload, move, link, or delete a Drive resource. Every invocation requires the existing governed ToolCall approval.",
		`{
  "type":"object",
  "additionalProperties":false,
  "properties":{
    "operation":{"type":"string","enum":["document_create","document_update","drive_create_folder","drive_move","drive_create_shortcut","drive_delete","drive_upload"]},
    "target":{"type":"string","description":"Document URL or token"},
    "content":{"type":"string","maxLength":1000000},
    "content_base64":{"type":"string","maxLength":27962028},
    "doc_format":{"type":"string","enum":["xml","markdown"]},
    "command":{"type":"string","enum":["str_replace","block_delete","block_insert_after","block_copy_insert_after","block_replace","block_move_after","overwrite","append"]},
    "pattern":{"type":"string"},
    "block_id":{"type":"string"},
    "source_block_ids":{"type":"string"},
    "parent_token":{"type":"string"},
    "parent_position":{"type":"string"},
    "folder_token":{"type":"string"},
    "file_token":{"type":"string"},
    "file_type":{"type":"string","enum":["file","docx","bitable","doc","sheet","mindnote","folder","shortcut","slides"]},
    "wiki_token":{"type":"string"},
    "name":{"type":"string","maxLength":200}
  },
  "required":["operation"]
}`,
	)
	register(
		"lark_api_read",
		"Call a read-only Lark OpenAPI endpoint as the current Channel requester. Use lark_workspace_read operation=schema first to inspect service.resource.method, and prefer the workspace operations for common document, Drive, Wiki, and contact workflows.",
		`{
  "type":"object",
  "additionalProperties":false,
  "properties":{
    "method":{"type":"string","enum":["GET"]},
    "path":{"type":"string","pattern":"^/open-apis/"},
    "params":{"type":"object"}
  },
  "required":["method","path"]
}`,
	)
	register(
		"lark_api_write",
		"Call a side-effecting Lark OpenAPI endpoint as the current Channel requester only after lark_workspace_read operation=schema has inspected service.resource.method. The exact method, path, and body are shown in the existing governed ToolCall approval before execution.",
		`{
  "type":"object",
  "additionalProperties":false,
  "properties":{
    "method":{"type":"string","enum":["POST","PUT","PATCH","DELETE"]},
    "path":{"type":"string","pattern":"^/open-apis/"},
    "params":{"type":"object"},
    "data":{"type":"object"}
  },
  "required":["method","path"]
}`,
	)
}
