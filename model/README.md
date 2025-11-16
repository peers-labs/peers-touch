# Protobuf Code Generation

This directory contains the `.proto` files and the scripts required to generate the corresponding Dart and Go code.

## Prerequisites

Before you can generate the code, you need to have the following tools installed and available in your system's PATH:

1.  **protoc**: The protobuf compiler. You can download it from the [official repository](https://github.com/protocolbuffers/protobuf/releases).
2.  **protoc-gen-dart**: The Dart plugin for `protoc`. You can install it by running:
    ```sh
    pub global activate protoc_plugin
    ```

## Configuration

The code generation process relies on a local configuration file named `env.bat` to locate the `protoc-gen-dart` plugin. This file is ignored by Git and must be created manually.

**Action Required:**

1.  Create a new file named `env.bat` inside the `model` directory.
2.  Add the following line to the file, replacing the path with the actual path to your `protoc-gen-dart.bat` executable:

    ```bat
    set PROTOC_GEN_DART_PLUGIN="C:\Users\<Your-Username>\AppData\Local\Pub\Cache\bin\protoc-gen-dart.bat"
    ```

    **Note:** Remember to replace `<Your-Username>` with your actual Windows username.

## Usage

Once `env.bat` is configured, you can generate the code for all `.proto` files by running the `build.bat` script:

```sh
build.bat
```