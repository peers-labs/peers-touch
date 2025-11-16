# Components Rules

This directory contains rules specific to UI components in the application. The rules are organized to match the structure of the `lib/components` directory.

## Directory Structure

- **common/** - Rules for common reusable components
- **navigation/** - Rules for navigation-related components

## Rule Files

- **04_component_rules.yml** - General component rules that apply across the application

## Adding Component Rules

When adding new component rules:

1. Place general component rules in this directory
2. Place component-specific rules in the appropriate subdirectory
3. Update `project_rules.yml` to include the new rule file