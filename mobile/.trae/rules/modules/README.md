# Modules Rules Directory

This directory contains rules that are specific to individual modules in the application.

## Purpose

The Modules directory is part of the customized rule structure and focuses on rules that apply only to specific modules. This allows for targeted rule enforcement at the module level without affecting other parts of the application.

## When to Use

Place rules in this directory when:
- The rule applies to a specific module or set of modules
- You need to enforce module-specific design, structure, or behavior requirements
- You want to isolate module-specific rules from global rules

## Contents

Each file in this directory should target specific modules using the `target` section in the rule configuration:

```yaml
target:
  directories:
    - "lib/modules/specific_module/"
```

## Examples

Example rule files might include:
- `auth_module_rules.yml` - Rules specific to the authentication module
- `chat_module_rules.yml` - Rules specific to the chat module
- `media_module_rules.yml` - Rules specific to the media module