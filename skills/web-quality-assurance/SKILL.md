---
name: web-quality-assurance
description: "Test web apps for bugs, friction, and UX failures."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [QA, web, browser, UX, dogfood, accessibility, bugs]
---

# Web Quality Assurance

Class-level browser QA covering systematic exploratory testing and adversarial persona-based UX testing.

## Routing

- `references/dogfood.md` — sitemap-driven exploratory QA, browser-console checks, evidence capture, severity taxonomy, and structured reports.
- `references/adversarial-ux-test.md` — roleplay a difficult user, test core workflows, capture friction, then apply a pragmatism filter before creating tickets.

## Shared Workflow

1. Define target URL, scope, user goal, and output location.
2. Exercise real workflows, not just a feature tour.
3. Check DOM/accessibility snapshots, visual rendering, and console errors after meaningful interactions.
4. Capture reproducible evidence for every retained finding.
5. Separate functional defects, accessibility issues, UX friction, feature requests, and persona noise.
6. Deduplicate and prioritize; report steps, expected/actual behavior, severity, and screenshots.

Use adversarial persona testing as a mode inside the broader QA workflow, not as a separate one-session skill.

## Support Files

- `references/issue-taxonomy.md` — severity and category system.
- `templates/dogfood-report-template.md` — standard QA report.
