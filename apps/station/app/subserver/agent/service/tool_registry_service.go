// Changelog:
// 2026-04-11 — Initial creation: ToolRegistryService — central tool registration,
//   schema management, and dispatch. Registers concrete handlers for:
//   memory, skills_list, skill_view, skill_manage, delegate_task.
//   Each handler bridges tool_call JSON arguments to the corresponding domain service.
// 2026-06-17 — Agent rebuild P0-1: registered local_mcp as the Station-visible
//   placeholder for Desktop-local MCP execution. TurnService intercepts it and
//   routes execution through the Desktop Rust local tool bridge.
// 2026-06-17 — Agent rebuild P1-5: registered schema-first Desktop-local builtin
//   tool placeholders for file, clipboard, and safe workspace operations.
// 2026-06-17 — Agent rebuild P5-4: registered OAuth connector access as a
//   Desktop-local approved tool so Station owns tool planning while Rust owns
//   credential-adjacent execution and redaction.

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// ---------------------------------------------------------------------------
// ToolRegistryService
// ---------------------------------------------------------------------------

// ToolRegistryService holds the mapping of tool names to their definitions
// and dispatches incoming tool calls to the appropriate handler.
type ToolRegistryService struct {
	mu    sync.RWMutex
	tools map[string]*domain.ToolDefinition
}

func NewToolRegistryService(
	memorySvc *MemoryService,
	skillSvc *SkillService,
) *ToolRegistryService {

	r := &ToolRegistryService{
		tools: make(map[string]*domain.ToolDefinition),
	}

	// Register all built-in tools.
	r.registerMemoryTool(memorySvc)
	r.registerSkillsListTool(skillSvc)
	r.registerSkillViewTool(skillSvc)
	r.registerSkillManageTool(skillSvc)
	r.registerLocalMCPTool()
	r.registerDesktopLocalBuiltinTools()

	return r
}

