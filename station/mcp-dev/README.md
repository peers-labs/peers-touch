# MCP-Dev Service

A pure Hertz-based Model Context Protocol (MCP) service for code generation and compliance checking.

## Overview

This service implements the Model Context Protocol (MCP) specification to provide AI agents with tools for:
- Code generation based on project context and templates
- Code compliance checking against project rules
- Project context management
- Template management
- Rule enforcement

## Architecture

The service is built using the Hertz framework and follows a clean architecture pattern:

```
mcp-dev/
├── main.go                 # Entry point
├── internal/
│   ├── types/             # Data structures and MCP protocol types
│   ├── service/           # Business logic services
│   ├── handler/           # HTTP request handlers
│   └── storage/           # Database operations
├── examples/              # Example configurations
└── go.mod                 # Dependencies
```

## Features

### MCP Protocol Support
- **Initialize**: Initialize MCP session with server capabilities
- **List Tools**: Discover available code generation and compliance tools
- **Call Tools**: Execute code generation, compliance checking, and project analysis
- **List Prompts**: Get available prompts for AI agents
- **Get Prompts**: Retrieve specific prompts with context

### Core Services

#### Context Service
- Manages project contexts and configurations
- Stores AI agent configurations
- Handles project metadata and coding standards

#### Template Service
- Manages code templates for different languages and frameworks
- Provides template rendering capabilities
- Validates templates against project rules

#### Rule Service
- Defines and enforces coding standards
- Checks code compliance against project rules
- Generates fix suggestions for violations

#### MCP Service
- Implements MCP protocol endpoints
- Coordinates between other services
- Provides unified interface for AI agents

## API Endpoints

### MCP Protocol Endpoints
- `POST /mcp/initialize` - Initialize MCP session
- `POST /mcp/list-tools` - List available tools
- `POST /mcp/call-tool` - Call a specific tool
- `POST /mcp/list-prompts` - List available prompts
- `POST /mcp/get-prompt` - Get a specific prompt

### Health Check
- `GET /health` - Service health status

## Available Tools

### generate_code
Generates code based on project context and templates.

**Parameters:**
- `project_id` (required): Project identifier
- `template_name` (required): Template name
- `parameters` (optional): Template parameters
- `context_override` (optional): Context overrides

### check_compliance
Checks code compliance against project rules.

**Parameters:**
- `code` (required): Code to check
- `project_id` (required): Project identifier

### get_project_context
Gets project context and configuration.

**Parameters:**
- `project_id` (required): Project identifier

### list_templates
Lists available code templates.

**Parameters:**
- `language` (optional): Programming language
- `framework` (optional): Framework name
- `type` (optional): Template type

### fix_code
Fixes code compliance issues (placeholder implementation).

**Parameters:**
- `code` (required): Code to fix
- `project_id` (required): Project identifier
- `auto_fix` (optional): Auto-fix issues

## Available Prompts

### code_generation
Prompt for code generation with project context and compliance checking.

### compliance_check
Prompt for checking code compliance against project rules.

### project_analysis
Prompt for analyzing project structure and providing insights.

## Configuration

### Project Context
Project contexts define coding standards, dependencies, and AI agent configurations. See `examples/project_context.json` for an example.

### Code Templates
Templates provide reusable code structures for different scenarios. See `examples/code_templates.json` for examples.

### Compliance Rules
Rules define coding standards and best practices. See `examples/compliance_rules.json` for examples.

## Development

### Prerequisites
- Go 1.19 or later
- SQLite (for development)

### Running the Service
```bash
cd mcp-dev
go mod download
go run main.go
```

The service will start on port 8080 by default.

### Database
The service uses SQLite for development. The database file (`mcp_dev.db`) is created automatically on first run.

### Testing
```bash
go test ./...
```

## Integration with AI Agents

The MCP service can be integrated with AI agents like Trae's Agent to provide:
- Context-aware code generation
- Real-time compliance checking
- Project-specific coding standards enforcement
- Automated code suggestions and fixes

### Example Usage with AI Agent

1. **Initialize MCP Session**:
```json
{
  "protocolVersion": "2024-11-05",
  "capabilities": {
    "tools": {"listChanged": true},
    "prompts": {"listChanged": true}
  },
  "clientInfo": {
    "name": "ai-agent",
    "version": "1.0.0"
  }
}
```

2. **Generate Code**:
```json
{
  "name": "generate_code",
  "arguments": {
    "project_id": "peers-touch",
    "template_name": "go_service_template",
    "parameters": {
      "package_name": "myservice",
      "service_name": "MyService",
      "route_path": "/api/myservice"
    }
  }
}
```

3. **Check Compliance**:
```json
{
  "name": "check_compliance",
  "arguments": {
    "code": "package main\n\nfunc main() {\n    println(\"Hello World\")\n}",
    "project_id": "peers-touch"
  }
}
```

## License

This project is part of the Peers Touch ecosystem and follows the same licensing terms.