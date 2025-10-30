# Pages Rules

This directory contains rules specific to pages in the application. The rules are organized to match the structure of the `lib/pages` directory.

## Directory Structure

- **me/** - Rules for pages in the Me section
- **photo/** - Rules for pages in the Photo section

## Rule Files

- **module_specific_rule_example.yml** - Example of module-specific rules that apply to multiple pages

## Purpose

These rules help maintain consistency across pages by:

1. Enforcing layout patterns specific to each section
2. Ensuring proper navigation between pages
3. Maintaining consistent styling within sections
4. Enforcing section-specific architectural patterns

## Adding Page Rules

When adding new page rules:

1. Place general page rules in this directory
2. Place section-specific rules in the appropriate subdirectory
3. Update `project_rules.yml` to include the new rule file