func (r *ToolRegistryService) registerLocalMCPTool() {
	schema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "server_name": {
      "type": "string",
      "description": "Configured local MCP server name"
    },
    "tool_name": {
      "type": "string",
      "description": "MCP tool name to execute on the local desktop"
    },
    "arguments": {
      "type": "object",
      "description": "Arguments passed to the MCP tool"
    }
  },
  "required": ["server_name", "tool_name"]
}`)

	r.Register(&domain.ToolDefinition{
		Name:        "local_mcp",
		Description: "Execute a Desktop-local MCP tool through the secure local tool bridge.",
		JSONSchema:  schema,
		Handler: func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
			return &domain.ToolResult{
				Content: "local_mcp is executed by the Agent turn loop local tool bridge",
			}, nil
		},
	})
}

func (r *ToolRegistryService) registerDesktopLocalBuiltinTools() {
	specs := []struct {
		name        string
		description string
		schema      string
	}{
		{
			name:        "local_file_read",
			description: "Read a UTF-8 file from the approved Desktop workspace after user approval.",
			schema:      `{"type":"object","properties":{"path":{"type":"string","description":"File path relative to the approved workspace"},"max_bytes":{"type":"integer","minimum":1,"maximum":200000}},"required":["path"]}`,
		},
		{
			name:        "local_workspace_list",
			description: "List files in a directory inside the approved Desktop workspace after user approval.",
			schema:      `{"type":"object","properties":{"path":{"type":"string","description":"Directory path relative to the approved workspace"},"limit":{"type":"integer","minimum":1,"maximum":200}},"required":["path"]}`,
		},
		{
			name:        "local_clipboard_read",
			description: "Read plain text from the Desktop clipboard after user approval.",
			schema:      `{"type":"object","properties":{}}`,
		},
		{
			name:        "local_clipboard_write",
			description: "Write plain text into the Desktop clipboard after user approval.",
			schema:      `{"type":"object","properties":{"text":{"type":"string","maxLength":200000}},"required":["text"]}`,
		},
		{
			name:        "local_shell_safe",
			description: "Run an allow-listed Desktop workspace operation without arbitrary shell execution.",
			schema:      `{"type":"object","properties":{"operation":{"type":"string","enum":["pwd","list_dir"]},"path":{"type":"string"}},"required":["operation"]}`,
		},
	}

	for _, spec := range specs {
		schema := json.RawMessage(spec.schema)
		r.Register(&domain.ToolDefinition{
			Name:        spec.name,
			Description: spec.description,
			JSONSchema:  schema,
			Handler: func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
				return &domain.ToolResult{
					Content: "desktop-local builtin tools are executed by the Agent turn loop local tool bridge",
				}, nil
			},
		})
	}
}

// Register adds or replaces a tool definition.
func (r *ToolRegistryService) Register(def *domain.ToolDefinition) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[def.Name] = def
}

// Has returns true if a tool with the given name is registered.
func (r *ToolRegistryService) Has(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.tools[name]
	return ok || isConnectorResourceToolName(name)
}

// ManifestVersion returns the canonical capability-manifest version generated
// from the registered Tool definition.
func (r *ToolRegistryService) ManifestVersion(name string) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	definition, ok := r.tools[name]
	if !ok {
		return "", false
	}
	return capabilityToolManifestSeed(definition).manifest.GetVersion(), true
}

// ToolNames returns the names of all registered tools, sorted.
func (r *ToolRegistryService) ToolNames() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.tools))
	for n := range r.tools {
		names = append(names, n)
	}
	return names
}

// Definitions returns the tool definitions for the given tool names.
// Tools not found are silently skipped.
func (r *ToolRegistryService) Definitions(names []string) []*domain.ToolDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	defs := make([]*domain.ToolDefinition, 0, len(names))
	for _, n := range names {
		if d, ok := r.tools[n]; ok {
			defs = append(defs, d)
		} else if isConnectorResourceToolName(n) {
			defs = append(defs, connectorResourceToolDefinition(n))
		}
	}
	return defs
}

func isConnectorResourceToolName(name string) bool {
	const prefix = "connector_resource_"
	if !strings.HasPrefix(name, prefix) || len(name) != len(prefix)+24 {
		return false
	}
	for _, character := range name[len(prefix):] {
		if (character < '0' || character > '9') &&
			(character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func connectorResourceToolDefinition(name string) *domain.ToolDefinition {
	return &domain.ToolDefinition{
		Name:        name,
		Description: "Invoke one approved OAuth Connector resource through its pinned connection revision.",
		JSONSchema: json.RawMessage(
			`{"type":"object","properties":{"params":{"type":"object","description":"Resource-specific non-secret input"}},"additionalProperties":false}`,
		),
		Handler: func(
			ctx context.Context,
			meta *domain.ToolCallMeta,
			raw json.RawMessage,
		) (*domain.ToolResult, error) {
			return &domain.ToolResult{
				Content: "Connector resources execute through the client capability bridge",
			}, nil
		},
	}
}

// Dispatch looks up the tool by name and invokes its handler.
// Returns a ToolResult; if the tool is not found a descriptive error result
// is returned so the LLM can self-correct.
func (r *ToolRegistryService) Dispatch(
	ctx context.Context,
	meta *domain.ToolCallMeta,
	toolName string,
	argsJSON string,
) *domain.ToolResult {

	r.mu.RLock()
	def, ok := r.tools[toolName]
	r.mu.RUnlock()

	if !ok {
		return &domain.ToolResult{
			Content: fmt.Sprintf("[tool_not_found] tool %q is not registered in this agent", toolName),
			IsError: true,
		}
	}

	result, err := def.Handler(ctx, meta, json.RawMessage(argsJSON))
	if err != nil {
		logger.Warnf(ctx, "tool dispatch error: tool=%s err=%v", toolName, err)
		return &domain.ToolResult{
			Content: fmt.Sprintf("[tool_error] %s: %v", toolName, err),
			IsError: true,
		}
	}

	if result == nil {
		return &domain.ToolResult{Content: "ok"}
	}

	return result
}

// ---------------------------------------------------------------------------
// Built-in tool: memory
// ---------------------------------------------------------------------------

// memoryArgs mirrors the JSON schema for the memory tool.
type memoryArgs struct {
	Action  string `json:"action"`
	Target  string `json:"target"`
	Content string `json:"content"`
	OldText string `json:"old_text"`
}

func (r *ToolRegistryService) registerMemoryTool(svc *MemoryService) {
	schema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": ["add", "replace", "remove"],
      "description": "The operation to perform"
    },
    "target": {
      "type": "string",
      "enum": ["memory", "user"],
      "description": "'memory' for your personal notes, 'user' for user profile facts"
    },
    "content": {
      "type": "string",
      "description": "The content to add or the new content for replace"
    },
    "old_text": {
      "type": "string",
      "description": "For replace/remove: text to match against existing entries (fuzzy match)"
    }
  },
  "required": ["action", "target"]
}`)

	handler := func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
		var args memoryArgs
		if err := json.Unmarshal(raw, &args); err != nil {
			return &domain.ToolResult{
				Content: fmt.Sprintf("invalid memory arguments: %v", err),
				IsError: true,
			}, nil
		}

		switch domain.MemoryAction(args.Action) {
		case domain.MemoryActionAdd:
			if args.Content == "" {
				return &domain.ToolResult{Content: "content is required for add action", IsError: true}, nil
			}
			if err := svc.Add(ctx, meta.AgentID, args.Target, args.Content, meta.TurnID); err != nil {
				return &domain.ToolResult{Content: fmt.Sprintf("memory add failed: %v", err), IsError: true}, nil
			}
			return &domain.ToolResult{Content: fmt.Sprintf("Memory added to %s.", args.Target)}, nil

		case domain.MemoryActionReplace:
			if args.OldText == "" || args.Content == "" {
				return &domain.ToolResult{Content: "old_text and content are required for replace action", IsError: true}, nil
			}
			if err := svc.Replace(ctx, meta.AgentID, args.Target, args.OldText, args.Content); err != nil {
				return &domain.ToolResult{Content: fmt.Sprintf("memory replace failed: %v", err), IsError: true}, nil
			}
			return &domain.ToolResult{Content: fmt.Sprintf("Memory entry in %s replaced.", args.Target)}, nil

		case domain.MemoryActionRemove:
			if args.OldText == "" {
				return &domain.ToolResult{Content: "old_text is required for remove action", IsError: true}, nil
			}
			if err := svc.Remove(ctx, meta.AgentID, args.Target, args.OldText); err != nil {
				return &domain.ToolResult{Content: fmt.Sprintf("memory remove failed: %v", err), IsError: true}, nil
			}
			return &domain.ToolResult{Content: fmt.Sprintf("Memory entry removed from %s.", args.Target)}, nil

		default:
			return &domain.ToolResult{
				Content: fmt.Sprintf("unknown memory action %q, expected add/replace/remove", args.Action),
				IsError: true,
			}, nil
		}
	}

	r.Register(&domain.ToolDefinition{
		Name: "memory",
		Description: "Manage your persistent memory. Use this to remember important information " +
			"about the user and your working context. Guidelines: (1) Save user preferences, " +
			"technical environment, project conventions immediately when learned. (2) User profile " +
			"facts go to target='user'. Your working notes go to target='memory'. (3) Keep entries " +
			"atomic — one fact per entry. (4) When at capacity, replace least important entries. " +
			"(5) NEVER store secrets, API keys, passwords, or tokens.",
		JSONSchema: schema,
		Handler:    handler,
	})

	aliasedSchema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "enum": ["memory", "user"],
      "description": "'memory' for your personal notes, 'user' for user profile facts"
    },
    "content": {
      "type": "string",
      "description": "The content to remember"
    },
    "old_text": {
      "type": "string",
      "description": "For replace/remove: text to match against existing entries"
    }
  },
  "required": ["content"]
}`)

	makeAliasHandler := func(action string) func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
		return func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
			var args struct {
				Target  string `json:"target"`
				Content string `json:"content"`
				OldText string `json:"old_text"`
			}
			_ = json.Unmarshal(raw, &args)
			if args.Target == "" {
				args.Target = "user"
			}
			if args.Content == "" {
				return &domain.ToolResult{Content: "content is required", IsError: true}, nil
			}
			aliasRaw, _ := json.Marshal(memoryArgs{
				Action:  action,
				Target:  args.Target,
				Content: args.Content,
				OldText: args.OldText,
			})
			return handler(ctx, meta, aliasRaw)
		}
	}

	r.Register(&domain.ToolDefinition{
		Name:        "memory_add",
		Description: "Add a memory entry. Use target='user' for user facts, target='memory' for notes.",
		JSONSchema:  aliasedSchema,
		Handler:     makeAliasHandler("add"),
	})
	r.Register(&domain.ToolDefinition{
		Name:        "memory_replace",
		Description: "Replace an existing memory entry.",
		JSONSchema:  aliasedSchema,
		Handler:     makeAliasHandler("replace"),
	})
	r.Register(&domain.ToolDefinition{
		Name:        "memory_remove",
		Description: "Remove a memory entry.",
		JSONSchema:  aliasedSchema,
		Handler:     makeAliasHandler("remove"),
	})
}

// ---------------------------------------------------------------------------
// Built-in tool: skills_list  (Tier 1 progressive disclosure)
// ---------------------------------------------------------------------------

func (r *ToolRegistryService) registerSkillsListTool(svc *SkillService) {
	schema := json.RawMessage(`{
  "type": "object",
  "properties": {},
  "required": []
}`)

	handler := func(ctx context.Context, meta *domain.ToolCallMeta, _ json.RawMessage) (*domain.ToolResult, error) {
		manifests, err := svc.ListSkills(ctx, meta.AgentID)
		if err != nil {
			return &domain.ToolResult{Content: fmt.Sprintf("skills_list failed: %v", err), IsError: true}, nil
		}

		if len(manifests) == 0 {
			return &domain.ToolResult{Content: "No skills installed."}, nil
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Found %d skill(s):\n\n", len(manifests)))
		for _, m := range manifests {
			sb.WriteString(fmt.Sprintf("- **%s**: %s\n", m.Name, m.Description))
		}
		sb.WriteString("\nUse skill_view(name) to load the full content of any skill.")

		return &domain.ToolResult{Content: sb.String()}, nil
	}

	r.Register(&domain.ToolDefinition{
		Name:        "skills_list",
		Description: "List all available skills with their names and descriptions. Use this to discover what skills are installed.",
		JSONSchema:  schema,
		Handler:     handler,
	})
}

// ---------------------------------------------------------------------------
// Built-in tool: skill_view  (Tier 2 progressive disclosure)
// ---------------------------------------------------------------------------

type skillViewArgs struct {
	Name string `json:"name"`
}

func (r *ToolRegistryService) registerSkillViewTool(svc *SkillService) {
	schema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The name of the skill to view"
    }
  },
  "required": ["name"]
}`)

	handler := func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
		var args skillViewArgs
		if err := json.Unmarshal(raw, &args); err != nil {
			return &domain.ToolResult{Content: fmt.Sprintf("invalid skill_view arguments: %v", err), IsError: true}, nil
		}

		if args.Name == "" {
			return &domain.ToolResult{Content: "name is required", IsError: true}, nil
		}

		manifest, err := svc.GetSkill(ctx, meta.AgentID, args.Name)
		if err != nil {
			return &domain.ToolResult{Content: fmt.Sprintf("skill_view failed: %v", err), IsError: true}, nil
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("# Skill: %s\n\n", manifest.Name))
		sb.WriteString(fmt.Sprintf("**Description**: %s\n", manifest.Description))
		sb.WriteString(fmt.Sprintf("**Version**: %d\n", manifest.Version))
		sb.WriteString(fmt.Sprintf("**Trust Level**: %s\n\n", manifest.TrustLevel))
		sb.WriteString("---\n\n")
		sb.WriteString(manifest.Content)

		return &domain.ToolResult{Content: sb.String()}, nil
	}

	r.Register(&domain.ToolDefinition{
		Name:        "skill_view",
		Description: "Load the full SKILL.md content of a specific skill by name. Use this after discovering skills with skills_list.",
		JSONSchema:  schema,
		Handler:     handler,
	})
}

