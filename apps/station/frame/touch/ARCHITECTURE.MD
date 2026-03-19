# Touch Module Architecture

## Overview
The `touch` module serves as the HTTP traffic entry point for the Peers Touch Station. It is responsible for handling incoming HTTP requests, routing them to appropriate handlers, and managing the core business logic through its submodules.

## Architectural Rules

1.  **HTTP Entry Point**: `touch` is the designated entry point for all HTTP traffic.
2.  **Directory Structure**:
    *   **Root (`station/frame/touch/`)**: Contains only **routers** and **handlers**.
    *   **Subdirectories (`station/frame/touch/*/`)**: Contain the **core business logic** for each module (e.g., `activitypub`, `mastodon`, `peers`).
3.  **Separation of Concerns**:
    *   **Handlers**: Responsible for parsing HTTP requests (headers, query parameters, body, path variables) and converting them into domain models. They also handle the construction of HTTP responses. no any db|store operations! 
    *   **Core Logic (Submodules)**: Must **NOT** accept HTTP-specific parameters (like `*app.RequestContext`, `http.Request`, `http.ResponseWriter`). The only allowed infrastructure parameter is `context.Context`.
4.  **Data Flow**:
    *   Request -> `Handler` (Parses HTTP -> Model) -> `Core Logic` (Processes Model) -> `Handler` (Formats Result -> HTTP Response) -> Response.
5.  **Refactoring Mandate**:
    *   All existing code in submodules (e.g., `activitypub`) that violates these rules (e.g., taking `*app.RequestContext`) must be refactored to accept domain models or primitive types.
