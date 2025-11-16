# Special Components Rules Directory

This directory contains rules that are specific to individual special components in the application.

## Purpose

The Special Components directory is part of the customized rule structure and focuses on rules that apply only to specific components that require special handling. This allows for targeted rule enforcement for complex or critical components without affecting other parts of the application.

## When to Use

Place rules in this directory when:
- The rule applies to a specific component or set of components that require special attention
- You need to enforce component-specific design, structure, or behavior requirements
- The component has unique requirements that don't fit into the global components rules

## Contents

Each file in this directory should target specific components using the `target` section in the rule configuration:

```yaml
target:
  files:
    - "lib/components/special_component.dart"
```

## Examples

Example rule files might include:
- `custom_avatar_rules.yml` - Rules specific to the custom avatar component
- `interactive_map_rules.yml` - Rules specific to the interactive map component
- `video_player_rules.yml` - Rules specific to the video player component