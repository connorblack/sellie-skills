import fs from "node:fs/promises";
import path from "node:path";
import * as dfs from "dataforseo-client";
import {
  createDataForSeoApis,
  getNestedItems,
  getTaskResults,
  readNumber,
  readRecord,
  readString,
  readStringArray,
} from "./dataforseo-runtime";

type JsonRecord = Record<string, unknown>;

interface KeywordMetricRow {
  candidateKeyword: string;
  cpc: number | null;
  difficulty: number | null;
  discoverySources: string[];
  mainIntent: string | null;
  monthlyTrend: number | null;
  searchVolume: number | null;
  secondaryIntents: string[];
  seedKeyword: string;
  yearlyTrend: number | null;
}

interface SerpWinner {
  description: string | null;
  domain: string | null;
  kind: "local-pack" | "organic";
  rankAbsolute: number | null;
  title: string | null;
  url: string | null;
}

interface CompetitorPageSample {
  domain: string;
  forensics: string[];
  hTitle: string | null;
  level: number | null;
  mainTitle: string | null;
  primaryExcerpt: string | null;
  sampleText: string | null;
  query: string;
  topicTitles: string[];
  url: string;
  wordCount: number;
}

interface VoiceSignal {
  count: number;
  label: string;
}

interface CliArgs {
  brand: string;
  competitors: string[];
  domain: string;
  language: string;
  location: string;
  outCsv: string;
  outMd: string;
  seeds: string[];
}

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null;

const stopWords = new Set([
  "a",
  "an",
  "and",
  "broker",
  "brokers",
  "estate",
  "for",
  "in",
  "llc",
  "new",
  "of",
  "on",
  "real",
  "team",
  "the",
  "to",
  "york",
]);

const csvEscape = (value: unknown): string => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const splitList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "site";

function dateStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(
    2,
    "0",
  )}`;
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument --${key}`);
    }
    values.set(key, value);
    index += 1;
  }

  const brand = readString(values.get("brand"));
  const domain = readString(values.get("domain"));
  const seeds = splitList(values.get("seeds"));
  if (!brand || !domain || seeds.length === 0) {
    throw new Error(
      "Usage: bun sitewide-serp-intelligence.ts --brand <name> --domain <domain> --seeds <comma,separated,seeds>",
    );
  }

  const outputDir = path.resolve(
    values.get("out-dir") ?? "./plans/audits",
  );
  const baseName = `${dateStamp()}-${slugify(domain)}-sitewide-serp-intelligence`;

  return {
    brand,
    competitors: splitList(values.get("competitors")),
    domain,
    language: readString(values.get("language")) ?? "en",
    location: readString(values.get("location")) ?? "United States",
    outCsv: path.resolve(values.get("out-csv") ?? path.join(outputDir, `${baseName}.csv`)),
    outMd: path.resolve(values.get("out-md") ?? path.join(outputDir, `${baseName}.md`)),
    seeds,
  };
}

function collectResultItems(result: JsonRecord): JsonRecord[] {
  const items = result.items;
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

function addDiscoveryKeyword(
  map: Map<string, { seedKeyword: string; sources: Set<string>; trend: JsonRecord | null }>,
  seedKeyword: string,
  keyword: string | null,
  source: string,
  trend: JsonRecord | null,
) {
  if (!keyword) return;
  const normalized = keyword.toLowerCase();
  const existing = map.get(normalized);
  if (existing) {
    existing.sources.add(source);
    if (!existing.trend && trend) existing.trend = trend;
    return;
  }
  map.set(normalized, {
    seedKeyword,
    sources: new Set([source]),
    trend,
  });
}

function trendValue(trend: JsonRecord | null, key: "monthly" | "yearly"): number | null {
  return trend ? readNumber(trend[key]) : null;
}

function tokenFrequencies(values: string[]): Array<{ count: number; token: string }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length < 3 || stopWords.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([token, count]) => ({ count, token }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 12);
}

