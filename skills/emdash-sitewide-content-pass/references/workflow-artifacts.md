# Workflow Artifacts

Use these artifact shapes during an EmDash sitewide content pass.

The point is not bureaucracy. The point is to make route decisions durable and
keep shared copy from being rediscovered over and over.

## 1. Route Inventory

Minimum columns:

| Column           | Why it exists                                                         |
| ---------------- | --------------------------------------------------------------------- |
| `route`          | The live URL path                                                     |
| `route_owner`    | Astro page file or route pattern                                      |
| `route_family`   | Group related taxonomy or archive variants                            |
| `route_type`     | `home`, `cms-page`, `archive`, `taxonomy-archive`, `detail`, `system` |
| `content_origin` | `cms-page`, `cms-collection-entry`, `mixed-route+cms`, `code-route`   |
| `status`         | `include`, `defer`, `exclude`                                         |
| `why`            | Why the route landed in that bucket                                   |
| `wave`           | The planned rewrite wave                                              |
| `notes`          | Anything unresolved                                                   |

## 2. Header Inventory

Minimum columns:

| Column             | Why it exists                                      |
| ------------------ | -------------------------------------------------- |
| `route`            | Where the heading rendered                         |
| `heading_order`    | Top-to-bottom sequence                             |
| `heading_level`    | `h1` to `h6`                                       |
| `heading_text`     | Live copy                                          |
| `scope`            | `page-local`, `shared-conversion`, `global-chrome` |
| `context`          | Nearest section or structural anchor               |
| `source_hint`      | Fast path back to the renderer                     |
| `duplicate_count`  | Shared-copy detection                              |
| `duplicate_routes` | Which routes share it                              |

## 3. Search-Intelligence Packet

This packet should exist before page-role lock and before rewriting.

Minimum outputs:

### Keyword packet CSV

| Column              | Why it exists                               |
| ------------------- | ------------------------------------------- |
| `seed_keyword`      | The original framing seed                   |
| `candidate_keyword` | Candidate search query                      |
| `discovery_sources` | Which DataForSEO discovery path produced it |
| `search_volume`     | Demand signal                               |
| `difficulty`        | Competition signal                          |
| `main_intent`       | Dominant intent                             |
| `secondary_intents` | Split-intent warning                        |
| `cpc`               | Commercial pressure signal                  |
| `monthly_trend`     | Near-term momentum                          |
| `yearly_trend`      | Longer trend direction                      |

### SERP intelligence summary

Minimum sections:

- inputs and assumptions
- competitor discovery
- live SERP snapshot
- repeated title and framing patterns
- optional AI visibility note
- assumption checks
- implications for Wave 1 route roles

## 4. Copy-Surface Inventory

This is the artifact that closes the gap between a heading audit and a real
copy audit.

Use it to inventory all of the core non-header copy surfaces that influence
conversion, trust, proof, and route clarity.

Minimum columns:

| Column                | Why it exists                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `route_or_module`     | The route or shared module owning the copy                                                                 |
| `surface_name`        | Human-readable label for the copy surface                                                                  |
| `surface_type`        | hero-support, lead, proof block, testimonial, CTA, form helper, FAQ answer, empty state, post-submit, etc. |
| `component_or_source` | Where the copy currently lives                                                                             |
| `scope`               | `page-local`, `shared-module`, `global-chrome`                                                             |
| `current_copy`        | Live or source copy snapshot                                                                               |
| `job`                 | What that copy block is supposed to do                                                                     |
| `audit_focus`         | clarity, proof, conversion, trust, differentiation, tone                                                   |
| `key_issue`           | The main thing currently wrong or missing                                                                  |
| `priority`            | `must`, `should`, `could`                                                                                  |
| `next_action`         | revise, suppress, replace, consolidate, prove, split, etc.                                                 |

Typical surfaces to include:

- hero supporting copy
- lead paragraphs
- proof blocks and stat strips
- testimonial excerpts
- CTA labels and ladders
- form labels, placeholders, and reassurance lines
- FAQ answer quality
- empty and placeholder states
- post-submit reassurance
- newsletter and insider value propositions

## 5. CTA And Shared-Module Inventory

This is the artifact the pilot showed was missing.

Minimum columns:

| Column                 | Why it exists                                        |
| ---------------------- | ---------------------------------------------------- |
| `module_name`          | Human-readable module or block name                  |
| `component_or_surface` | Component, block, or page fragment owner             |
| `routes`               | Where it appears                                     |
| `copy_type`            | headline, body, CTA label, footer label, helper text |
| `current_copy`         | Live string                                          |
| `scope`                | `page-local`, `shared-module`, `global-chrome`       |
| `decision_owner`       | Which rewrite wave should decide it                  |
| `notes`                | Drift, duplication, or unresolved questions          |

Examples of shared modules worth tracking:

- contact capture blocks
- newsletter float copy
- footer column headings
- archive intro and “all writing” style links
- repeated hero or archive CTA rows

## 6. Page-Role Matrix

Minimum columns:

| Column                   | Why it exists                                                      |
| ------------------------ | ------------------------------------------------------------------ |
| `route_or_family`        | Page or compressed route family                                    |
| `primary_job`            | positioning, proof, conversion, archive navigation, legal, support |
| `audience_stage`         | awareness, consideration, decision, retention, trust               |
| `conversion_expectation` | what the user should do next                                       |
| `must_keep`              | the core promise or job this page cannot lose                      |
| `current_problem`        | short diagnosis                                                    |
| `target_outcome`         | what better looks like                                             |

## 7. Rewrite Ledger

Minimum columns:

| Column            | Why it exists                                          |
| ----------------- | ------------------------------------------------------ |
| `route_or_family` | The unit of work                                       |
| `status`          | `include`, `defer`, `exclude`                          |
| `wave`            | Planned order                                          |
| `priority`        | high, medium, low                                      |
| `current_role`    | What the page is doing now                             |
| `target_role`     | What the page should do                                |
| `skill_stack`     | Which skills apply                                     |
| `blockers`        | Missing source material, unresolved role, schema issue |
| `approval_state`  | not started, in review, approved, applied              |
| `notes`           | Editorial decisions or caveats                         |

## Compression Rules

Use one ledger row for a route family when:

- the routes share the same template
- the page job is the same
- the copy differences are primarily content-entry differences, not shell
  differences

Split the family into separate rows only when:

- one member has a materially different role
- one member is durable and another is placeholder-like
- one member contains unique conversion or trust responsibilities

## Wave Budget

Default wave budget:

- Wave 1: up to 5-10 durable primary routes plus shared modules they depend on
- Wave 2: one archive family at a time
- Wave 3: utility, compliance, and repeated chrome

If the route count feels too large, compress more aggressively before editing
starts.
