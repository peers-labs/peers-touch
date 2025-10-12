# Generated Protocol Buffer Code

⚠️ **WARNING: DO NOT EDIT FILES IN THIS DIRECTORY** ⚠️

This directory contains automatically generated Go code from Protocol Buffer definitions. 

## Important Notes

- **DO NOT** manually edit any `.pb.go` files in this directory
- **DO NOT** add custom code to generated files
- All changes should be made to the source `.proto` files in the `peers-touch-proto` project
- Generated files will be overwritten when proto definitions are updated

## Regenerating Code

To regenerate the code in this directory:

1. Make changes to the `.proto` files in `peers-touch-proto/v2/`
2. Run the proto generation command from the `peers-touch-proto` directory:
   ```bash
   protoc --go_out=../peers-touch-go/model/v2 \
          --go_opt=module=github.com/dirty-bro-tech/peers-touch-go/model/v2 \
          --proto_path=v2 \
          v2/*.proto
   ```

## Generated Files

This directory contains the following generated packages:
- `common/` - Common data types and error definitions
- `identity/` - Identity management types
- `connection/` - Connection and networking types  
- `communication/` - Message and communication types
- `discovery/` - Service and peer discovery types

## Usage

Import these packages in your Go code like:
```go
import (
    "github.com/dirty-bro-tech/peers-touch-go/model/v2/identity"
"github.com/dirty-bro-tech/peers-touch-go/model/v2/communication"
    // ... other packages
)
```