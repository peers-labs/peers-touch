# Me Section Rules

## Overview
This directory contains rules specific to pages in the Me section of the application. These rules define how the Me section pages should be styled, structured, and behave.

## Rule Files

- **me_profile_layout_rules.yml** - Layout rules for the Me Profile page
- **me_profile_controller_rules.yml** - Rules specific to the Me Profile page
- **avatar_page_rules.yml** - Rules specific to the Avatar Change page
- **me_profile_dark_theme.yml** - Defines the dark theme styling for the Me Profile page

## Purpose

These rules ensure consistency and quality in the Me section by:

1. Enforcing proper layout for profile information
2. Ensuring correct implementation of avatar handling
3. Maintaining consistent styling across Me section pages
4. Enforcing proper controller usage in Me section pages

## Design Guidelines

### Dark Theme Implementation
The Me Profile page uses a dark theme with the following key characteristics:
- Black background (`#000000`)
- White text (`#FFFFFF`)
- Semi-transparent white dividers (`rgba(255, 255, 255, 0.1)`)
- Horizontal layout for profile fields with labels on the left and values on the right
- Right-aligned values with chevron icons for navigable items
- No container decorations (flat design)

### Implementation Notes
When implementing the Me Profile page from scratch:
1. Start with a black `Scaffold` background
2. Use a black `AppBar` with white text and a thin semi-transparent white bottom border
3. Implement profile fields in a horizontal layout with full-width dividers
4. Use white text for all content
5. Add chevron icons for navigable items
6. Ensure the avatar is properly sized and positioned
7. Follow the spacing guidelines from the layout spacing rules

## Adding Me Section Rules

When adding new rules for the Me section:

1. Place the rule file in this directory
2. Update `project_rules.yml` to include the new rule file
3. Ensure the rule follows the naming convention and includes proper documentation