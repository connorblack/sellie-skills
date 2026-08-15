# sellie-skills

Agent skills authored for [Sellie](https://sellie.ai) work and published so they
can be installed anywhere instead of being copied by hand between machines,
agent roots, and repos.

Every skill here is one we wrote. Skills we merely *use* — `agent-browser`,
`adversarial-reviewer`, `emdash-cli` from `emdash-cms/emdash`, the Cloudflare
and Hermes catalogs — are not vendored here; install those from their own
upstreams so updates keep flowing.

## Install

```bash
skills add connorblack/sellie-skills                # project-level → ./.agents/skills
skills add connorblack/sellie-skills -g             # global        → ~/.agents/skills
skills add connorblack/sellie-skills -s control-ui  # one skill only
skills add connorblack/sellie-skills -l             # list without installing
```

Installs are recorded in `skills-lock.json` (per-project) or `~/skills-lock.json`
(global). `skills update` re-syncs to the latest published version.

## Skills

| Skill | What it does |
|---|---|
| `control-cli` | Build or adapt a local harness to drive and inspect a CLI/TUI program with evidence. |
| `control-ui` | Drive and inspect a web/IDE/Electron UI locally — screenshots, a11y snapshots, perf profiles, CDP. Defers to a repo-mandated driver when one exists. |
| `web-quality-assurance` | Router for structured web QA: hostile-persona dogfooding, adversarial UX testing, and issue triage into a shared taxonomy. |
| `kanban-meta-triage` | Operate a Hermes kanban board as an orchestrator — sequencing, hazard avoidance, and preserving card work across the three workspace kinds. |
| `emdash-sitewide-content-pass` | Orchestrate a site-wide content improvement pass for an EmDash site: scoping, search intelligence, skill stacking, artifacts. |

## Conventions

- One skill per directory under `skills/`, each with a `SKILL.md` carrying
  `name` and `description` frontmatter.
- Supporting material goes in `references/`, `scripts/`, and `templates/`
  beside the `SKILL.md`.
- No absolute home paths, no machine-specific defaults, no secrets. Anything
  environment-dependent reads an env var with a sane fallback
  (`HERMES_HOME`, `BOARD`, `HERMES_PYTHON`).

## License

MIT — see [LICENSE](LICENSE).
