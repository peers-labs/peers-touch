# Trae Rules Directory Structure

This directory contains rules for the Trae AI code analysis and enforcement system. The rules are organized into three main categories: global rules, customized rules, and lib-based rules.

## Directory Structure

### Global Rules

Global rules apply to the entire codebase and are organized by their purpose:

- **architecture/** - Rules related to the overall architecture of the application
- **code_quality/** - Rules enforcing code quality standards
- **components/** - Rules for general component implementation
- **style/** - Rules for styling, colors, typography, and layout
  - **color_rules.yml** - Light theme color definitions
  - **dark_theme_color_rules.yml** - Dark theme color definitions
  - **typography_rules.yml** - Typography guidelines
  - **layout_spacing_rules.yml** - Spacing and layout guidelines
  - **theme_selection_guide.md** - When to use light vs dark theme

### Customized Rules

Customized rules target specific parts of the application:

- **pages/** - Rules that apply only to specific pages
  - **me/** - Rules for Me section pages
    - **me_profile_dark_theme.yml** - Dark theme styling for Me Profile page
    - **me_profile_implementation_guide.md** - Implementation guide for Me Profile page
- **modules/** - Rules that apply only to specific modules
- **special_components/** - Rules for specific components that require special handling

### Lib-Based Rules

Lib-based rules are organized to mirror the project's lib directory structure, making it easier to find and manage rules related to specific parts of the application:

- **lib/** - Rules organized by project structure
  - **components/** - Rules for UI components (common, navigation)
  - **controller/** - Rules for controller classes
  - **model/** - Rules for data models
  - **pages/** - Rules for pages (me, photo)
  - **service/** - Rules for service classes
  - **store/** - Rules for state management
  - **utils/** - Rules for utility functions

## Configuration

The main configuration file is `project_rules.yml`, which includes all the rule files from the various directories. The configuration has been updated to reference rules from the new lib-based directory structure.

## Adding New Rules

1. Determine whether your rule should be global, customized, or lib-based
2. For lib-based rules, place the rule file in the directory that corresponds to the part of the application it targets (e.g., rules for `lib/pages/me/profile.dart` should go in `rules/lib/pages/me/`)
3. For global or customized rules, place the rule file in the appropriate directory based on its purpose
4. Add a reference to the rule file in `project_rules.yml`
5. Consider adding documentation in the README.md file of the directory where you placed the rule

## Naming Conventions

- Global rule files should be named according to their purpose (e.g., `color_rules.yml`)
- Customized rule files should be named according to their target (e.g., `home_page_rules.yml`)
- Lib-based rule files should follow the naming conventions of the files they target (e.g., `me_profile_specific_rules.yml` for rules targeting `me_profile.dart`)
- Use descriptive names that clearly indicate the purpose or target of the rules