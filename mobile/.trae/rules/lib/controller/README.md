# Controller Rules

This directory contains rules specific to controller classes in the application. These rules ensure proper implementation and usage of controllers following the GetX pattern.

## Rule Files

- **controller-in-controller-dir.yml** - Ensures controllers are placed in the correct directory
- **controller-management-in-controller.yml** - Enforces proper controller management practices
- **PhotoControllerManagementInPhotoControllerFile.yml** - Specific rules for photo controller management

## Purpose

These rules help maintain a clean architecture by:

1. Ensuring controllers are placed in the correct directory
2. Enforcing proper controller initialization and disposal
3. Preventing component-specific logic in controller files
4. Maintaining separation of concerns

## Adding Controller Rules

When adding new controller rules:

1. Place the rule file in this directory
2. Update `project_rules.yml` to include the new rule file
3. Ensure the rule follows the naming convention and includes proper documentation