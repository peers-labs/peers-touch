# Peers Touch Proto

Centralized protobuf definitions for the Peers Touch ecosystem.

## Overview

This repository contains all Protocol Buffer (protobuf) definitions used across the Peers Touch projects:
- **Backend (Go)**: `peers-touch-station/backend/gen/proto`
- **Frontend (Flutter/Dart)**: `peers-touch-station/frontend/lib/model/proto`
- **Mobile (Flutter/Dart)**: `peers-touch-mobile/lib/model/proto`

## Quick Start

### Prerequisites

- **Go** (for backend code generation)
- **Dart** (for frontend and mobile code generation)

### Generate Code

Run the generation script:

```bash
./generate.sh
```

The script will:
1. 🔍 Detect your operating system (macOS, Linux, Windows)
2. 📦 Install `protoc` if not already installed
3. 🔧 Install required plugins (Go and Dart)
4. 🚀 Generate code for all targets

### First Run

On first run, the script will install dependencies:

**macOS** (via Homebrew):
```bash
brew install protobuf
```

**Linux** (via apt/yum/pacman):
```bash
sudo apt-get install protobuf-compiler  # Ubuntu/Debian
sudo yum install protobuf-compiler      # CentOS/RHEL
sudo pacman -S protobuf                 # Arch
```

**Windows** (via Chocolatey/Scoop):
```bash
choco install protoc    # Chocolatey
scoop install protobuf  # Scoop
```

### Subsequent Runs

The script is smart - it only installs what's missing and proceeds directly to code generation.

## Project Structure

```
peers-touch-proto/
├── v1/                    # Protobuf definitions
│   └── moments.proto      # Family moments feature
├── generate.sh            # Cross-platform generation script
└── README.md             # This file
```

## Generated Output

After running `./generate.sh`, code will be generated in:

### Backend (Go)
```
../peers-touch-station/backend/gen/proto/
├── moments.pb.go
└── moments_grpc.pb.go
```

### Desktop (Flutter/Dart)
```
../peers-touch-station/desktop/lib/model/proto/
├── moments.pb.dart
├── moments.pbenum.dart
└── moments.pbgrpc.dart
```

### Mobile (Flutter/Dart)
```
../peers-touch-mobile/lib/model/proto/
├── moments.pb.dart
├── moments.pbenum.dart
└── moments.pbgrpc.dart
```

## Generation Configuration

Each proto file can include a special comment block that controls where its code is generated:

```protobuf
// PEERS_GENERATION_CONFIG:
// target: peers-touch-station/backend/gen/proto/v1
// target: peers-touch-station/desktop/lib/model/proto
// target: peers-touch-mobile/lib/model/proto
```

Or to skip specific targets:

```protobuf
// PEERS_GENERATION_CONFIG:
// skip: peers-touch-station/desktop/lib/model/proto
```

The generation script will read these configurations and only generate code for the specified targets. If no configuration is provided, code will be generated for all targets by default.

## Adding New Proto Files

1. Create your `.proto` file in the `v1/` directory
2. Follow the naming convention: `feature_name.proto`
3. Set the correct `go_package` option:
   ```protobuf
   option go_package = "github.com/dirty-bro-tech/peers-touch-proto/v1/feature_name";
   ```
4. Add a generation configuration to specify which targets should receive generated code:
   ```protobuf
   // PEERS_GENERATION_CONFIG:
   // target: peers-touch-station/backend/gen/proto/v1
   // target: peers-touch-station/desktop/lib/model/proto
   // target: peers-touch-mobile/lib/model/proto
   ```
   Or to skip specific targets:
   ```protobuf
   // PEERS_GENERATION_CONFIG:
   // skip: peers-touch-station/desktop/lib/model/proto
   ```
5. Run `./generate.sh` to generate code for the specified targets

## Example Proto File

