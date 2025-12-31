# Declare repository type as network framework
project:
  type: network_framework
  description: Peer-to-peer network framework for decentralized applications
  features:
    - peer-to-peer communication
    - distributed data synchronization
    - network protocol handling
    - libp2p protocol implementation
  
  # Project structure information
  examples_directory: peers-touch-go/example
  
# Development Guidelines
development:
  examples:
    location: "peers-touch-go/example"
    description: "Contains example implementations and usage demonstrations for the framework"
    note: "When providing examples or demonstrating usage, refer to this directory for existing patterns and implementations"
  
  # Coding Standards
  standards:
    - "Backend Interaction: Use Protobuf defined structures instead of Map unless necessary."

# base prompts

  - desktop： client\desktop\PROMPTs

# Markdown Prompts
  - content language: English by default. When file name contains ".zh.", use Chinese.

# Dart/Flutter Code Style Guidelines
# AI MUST follow these rules when generating Dart/Flutter code under client/
dart_flutter:
  lint_config: client/analysis_options.yaml
  
  rules:
    # Import ordering (directives_ordering)
    - "dart: imports first, then package: imports, then relative imports"
    - "Sort imports alphabetically within each section"
    
    # String style (prefer_single_quotes)
    - "Use single quotes for strings, except when the string contains a single quote"
    
    # Flow control (curly_braces_in_flow_control_structures)
    - "Always use curly braces for if/else/for/while statements"
    
    # Variable declarations (prefer_final_locals, prefer_final_fields)
    - "Use final for local variables that are not reassigned"
    - "Use final for fields that are not reassigned"
    
    # Constructors (sort_constructors_first)
    - "Place constructor declarations before other members"
    
    # Package imports (always_use_package_imports)
    - "Use package: imports for files in lib/ directory"
    
    # Avoid deprecated APIs
    - "Use Color.withValues(alpha: x) instead of withOpacity(x) or withAlpha(x)"
    
    # Avoid print in production
    - "Use LoggingService instead of print() for logging"

  example_import_order: |
    // Correct import order:
    import 'dart:async';
    import 'dart:convert';
    
    import 'package:flutter/material.dart';
    import 'package:get/get.dart';
    
    import 'package:peers_touch_base/context/global_context.dart';
    import 'package:peers_touch_desktop/core/services/logging_service.dart';

