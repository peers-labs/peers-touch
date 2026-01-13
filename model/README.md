# Proto Code Generation

## Overview

This directory contains Protocol Buffer definitions for the Peers Touch project. The `build.sh` script generates code for both Go (Station) and Dart (Client).

## Usage

```bash
./build.sh
```

This will:
1. Generate Go code to `../station/`
2. Generate Dart code to `../client/common/peers_touch_base/lib/model/`
3. Automatically fix Dart import paths for well-known types

## Important Notes

### Dart Import Path Fixes

The script automatically fixes import paths for Google's well-known types (`Timestamp`, `Struct`, `Any`) because:

- **Problem**: `protoc` generates imports like `package:protobuf/well_known_types/google/protobuf/timestamp.pb.dart`
- **Issue**: This path doesn't exist in `protobuf` 5.x package
- **Solution**: We generate local copies and rewrite imports to `package:peers_touch_base/model/google/protobuf/...`

The following replacements are automatically applied after generation:
```bash
# In domain/*.pb.dart files
package:protobuf/well_known_types/google/protobuf/timestamp.pb.dart
  → package:peers_touch_base/model/google/protobuf/timestamp.pb.dart

package:protobuf/well_known_types/google/protobuf/struct.pb.dart
  → package:peers_touch_base/model/google/protobuf/struct.pb.dart

# In google/protobuf/struct.pb.dart
package:protobuf/well_known_types/google/protobuf/struct.pbenum.dart
  → package:peers_touch_base/model/google/protobuf/struct.pbenum.dart
```

### Do NOT Manually Edit Generated Files

All `.pb.dart` and `.pb.go` files are generated. Any manual changes will be overwritten on the next build.

If you need to change imports or fix issues:
1. Modify the `build.sh` script
2. Re-run `./build.sh`

## Directory Structure

```
model/
├── build.sh              # Generation script
├── domain/               # Business domain protos
│   ├── actor/
│   ├── social/
│   ├── ai_box/
│   └── ...
└── google/               # Google well-known types
    └── protobuf/
        ├── timestamp.proto
        ├── struct.proto
        └── any.proto
```

## Requirements

- `protoc` (Protocol Buffer Compiler)
- `protoc-gen-go` (Go plugin)
- `protoc-gen-dart` (Dart plugin, installed via `flutter pub get`)

## Troubleshooting

### "Type 'Timestamp' not found" in Dart

This means the import path fix didn't run. Re-run `./build.sh`.

### "Cyclic imports" in Go

Check `go_package` options in `.proto` files and ensure they match the module structure.

### Import path errors after generation

The script automatically fixes these. If you see errors, ensure:
1. The `build.sh` script has execute permissions: `chmod +x build.sh`
2. You're running the script from the `model/` directory
3. The `sed` commands in the script are compatible with your OS (macOS uses `sed -i ''`, Linux uses `sed -i`)
