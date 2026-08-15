# Search Intelligence Packet

This packet is the missing step between route scoping and rewrite work.

Its job is to stop the content pass from relying only on internal taste,
existing copy, or route labels when the market is signaling something else.

Keywords are a sampling mechanism here, not the end goal.

The purpose of the packet is to identify which external pages are winning on
the competitive queries that matter, then run copy and framing forensics on
those winners.

## What It Should Answer

- Which query families matter for the included routes?
- Is the query intent clean, or split?
- Who actually dominates the live SERP?
- Are directories, aggregators, local packs, brokerages, or boutiques winning?
- What tone, style, and framing patterns are those winners using?
- What proof devices, trust signals, and conversion cues are those winners using?
- What title and framing patterns keep repeating?
- Which assumptions about the page role are supported, and which need revision?

## Recommended Data Sources

Use this order:

1. `dataforseo-client` via Bun helper scripts
2. raw REST calls to DataForSEO for any route the generated client makes awkward
3. the upstream MCP prompt recipes as workflow references, not as a substitute
   for your own artifact

## Core Tool Bundle

Minimum packet:

- `dataforseo_labs_google_keyword_suggestions`
- `dataforseo_labs_google_related_keywords`
- `kw_data_google_ads_search_volume`
- `dataforseo_labs_bulk_keyword_difficulty`
- `dataforseo_labs_search_intent`
- `dataforseo_labs_google_competitors_domain`
- `dataforseo_labs_google_serp_competitors`
- `serp_organic_live_advanced`

Optional but valuable:

- `content_analysis_search`
- `on_page_content_parsing`
- `ai_opt_llm_ment_top_domains`

## Helper Scripts

Use:

- `scripts/dataforseo-runtime.ts`
- `scripts/sitewide-serp-intelligence.ts`

The wrapper script should prefer the generated `dataforseo-client` APIs first,
then use REST only where the client surface is missing or materially awkward.

## Output Artifacts

Produce:

1. A keyword packet CSV
2. A SERP intelligence markdown summary

Recommended fields in the CSV:

- `seed_keyword`
- `candidate_keyword`
- `discovery_sources`
- `search_volume`
- `difficulty`
- `main_intent`
- `secondary_intents`
- `cpc`
- `monthly_trend`
- `yearly_trend`

Recommended sections in the markdown summary:

- inputs and assumptions
- top candidate queries
- competitor discovery
- live SERP snapshot
- SERP leader voice and framing signals
- what to steal and improve
- what to avoid or invert
- repeated title and framing patterns
- optional AI visibility note
- assumption checks
- implications for Wave 1 route roles

## How It Fits The Workflow

Run this packet:

- after route scoping
- before voice work
- before page-role lock
- before any page-level rewrite

The output should feed:

- `competitive-intelligence`
- `content-strategy`
- `brand-voice`
- `style-forensics`
- `copy-editor`

## Parallel Copy-Forensics Fan-Out

If the packet yields three or more strong non-directory exemplars, fan out
style-forensics in parallel.

Subagent prompts are only acceptable if they include all of these:

- exact skill file to load from
  `your local agent-skills directory`
- exact source URL
- exact context file(s)
- exact owned output file
- exact required report sections
- exact output contract
- explicit instruction to use `agent-browser` for headless browser work

Do not send a thin prompt like "analyze this page" or "use style-forensics on
this domain." That is not enough.

## Anti-Patterns

- Starting the rewrite pass with no live query evidence
- Letting taxonomy or archive route labels define the market framing by
  themselves
- Treating competitor inspiration as copy to imitate
- Collecting competitor pages but failing to extract their voice, tone, or
  framing patterns
- Treating split-intent keywords as if they were clean route targets
- Using only AI Optimization tools for this step and skipping live organic SERP
  data
