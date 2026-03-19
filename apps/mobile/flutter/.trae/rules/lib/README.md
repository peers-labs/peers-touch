# Lib-Based Rules Directory

This directory contains rules organized to mirror the project's lib directory structure. This organization makes it easier to find and manage rules related to specific parts of the application.

## Directory Structure

- **components/** - Rules for UI components
  - **common/** - Rules for common components
  - **navigation/** - Rules for navigation components
- **controller/** - Rules for controller classes
- **model/** - Rules for data models
- **pages/** - Rules for pages
  - **me/** - Rules specific to the Me section
  - **photo/** - Rules specific to the Photo section
- **service/** - Rules for service classes
- **store/** - Rules for state management
- **utils/** - Rules for utility functions

## Usage

Place rules in the directory that corresponds to the part of the application they target. For example:

- Rules for `lib/pages/me/me_profile.dart` should go in `rules/lib/pages/me/`
- Rules for `lib/controller/photo_controller.dart` should go in `rules/lib/controller/`

This organization makes it easier to:

1. Find rules related to a specific part of the application
2. Understand which rules apply to which files
3. Maintain rules as the application evolves

## Adding New Rules

When adding new rules, follow these steps:

1. Identify which part of the application the rule targets
2. Place the rule in the corresponding directory
3. Update `project_rules.yml` to include the new rule
4. Add appropriate documentation in the rule file