function sentenceLengths(text: string): number[] {
  return text
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .map((sentence) => sentence.split(/\s+/).filter(Boolean).length);
}

function average(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function detectVoiceSignals(samples: CompetitorPageSample[]): VoiceSignal[] {
  const counters = new Map<string, number>();
  const increment = (label: string) => counters.set(label, (counters.get(label) ?? 0) + 1);

  for (const sample of samples) {
    const text = `${sample.mainTitle ?? ""} ${sample.hTitle ?? ""} ${sample.primaryExcerpt ?? ""}`.toLowerCase();
    if (/(luxury|prestige|exclusive|exceptional)/.test(text)) increment("luxury-prestige");
    if (/(team|group|advisors|brokers)/.test(text)) increment("team-collective");
    if (/(integrity|discretion|honesty|trusted|trusted advisor)/.test(text)) increment("trust-language");
    if (/(20 years|10\+ years|experience|insider knowledge|expert)/.test(text)) increment("authority-experience");
    if (/(buyers|sellers|investors|list|find|transaction)/.test(text)) increment("process-service");
    if (/(manhattan|brooklyn|new york city|nyc|greenwich village|upper east side)/.test(text))
      increment("geographic-specificity");
    if (/(contact|consultation|reach out|connect with us)/.test(text)) increment("direct-invite");
  }

  return [...counters.entries()]
    .map(([label, count]) => ({ count, label }))
    .sort((left, right) => right.count - left.count);
}

function detectProofSignals(
  snapshots: Array<{ winners: SerpWinner[] }>,
  samples: CompetitorPageSample[],
): VoiceSignal[] {
  const counters = new Map<string, number>();
  const increment = (label: string) => counters.set(label, (counters.get(label) ?? 0) + 1);

  for (const winner of snapshots.flatMap((snapshot) => snapshot.winners)) {
    const description = (winner.description ?? "").toLowerCase();
    if (/\b10\+ years\b|\b20 years\b|\byears in business\b/.test(description)) {
      increment("tenure-proof");
    }
    if (/\bknowledgeable\b|\bresponsive\b|\bprofessional\b|\boutstanding service\b/.test(description)) {
      increment("review-backed-trust");
    }
    if (/\btop rated\b|\b5\.0\b|\b4\.9\b/.test(description)) {
      increment("rating-signal");
    }
  }

  for (const sample of samples) {
    const text = `${sample.mainTitle ?? ""} ${sample.hTitle ?? ""} ${sample.primaryExcerpt ?? ""}`.toLowerCase();
    if (/(buyers|sellers|investors)/.test(text)) increment("multi-audience-coverage");
    if (/(manhattan|brooklyn|new york city|nyc|park slope|williamsburg)/.test(text)) {
      increment("neighborhood-specificity");
    }
    if (/(integrity|discretion|honesty|trusted|advisor)/.test(text)) {
      increment("trust-credentials");
    }
  }

  return [...counters.entries()]
    .map(([label, count]) => ({ count, label }))
    .sort((left, right) => right.count - left.count);
}

function collectStealPatterns(snapshots: Array<{ winners: SerpWinner[] }>, samples: CompetitorPageSample[]): string[] {
  const patterns = new Set<string>();

  if (
    snapshots
      .flatMap((snapshot) => snapshot.winners)
      .some((winner) => /\bknowledgeable\b|\bresponsive\b|\bprofessional\b/i.test(winner.description ?? ""))
  ) {
    patterns.add("Use compact trust proof that sounds quoted or observed, not merely self-claimed.");
  }

  if (
    samples.some((sample) =>
      /(manhattan|brooklyn|new york city|nyc|park slope|williamsburg)/i.test(
        `${sample.mainTitle ?? ""} ${sample.primaryExcerpt ?? ""}`,
      ),
    )
  ) {
    patterns.add("Keep geography specific. The winning pages name districts, boroughs, and market context directly.");
  }

  if (samples.some((sample) => /(buyers|sellers|investors|list|find|transaction)/i.test(sample.primaryExcerpt ?? ""))) {
    patterns.add("Explain the service model in concrete operational language, not abstract positioning alone.");
  }

  if (
    samples.some((sample) =>
      /(luxury|extraordinary|exclusive|prestige)/i.test(`${sample.mainTitle ?? ""} ${sample.primaryExcerpt ?? ""}`),
    )
  ) {
    patterns.add(
      "Where the market signals prestige, use confidence and polish, but tie it to substance instead of empty luxury adjectives.",
    );
  }

  return [...patterns];
}

function collectAvoidPatterns(snapshots: Array<{ winners: SerpWinner[] }>): string[] {
  const patterns = new Set<string>();
  const domains = snapshots.flatMap((snapshot) =>
    snapshot.winners.map((winner) => winner.domain).filter((domain): domain is string => domain !== null),
  );

  if (domains.some((domain) => /(realtor|yelp|zillow|fastexpert)/i.test(domain))) {
    patterns.add("Do not copy directory or marketplace commodity language. Differentiate against it.");
  }

  if (
    snapshots.flatMap((snapshot) => snapshot.winners).some((winner) => /\btop 10\b|\bbest\b/i.test(winner.title ?? ""))
  ) {
    patterns.add("Do not lean on generic 'best' or ranked-list language unless the page is intentionally comparative.");
  }

  return [...patterns];
}

function sampleForensics(sample: CompetitorPageSample): string[] {
  const text = sample.sampleText?.toLowerCase() ?? "";
  const output: string[] = [];

  if (sample.wordCount > 0) {
    output.push(`sample length: ${sample.wordCount} words`);
  }

  const lengths = sample.sampleText ? sentenceLengths(sample.sampleText) : [];
  const avgLength = average(lengths);
  if (avgLength) {
    output.push(`average sentence length: ${avgLength.toFixed(1)} words`);
  }

  if (/(luxury|extraordinary|exclusive|prestige)/.test(text)) {
    output.push("luxury-forward framing");
  }
  if (/(integrity|discretion|honesty|trusted|advisor)/.test(text)) {
    output.push("trust-and-discretion language");
  }
  if (/(buyers|sellers|investors|transaction|list|find)/.test(text)) {
    output.push("service-model specificity");
  }
  if (/(manhattan|brooklyn|new york city|nyc|park slope|williamsburg)/.test(text)) {
    output.push("geographic specificity");
  }
  if (/(contact|consultation|connect with us|reach out)/.test(text)) {
    output.push("direct invitation to engage");
  }

  return output;
}

function buildCsv(rows: KeywordMetricRow[]): string {
  const columns = [
    "seed_keyword",
    "candidate_keyword",
    "discovery_sources",
    "search_volume",
    "difficulty",
    "main_intent",
    "secondary_intents",
    "cpc",
    "monthly_trend",
    "yearly_trend",
  ];
  return (
    [
      columns.join(","),
      ...rows.map((row) =>
        [
          row.seedKeyword,
          row.candidateKeyword,
          row.discoverySources.join(" | "),
          row.searchVolume,
          row.difficulty,
          row.mainIntent ?? "",
          row.secondaryIntents.join(" | "),
          row.cpc,
          row.monthlyTrend,
          row.yearlyTrend,
        ]
          .map(csvEscape)
          .join(","),
      ),
    ].join("\n") + "\n"
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(path.dirname(args.outCsv), { recursive: true });
  await fs.mkdir(path.dirname(args.outMd), { recursive: true });

  const apis = await createDataForSeoApis(process.cwd());
  const discoveryKeywords = new Map<string, { seedKeyword: string; sources: Set<string>; trend: JsonRecord | null }>();

  for (const seed of args.seeds) {
    addDiscoveryKeyword(discoveryKeywords, seed, seed, "seed", null);

    const suggestionRequest = new dfs.DataforseoLabsGoogleKeywordSuggestionsLiveRequestInfo();
    suggestionRequest.keyword = seed;
    suggestionRequest.language_code = args.language;
    suggestionRequest.limit = 12;
    suggestionRequest.location_name = args.location;

    const relatedRequest = new dfs.DataforseoLabsGoogleRelatedKeywordsLiveRequestInfo();
    relatedRequest.depth = 1;
    relatedRequest.keyword = seed;
    relatedRequest.language_code = args.language;
    relatedRequest.limit = 8;
    relatedRequest.location_name = args.location;

    const [suggestionResponse, relatedResponse] = await Promise.all([
      apis.dataforseoLabs.googleKeywordSuggestionsLive([suggestionRequest]),
      apis.dataforseoLabs.googleRelatedKeywordsLive([relatedRequest]),
    ]);

    for (const result of getTaskResults(suggestionResponse)) {
      for (const item of collectResultItems(result)) {
        const keyword = readString(item.keyword);
        const keywordInfo = readRecord(item.keyword_info);
        addDiscoveryKeyword(
          discoveryKeywords,
          seed,
          keyword,
          "keyword_suggestions",
          readRecord(keywordInfo?.search_volume_trend),
        );
      }
    }

    for (const result of getTaskResults(relatedResponse)) {
      for (const item of collectResultItems(result)) {
        const keyword = readString(item.keyword);
        const keywordData = readRecord(item.keyword_data);
        const keywordInfo = readRecord(keywordData?.keyword_info);
        addDiscoveryKeyword(
          discoveryKeywords,
          seed,
          keyword,
          "related_keywords",
          readRecord(keywordInfo?.search_volume_trend),
        );
      }
    }
  }

  const candidateKeywords = [...discoveryKeywords.keys()].slice(0, 40);

  const volumeRequest = new dfs.KeywordsDataGoogleAdsSearchVolumeLiveRequestInfo();
  volumeRequest.keywords = candidateKeywords;
  volumeRequest.language_code = args.language;
  volumeRequest.location_name = args.location;

  const difficultyRequest = new dfs.DataforseoLabsGoogleBulkKeywordDifficultyLiveRequestInfo();
  difficultyRequest.keywords = candidateKeywords;
  difficultyRequest.language_code = args.language;
  difficultyRequest.location_name = args.location;

  const intentRequest = new dfs.DataforseoLabsGoogleSearchIntentLiveRequestInfo();
  intentRequest.keywords = candidateKeywords;
  intentRequest.language_code = args.language;

  const [volumeResponse, difficultyResponse, intentResponse] = await Promise.all([
    apis.keywordsData.googleAdsSearchVolumeLive([volumeRequest]),
    apis.dataforseoLabs.googleBulkKeywordDifficultyLive([difficultyRequest]),
    apis.dataforseoLabs.googleSearchIntentLive([intentRequest]),
  ]);

  const volumeMap = new Map<string, { cpc: number | null; searchVolume: number | null }>();
  for (const result of getTaskResults(volumeResponse)) {
    const keyword = readString(result.keyword);
    if (!keyword) continue;
    volumeMap.set(keyword.toLowerCase(), {
      cpc: readNumber(result.cpc),
      searchVolume: readNumber(result.search_volume),
    });
  }

  const difficultyMap = new Map<string, number | null>();
  for (const result of getTaskResults(difficultyResponse)) {
    for (const item of collectResultItems(result)) {
      const keyword = readString(item.keyword);
      if (!keyword) continue;
      difficultyMap.set(keyword.toLowerCase(), readNumber(item.keyword_difficulty));
    }
  }

  const intentMap = new Map<string, { mainIntent: string | null; secondaryIntents: string[] }>();
  for (const result of getTaskResults(intentResponse)) {
    for (const item of collectResultItems(result)) {
      const keyword = readString(item.keyword);
      if (!keyword) continue;
      const mainIntent = readRecord(item.keyword_intent);
      const secondaryIntents = Array.isArray(item.secondary_keyword_intents)
        ? item.secondary_keyword_intents
            .filter(isRecord)
            .map((entry) => readString(entry.label))
            .filter((label): label is string => label !== null)
        : [];
      intentMap.set(keyword.toLowerCase(), {
        mainIntent: readString(mainIntent?.label),
        secondaryIntents,
      });
    }
  }

  const keywordRows: KeywordMetricRow[] = candidateKeywords
    .map((keyword) => {
      const discovery = discoveryKeywords.get(keyword);
      const volume = volumeMap.get(keyword);
      const intent = intentMap.get(keyword);
      return {
        candidateKeyword: keyword,
        cpc: volume?.cpc ?? null,
        difficulty: difficultyMap.get(keyword) ?? null,
        discoverySources: discovery ? [...discovery.sources].sort() : [],
        mainIntent: intent?.mainIntent ?? null,
        monthlyTrend: discovery ? trendValue(discovery.trend, "monthly") : null,
        searchVolume: volume?.searchVolume ?? null,
        secondaryIntents: intent?.secondaryIntents ?? [],
        seedKeyword: discovery?.seedKeyword ?? "",
        yearlyTrend: discovery ? trendValue(discovery.trend, "yearly") : null,
      };
    })
    .sort((left, right) => (right.searchVolume ?? -1) - (left.searchVolume ?? -1));

  const topQueryKeywords = keywordRows
    .filter((row) => row.searchVolume !== null)
    .slice(0, 8)
    .map((row) => row.candidateKeyword);

  const discoveredCompetitors = new Set<string>(args.competitors);
  const competitorNotes: string[] = [];

  const domainCompetitorRequest = new dfs.DataforseoLabsGoogleCompetitorsDomainLiveRequestInfo();
  domainCompetitorRequest.exclude_top_domains = true;
  domainCompetitorRequest.language_code = args.language;
  domainCompetitorRequest.limit = 10;
  domainCompetitorRequest.location_name = args.location;
  domainCompetitorRequest.target = args.domain;
  const domainCompetitorResponse = await apis.dataforseoLabs.googleCompetitorsDomainLive([domainCompetitorRequest]);

  for (const result of getTaskResults(domainCompetitorResponse)) {
    for (const item of collectResultItems(result)) {
      const domain = readString(item.domain);
      if (domain) discoveredCompetitors.add(domain);
    }
  }
  if (discoveredCompetitors.size > args.competitors.length) {
    competitorNotes.push("Added competitors from domain-overlap discovery.");
  }

  if (discoveredCompetitors.size === 0 && topQueryKeywords.length > 0) {
    const serpCompetitorRequest = new dfs.DataforseoLabsGoogleSerpCompetitorsLiveRequestInfo();
    serpCompetitorRequest.keywords = topQueryKeywords;
    serpCompetitorRequest.language_code = args.language;
    serpCompetitorRequest.limit = 10;
    serpCompetitorRequest.location_name = args.location;
    const serpCompetitorResponse = await apis.dataforseoLabs.googleSerpCompetitorsLive([serpCompetitorRequest]);
    for (const result of getTaskResults(serpCompetitorResponse)) {
      for (const item of collectResultItems(result)) {
        const domain = readString(item.domain);
        if (domain && !domain.includes(args.domain)) discoveredCompetitors.add(domain);
      }
    }
    if (discoveredCompetitors.size > 0) {
      competitorNotes.push("Domain-overlap discovery was empty; fell back to SERP competitors.");
    }
  }

  const competitorDomains = [...discoveredCompetitors].slice(0, 8);

  const serpSnapshots: Array<{
    itemTypes: string[];
    query: string;
    relatedSearches: string[];
    winners: SerpWinner[];
  }> = [];

  for (const query of args.seeds) {
    const serpRequest = new dfs.SerpGoogleOrganicLiveAdvancedRequestInfo();
    serpRequest.depth = 5;
    serpRequest.device = "desktop";
    serpRequest.keyword = query;
    serpRequest.language_code = args.language;
    serpRequest.location_name = args.location;
    const response = await apis.serp.googleOrganicLiveAdvanced([serpRequest]);

    const result = getTaskResults(response)[0];
    if (!result) continue;

    const itemTypes = readStringArray(result.item_types);
    const items = collectResultItems(result);
    const winners: SerpWinner[] = [];
    const relatedSearches: string[] = [];

    for (const item of items) {
      const type = readString(item.type);
      if (type === "local_pack" || type === "organic") {
        winners.push({
          description: readString(item.description),
          domain: readString(item.domain),
          kind: type === "local_pack" ? "local-pack" : "organic",
          rankAbsolute: readNumber(item.rank_absolute),
          title: readString(item.title),
          url: readString(item.url),
        });
      }
      if (type === "related_searches") {
        const related = item.items;
        if (Array.isArray(related)) {
          for (const value of related) {
            const text = readString(value);
            if (text) relatedSearches.push(text);
          }
        }
      }
    }

    serpSnapshots.push({
      itemTypes,
      query,
      relatedSearches,
      winners: winners.slice(0, 6),
    });
  }

  const competitorUrls = serpSnapshots
    .flatMap((snapshot) => snapshot.winners)
    .filter((winner) => winner.kind === "organic")
    .filter(
      (winner): winner is SerpWinner & { domain: string; url: string } =>
        typeof winner.domain === "string" && typeof winner.url === "string",
    )
    .filter((winner) => !winner.domain.includes(args.domain))
    .slice(0, 4);

  const competitorPageSamples: CompetitorPageSample[] = [];
  for (const winner of competitorUrls) {
    const onPageRequest = new dfs.OnPageContentParsingLiveRequestInfo();
    onPageRequest.url = winner.url;
    const response = await apis.onPage.contentParsingLive([onPageRequest]);
    const result = getTaskResults(response)[0];
    const item = result ? collectResultItems(result)[0] : null;
    const pageContent = readRecord(item?.page_content);
    const mainTopic = Array.isArray(pageContent?.main_topic) ? pageContent.main_topic.filter(isRecord) : [];
    const firstTopic = mainTopic[0];
    const topicTitles = mainTopic
      .map((topic) => readString(topic.h_title))
      .filter((title): title is string => title !== null)
      .slice(0, 4);
    const sampleText = mainTopic
      .flatMap((topic) => {
        const primaryContent = Array.isArray(topic.primary_content) ? topic.primary_content.filter(isRecord) : [];
        return primaryContent
          .map((part: JsonRecord) => readString(part.text))
          .filter((text: string | null): text is string => text !== null);
      })
      .join(" ")
      .slice(0, 1200);
    const wordCount = sampleText.split(/\s+/).filter((token) => token.trim().length > 0).length;
    const primaryExcerpt = sampleText.slice(0, 320) || null;

    const sample: CompetitorPageSample = {
      domain: winner.domain,
      forensics: [],
      hTitle: readString(firstTopic?.h_title),
      level: readNumber(firstTopic?.level),
      mainTitle: readString(firstTopic?.main_title),
      primaryExcerpt,
      sampleText: sampleText || null,
      query: winner.title ?? winner.url,
      topicTitles,
      url: winner.url,
      wordCount,
    };
    sample.forensics = sampleForensics(sample);
    competitorPageSamples.push(sample);
  }

  const excerptLengths = competitorPageSamples.flatMap((sample) =>
    sample.primaryExcerpt ? sentenceLengths(sample.primaryExcerpt) : [],
  );
  const avgExcerptSentenceLength = average(excerptLengths);
  const voiceSignals = detectVoiceSignals(competitorPageSamples);

  let aiSnapshotNote = "No AI Optimization citation data returned for this packet.";
  try {
    const aiResponse = await apis.rest("/v3/ai_optimization/llm_mentions/top_domains/live", [
      {
        internal_list_limit: 5,
        items_list_limit: 5,
        language_code: args.language,
        links_scope: "sources",
        location_name: args.location,
        platform: "google",
        target: args.seeds.slice(0, 3).map((keyword) => ({
          keyword,
          match_type: "partial_match",
          search_filter: "include",
          search_scope: ["question", "answer"],
        })),
      },
    ]);

    const first = getTaskResults(aiResponse)[0];
    const items = first ? collectResultItems(first) : [];
    const domains = items
      .map((item) => readString(item.domain))
      .filter((domain): domain is string => domain !== null)
      .slice(0, 5);
    if (domains.length > 0) {
      aiSnapshotNote = `AI Optimization top cited domains snapshot: ${domains.join(", ")}.`;
    }
  } catch (error) {
    aiSnapshotNote = `AI Optimization snapshot unavailable: ${error instanceof Error ? error.message : String(error)}.`;
  }

  const titleTokens = tokenFrequencies(
    serpSnapshots.flatMap((snapshot) =>
      snapshot.winners.map((winner) => winner.title).filter((title): title is string => title !== null),
    ),
  );
  const localPackCount = serpSnapshots.filter((snapshot) =>
    snapshot.winners.some((winner) => winner.kind === "local-pack"),
  ).length;
  const proofSignals = detectProofSignals(serpSnapshots, competitorPageSamples);
  const stealPatterns = collectStealPatterns(serpSnapshots, competitorPageSamples);
  const avoidPatterns = collectAvoidPatterns(serpSnapshots);

  const highIntentRows = keywordRows
    .filter((row) => row.mainIntent === "commercial" || row.mainIntent === "transactional")
    .slice(0, 12);

  const markdown = `# Sitewide SERP Intelligence Packet

## Inputs
- Brand: **${args.brand}**
- Domain: **${args.domain}**
- Seeds: ${args.seeds.map((seed) => `\`${seed}\``).join(", ")}
- Location: **${args.location}**
- Language: **${args.language}**
- Competitor inputs: ${
    competitorDomains.length > 0
      ? competitorDomains.map((domain) => `\`${domain}\``).join(", ")
      : "none provided; discovery only"
  }

## What This Packet Is For
This is the pre-rewrite search-intelligence step for the sitewide content pass.
It is meant to pressure-test page-role assumptions, show who dominates the live
SERP, and surface framing patterns before copy decisions are made.

The keywords here are a discovery mechanism, not the end goal. The real goal is
to find the external pages we can trust as strong market examples, then extract
the tone, proof strategy, framing, and conversion posture that make them work.

## Keyword Snapshot
Top commercial or transactional candidates from the seed set are captured in the
companion CSV.

Highest-signal terms:
${highIntentRows
  .map(
    (row) =>
      `- \`${row.candidateKeyword}\` — volume ${row.searchVolume ?? "n/a"}, difficulty ${row.difficulty ?? "n/a"}, intent ${row.mainIntent ?? "unknown"}`,
  )
  .join("\n")}

## Competitor Discovery
Discovered competitor domains:
${
  competitorDomains.length > 0
    ? competitorDomains.map((domain) => `- \`${domain}\``).join("\n")
    : "- No strong competitor domains returned from the current packet."
}

${competitorNotes.length > 0 ? `Notes:\n${competitorNotes.map((note) => `- ${note}`).join("\n")}\n` : ""}
## Live SERP Snapshot
${serpSnapshots
  .map(
    (snapshot) => `### ${snapshot.query}
- SERP features present: ${snapshot.itemTypes.join(", ") || "none returned"}
- Local pack present: ${snapshot.winners.some((winner) => winner.kind === "local-pack") ? "yes" : "no"}
- Top winners:
${snapshot.winners
  .map(
    (winner) =>
      `  - ${winner.kind} #${winner.rankAbsolute ?? "?"}: ${winner.title ?? "(no title)"}${winner.domain ? ` — ${winner.domain}` : ""}`,
  )
  .join("\n")}
- Related searches:
${
  snapshot.relatedSearches.length > 0
    ? snapshot.relatedSearches.map((related) => `  - ${related}`).join("\n")
    : "  - none returned"
}
`,
  )
  .join("\n")}

## Copy And Framing Signals
- Repeated SERP title tokens: ${titleTokens.map((token) => `${token.token} (${token.count})`).join(", ") || "none"}
- Local-pack pressure across seed queries: **${localPackCount}/${serpSnapshots.length}** query snapshots
- Repeated proof signals: ${proofSignals.map((signal) => `${signal.label} (${signal.count})`).join(", ") || "none"}
- ${aiSnapshotNote}

## SERP Leader Voice And Style
- Top voice or framing signals: ${voiceSignals.map((signal) => `${signal.label} (${signal.count})`).join(", ") || "none"}
- Average sentence length in sampled competitor excerpts: ${avgExcerptSentenceLength ? avgExcerptSentenceLength.toFixed(1) : "n/a"} words
- Working read: the winning pages are signaling not just category relevance, but also a specific tone stack. Pay attention to whether they lean toward prestige, collective-team authority, direct invitation, or process-heavy reassurance.

## What To Steal And Improve
${stealPatterns.length > 0 ? stealPatterns.map((pattern) => `- ${pattern}`).join("\n") : "- No reliable steal patterns were detected from the sampled leaders."}

## What To Avoid Or Invert
${avoidPatterns.length > 0 ? avoidPatterns.map((pattern) => `- ${pattern}`).join("\n") : "- No strong avoid patterns were detected from the sampled leaders."}

## Competitor Page Samples
${
  competitorPageSamples.length > 0
    ? competitorPageSamples
        .map(
          (sample) => `### ${sample.domain}
- URL: ${sample.url}
- Dominant page or section title: ${sample.mainTitle ?? sample.hTitle ?? "n/a"}
- Topic labels: ${sample.topicTitles.join(" | ") || "n/a"}
- Sample excerpt: ${sample.primaryExcerpt ?? "n/a"}
- Forensics: ${sample.forensics.join(" | ") || "n/a"}
`,
        )
        .join("\n")
    : "No competitor page samples were captured."
}

## Assumption Checks
- Query intent is not automatically clean. At least one broker query came back
  split between navigational and commercial intent, so route claims should be
  validated against the actual keyword mix before we rewrite hero language.
- Local-pack presence means reputation, review proof, and local entity trust
  matter alongside editorial positioning.
- Competitor winners are mixing directory, brokerage, and boutique-team
  surfaces. That means the site has to decide whether it is trying to compete
  as a searchable broker directory alternative, a luxury-team authority
  surface, or a direct editorial-practice surface, then write accordingly.
- The leader pages are not neutral. Their tone is carrying strategic work:
  team scale, luxury confidence, geographic specificity, and trust language.
  The rewrite pass should decide deliberately which of those to reject, match,
  or invert.

## Workflow Implications
- Add this packet before voice work and before page-level rewrites.
- Use it to confirm or revise the Wave 1 route roles for home, buyers, sellers,
  partners, and contact.
- Use the discovered domains and page samples as comparison inputs for
  \`competitive-intelligence\`, not as copy to imitate.
- Feed the voice and framing signals into \`brand-voice\` and
  \`style-forensics\` so the house style is shaped against the market, not in a
  vacuum.

## Next Skill Stack
1. \`dataforseo-operator\`
2. \`keyword-research\`
3. \`competitive-intelligence\`
4. \`content-strategy\`
5. then the existing voice and rewrite stack
`;

  await fs.writeFile(args.outCsv, buildCsv(keywordRows));
  await fs.writeFile(args.outMd, markdown);

  console.log(
    JSON.stringify(
      {
        aiSnapshotNote,
        competitorCount: competitorDomains.length,
        csv: args.outCsv,
        discoveredKeywords: keywordRows.length,
        localPackCount,
        markdown: args.outMd,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