// ---------------------------------------------------------------------------
// Built-in tool: skill_manage  (Tier 3 — create / patch / delete)
// ---------------------------------------------------------------------------

type skillManageArgs struct {
	Action      string `json:"action"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	OldString   string `json:"old_string"`
	NewString   string `json:"new_string"`
}

func (r *ToolRegistryService) registerSkillManageTool(svc *SkillService) {
	schema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": ["create", "patch", "delete"],
      "description": "The management action to perform"
    },
    "name": {
      "type": "string",
      "description": "The skill name"
    },
    "description": {
      "type": "string",
      "description": "Skill description (required for create)"
    },
    "content": {
      "type": "string",
      "description": "Full SKILL.md content (required for create)"
    },
    "old_string": {
      "type": "string",
      "description": "For patch: the text to find (exact or fuzzy)"
    },
    "new_string": {
      "type": "string",
      "description": "For patch: the replacement text"
    }
  },
  "required": ["action", "name"]
}`)

	handler := func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
		var args skillManageArgs
		if err := json.Unmarshal(raw, &args); err != nil {
			return &domain.ToolResult{Content: fmt.Sprintf("invalid skill_manage arguments: %v", err), IsError: true}, nil
		}

		switch args.Action {
		case "create":
			if args.Content == "" || args.Description == "" {
				return &domain.ToolResult{
					Content: "content and description are required for create action",
					IsError: true,
				}, nil
			}

			manifest, scanResult, err := svc.CreateSkill(
				ctx, meta.AgentID, args.Name, args.Description, args.Content,
				domain.TrustLevelCommunity,
			)
			if err != nil {
				msg := fmt.Sprintf("skill create failed: %v", err)
				if scanResult != nil {
					msg += fmt.Sprintf(" (scan verdict: %s)", scanResult.Verdict)
				}
				return &domain.ToolResult{Content: msg, IsError: true}, nil
			}

			return &domain.ToolResult{
				Content: fmt.Sprintf("Skill '%s' created (version %d, verdict: %s).",
					manifest.Name, manifest.Version, manifest.ScanVerdict),
			}, nil

		case "patch":
			if args.OldString == "" || args.NewString == "" {
				return &domain.ToolResult{
					Content: "old_string and new_string are required for patch action",
					IsError: true,
				}, nil
			}

			manifest, err := svc.PatchSkill(ctx, meta.AgentID, args.Name, args.OldString, args.NewString)
			if err != nil {
				return &domain.ToolResult{Content: fmt.Sprintf("skill patch failed: %v", err), IsError: true}, nil
			}

			return &domain.ToolResult{
				Content: fmt.Sprintf("Skill '%s' patched (version %d).", manifest.Name, manifest.Version),
			}, nil

		case "delete":
			if err := svc.DeleteSkill(ctx, meta.AgentID, args.Name); err != nil {
				return &domain.ToolResult{Content: fmt.Sprintf("skill delete failed: %v", err), IsError: true}, nil
			}
			return &domain.ToolResult{Content: fmt.Sprintf("Skill '%s' deleted.", args.Name)}, nil

		default:
			return &domain.ToolResult{
				Content: fmt.Sprintf("unknown skill_manage action %q, expected create/patch/delete", args.Action),
				IsError: true,
			}, nil
		}
	}

	r.Register(&domain.ToolDefinition{
		Name: "skill_manage",
		Description: "Create, patch, or delete skills. Use action='create' with name, description, " +
			"and content to create a new skill. Use action='patch' with name, old_string, new_string " +
			"to fix issues. Use action='delete' with name to remove a skill.",
		JSONSchema: schema,
		Handler:    handler,
	})
}