```protobuf
syntax = "proto3";

package peers_touch.v1;

// PEERS_GENERATION_CONFIG:
// target: peers-touch-station/backend/gen/proto/v1
// target: peers-touch-station/desktop/lib/model/proto
// target: peers-touch-mobile/lib/model/proto

option go_package = "github.com/dirty-bro-tech/peers-touch-proto/v1/example";

message ExampleMessage {
  string id = 1;
  string content = 2;
  int64 created_at = 3;
}

service ExampleService {
  rpc CreateExample(CreateExampleRequest) returns (CreateExampleResponse);
}

message CreateExampleRequest {
  ExampleMessage example = 1;
}

message CreateExampleResponse {
  ExampleMessage example = 1;
}
```

## Troubleshooting

### Permission Denied
```bash
chmod +x generate.sh
```

### Missing Package Manager
- **macOS**: Install [Homebrew](https://brew.sh/)
- **Windows**: Install [Chocolatey](https://chocolatey.org/) or [Scoop](https://scoop.sh/)
- **Linux**: Use your distribution's package manager

### Manual Installation
If automatic installation fails, install protoc manually:
1. Download from [Protocol Buffers releases](https://github.com/protocolbuffers/protobuf/releases)
2. Extract and add to your PATH
3. Install language-specific plugins:
   ```bash
   go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
   go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
   dart pub global activate protoc_plugin
   ```

## Features

- ✅ **Cross-platform**: Works on macOS, Linux, and Windows
- ✅ **Smart installation**: Only installs missing dependencies
- ✅ **Multi-target**: Generates Go and Dart code for all platforms
- ✅ **Automatic setup**: Handles all plugin installations
- ✅ **Error handling**: Clear error messages and validation
- ✅ **Compliance tools**: Scripts to enforce proto hub usage across projects

## Proto Hub Rules

### Core Principles

1. **Central Definition**: All protocol buffer definitions MUST be created in this repository first.
2. **No Auto-Generation**: Protocol buffers should NOT be automatically generated by individual projects.
3. **Cross-Project Exchange**: Any data model used for exchanging information between different projects MUST be defined here.
4. **Version Control**: All proto files should be properly versioned in the `v1/` directory (or subsequent version directories as needed).

### Workflow for Teams

1. **Define First**: Before implementing a feature that requires data exchange between projects, define the proto models here.
2. **Review Process**: Proto definitions should be reviewed to ensure they follow best practices and are reusable.
3. **Generate Code**: After approval, run `./generate.sh` to generate code for all target projects.
4. **Import in Projects**: Only use the generated code in your projects, never create duplicate definitions.

### Warning for Developers

If you find yourself creating data models for cross-project communication that don't exist in this repository:

⚠️ **STOP**: Do not proceed with implementation
⚠️ **DEFINE**: First define the proto models in this repository
⚠️ **GENERATE**: Run the generation script
⚠️ **THEN IMPLEMENT**: Only then implement your feature using the generated code

### Enforcement

Project leads should enforce these rules by:

1. Including proto definition checks in code reviews
2. Setting up CI/CD pipelines to verify proper proto usage
3. Educating team members about the importance of centralized proto definitions

## Contributing

1. Add your `.proto` files to the `v1/` directory
2. Follow the existing naming conventions
3. Test code generation with `./generate.sh`
4. Ensure all target projects can import the generated code
5. Document the purpose and usage of your proto models

---

**Note**: This script automatically manages protoc installation and only installs dependencies when they're missing, making it efficient for repeated use.

## Compliance Tools

This repository includes tools to enforce the Proto Hub Rules:

### Check Proto Compliance

Verify that a project is using only proto definitions from the central repository:

```bash
./check_proto_compliance.sh ../path/to/project
```

### Git Hooks

Install pre-commit hooks to check compliance before each commit:

```bash
./hooks/install_hooks.sh ../path/to/project
```

### CI/CD Integration

A GitHub Actions workflow is provided in `.github/workflows/proto_compliance.yml` to automatically check compliance on push and pull requests.

### Detailed Guidelines

For comprehensive guidelines on using the proto hub, see [PROTO_GUIDELINES.md](./PROTO_GUIDELINES.md).