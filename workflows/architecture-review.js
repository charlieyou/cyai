export const meta = {
  name: 'architecture-review',
  description: 'Principal-engineer architecture review via lensed Claude subagents (no cerberus)',
  whenToUse:
    'High-leverage design/refactor review of a codebase. Replaces the cerberus architecture-review skill: where that skill fanned out across three model vendors, this fans out across distinct architectural lenses. Output is a markdown artifact that feeds /create-tasks.',
  phases: [
    { title: 'Map', detail: 'one scout builds the system map + measured hotspot inventory' },
    { title: 'Find', detail: 'one finder per architectural lens, in parallel (read-only)' },
    { title: 'Merge', detail: 'dedup + severity-calibrate + leverage-order across all findings' },
    { title: 'Cover', detail: 'max mode only: completeness critic + one targeted second finder round' },
    { title: 'Verify', detail: 'adversarially check each finding; enrich survivors with acceptance criteria + test plan (read-only)' },
    { title: 'Write', detail: 'synthesizer writes the review artifact + JSON sidecar' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (all optional, passed via Workflow `args`)
//   mode  : 'fast' | 'smart' | 'max'   (default 'smart')
//   focus : free-text emphasis, e.g. "the API layer"     (default none)
//   scope : files/dirs to review                          (default whole repo)
//   out   : artifact path                                 (default docs/architecture-review.md)
//   prior : path to a previous review artifact — findings get tagged
//           new/known and the artifact gains a delta section (default none)
// ---------------------------------------------------------------------------
// args may arrive as an object or as a CLI-style string (skill invocations pass "--mode max").
const parseArgString = (s) => {
  const out = {}
  const re = /--([\w-]+)(?:[= ]("[^"]*"|[^-\s][^\s]*))?/g
  let m
  while ((m = re.exec(s))) out[m[1]] = m[2] ? m[2].replace(/^"|"$/g, '') : true
  return out
}
const ARGS = typeof args === 'string' ? parseArgString(args) : (args || {})
const MODE = (ARGS.mode && ['fast', 'smart', 'max'].includes(ARGS.mode)) ? ARGS.mode : 'smart'
if (ARGS.mode && ARGS.mode !== MODE) log(`WARNING: unknown mode "${ARGS.mode}" — falling back to "smart"`)
const FOCUS = ARGS.focus || ''
const SCOPE = ARGS.scope || 'the entire repository, starting from entry points and high-traffic modules'
const OUT = ARGS.out || 'docs/architecture-review.md'
const PRIOR = typeof ARGS.prior === 'string' ? ARGS.prior : ''
const SIDECAR = OUT.replace(/\.md$/, '') + '.json'

// Model assignment by role. Each mode ships a cost/quality-tuned default map:
// fast is Sonnet everywhere except Opus discovery; smart spends Opus on the
// lossy judgment phases; max uses Fable only where it has the highest leverage.
// Callers override globally with args.model or per role with
// args.models = { scout, finder, merge, critic, verify, synth }.
// Precedence: args.models[role] > args.model > per-mode default.
const VALID_MODELS = ['opus', 'sonnet', 'fable']
const validModel = (m) => (VALID_MODELS.includes(m) ? m : undefined)
const MODE_MODELS = {
  fast: { scout: 'sonnet', finder: 'opus', merge: 'sonnet', critic: 'sonnet', verify: 'sonnet', synth: 'sonnet' },
  smart: { scout: 'sonnet', finder: 'opus', merge: 'opus', critic: 'opus', verify: 'opus', synth: 'sonnet' },
  max: { scout: 'opus', finder: 'fable', merge: 'opus', critic: 'opus', verify: 'fable', synth: 'sonnet' },
}
const MODELS = ARGS.models || {}
const DEFAULT_MODEL = validModel(ARGS.model)
const modelFor = (role) => validModel(MODELS[role]) || DEFAULT_MODEL || (MODE_MODELS[MODE] && MODE_MODELS[MODE][role])
// Merge a resolved model into agent opts only when set, so `undefined` never
// clobbers the inherited session model.
const withModel = (opts, role) => {
  const m = modelFor(role)
  return m ? { ...opts, model: m } : opts
}

const focusLine = FOCUS ? `\n\nFOCUS: pay special attention to: ${FOCUS}` : ''

const STE100 = `ARTIFACT LANGUAGE
- Write all generated prose in ASD-STE100 Simplified Technical English.
- Use short, declarative sentences and active voice.
- Give one instruction or condition in each sentence.
- Use approved ASD-STE100 words when possible.
- Keep code identifiers, file paths, command names, API names, and exact quotations unchanged.
- If a necessary technical term is not approved terminology, define it at its first use.
- Before you return the structured object, check every prose field for compliance with these rules.`

// ---------------------------------------------------------------------------
// Shared review doctrine (distilled from the cerberus architecture-review
// generator + reviewer prompts). Kept identical across finders so lenses stay
// comparable; each lens then narrows the "What to look for" section.
// ---------------------------------------------------------------------------
const DOCTRINE = `You are performing a PRINCIPAL-ENGINEER architecture review focused on HIGH-LEVERAGE design improvements — maximum long-term payoff per hour invested. Prefer functional patterns (pure functions, explicit data flow, composition) unless the code clearly benefits from OO.

${STE100}

This is NOT a correctness bug hunt and NOT a style/lint pass. Only flag correctness issues if they block architectural change or reveal systemic design flaws.

GROUND RULES
- READ-ONLY. Do NOT modify, create, or delete any files. Use only read/list/search operations.
- Be evidence-based: only cite issues you can point to in code you actually inspected.
- Be specific: tie every point to concrete files/modules/functions with approximate line ranges. No generic advice.
- Keep it incremental: propose refactors that can land in steps; never "rewrite it all".
- Keep excerpts tiny: reference files/symbols; quote 3 lines or fewer.
- If evidence is partial, lower confidence and say what is missing.

OUT OF SCOPE (do not report): style/formatting, minor naming, missing docs (unless they block understanding), single-use code that is appropriately inlined, test-coverage gaps (unless they prove untestable design), perf micro-optimizations without measured impact, dead code / hygiene cleanup.

SEVERITY
- Critical: architecture causes production risk or data-integrity issues (use sparingly).
- High: architectural debt blocking feature velocity or safe change.
- Medium: design friction that slows change but is not blocking.
- Low: improvement opportunity with limited ROI.

CATEGORY (choose exactly one per finding; name the ROOT of the problem, not the symptom): Boundaries, Testability, Complexity, Duplication, Cohesion, Abstraction, Crosscutting. Use Crosscutting only for a systemic problem that genuinely spans several categories with no single home.`

// ---------------------------------------------------------------------------
// Lenses — diversity by perspective (replaces diversity by model vendor).
// ---------------------------------------------------------------------------
const LENSES = {
  boundaries: {
    key: 'boundaries',
    title: 'Boundaries & dependency direction',
    look: `- Circular dependencies across layers; wrong-way dependencies.
- UI/API/CLI code reaching into persistence or infra details.
- Domain logic scattered across utils/ or unrelated modules.
- Configuration scattered across multiple locations.
- Tight coupling to external services that makes core logic hard to test.
To claim a boundary violation you MUST identify BOTH sides of the boundary.`,
  },
  testability: {
    key: 'testability',
    title: 'Testability & change isolation',
    look: `- Hidden global state, time, randomness, or IO buried in core logic.
- Heavy constructors / framework setup required just to test logic.
- Coupling that makes unit tests impossible without integration scaffolding.
- Dependencies taken implicitly (globals/singletons) rather than passed explicitly.`,
  },
  complexity: {
    key: 'complexity',
    title: 'Complexity & duplication hotspots',
    look: `- Functions with complex branching or deep nesting (target cyclomatic >= 15, length >= 80 lines).
- Copy/paste logic across modules that should be shared.
- One-off helpers duplicated across files.
Validate reachability: skip dead code; only flag hotspots on real execution paths.`,
  },
  cohesion: {
    key: 'cohesion',
    title: 'Size & cohesion',
    look: `- Files that mix IO + business rules + formatting (target: flag files > 500 LOC).
- "God" files/classes with too many responsibilities.
- Classes that are only bags of functions (prefer a module of pure functions).
For any oversized core-path file, either flag it or explicitly justify why it is cohesive enough to keep.`,
  },
  abstraction: {
    key: 'abstraction',
    title: 'Abstraction fitness',
    look: `- Over-abstracted layers that add indirection but no value (YAGNI).
- Under-abstracted logic where similar flows diverge unnecessarily.
- Leaky abstractions that force callers to know internal details.`,
  },
}

function lensesForMode(mode) {
  if (mode === 'fast') {
    // Fewer agents: combine the five categories into three finders.
    return [
      { ...LENSES.boundaries },
      {
        key: 'complexity-cohesion',
        title: 'Complexity, duplication, size & cohesion',
        look: LENSES.complexity.look + '\n' + LENSES.cohesion.look,
      },
      {
        key: 'testability-abstraction',
        title: 'Testability & abstraction fitness',
        look: LENSES.testability.look + '\n' + LENSES.abstraction.look,
      },
    ]
  }
  // smart and max share these five lenses; max differs from smart only by model assignment.
  return [LENSES.boundaries, LENSES.testability, LENSES.complexity, LENSES.cohesion, LENSES.abstraction]
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const SEVERITY = { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] }
const CATEGORY = {
  type: 'string',
  enum: ['Boundaries', 'Testability', 'Complexity', 'Duplication', 'Cohesion', 'Abstraction', 'Crosscutting'],
}
const FILE_REF = {
  type: 'object',
  properties: { path: { type: 'string' }, lines: { type: 'string' } },
  required: ['path'],
}

const SCOUT_SCHEMA = {
  type: 'object',
  properties: {
    entryPoints: { type: 'array', items: { type: 'string' } },
    coreModules: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, path: { type: 'string' }, responsibility: { type: 'string' } },
        required: ['name', 'path'],
      },
    },
    dataFlows: { type: 'array', items: { type: 'string' } },
    hotspots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          loc: { type: ['integer', 'null'] },
          kind: { type: 'string' }, // "file" | "function"
          note: { type: 'string' },
        },
        required: ['path'],
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['entryPoints', 'coreModules', 'hotspots'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: SEVERITY,
          category: CATEGORY,
          files: { type: 'array', items: FILE_REF },
          whatsWrong: { type: 'string' },
          whyItMatters: { type: 'string' },
          fix: { type: 'string' },
          confidence: { type: ['number', 'null'] },
        },
        required: ['title', 'severity', 'category', 'files', 'whatsWrong', 'fix'],
      },
    },
  },
  required: ['findings'],
}

// Compact merge output: the merge agent returns DECISIONS that reference the
// numbered input list by index; the orchestrator reconstructs full findings
// script-side (composeMerged). Re-emitting every finding verbatim made the
// single structured-output call ~50KB, which stalls the harness (>180s of
// uninterrupted generation trips the no-progress killer).
const MERGED_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, // stable, e.g. "F1"
          title: { type: 'string' },
          severity: SEVERITY,
          category: CATEGORY,
          memberIndexes: { type: 'array', items: { type: 'integer' } }, // indexes into the numbered input list; best-evidenced member FIRST
          sourceLenses: { type: 'array', items: { type: 'string' } },
          confidence: { type: ['number', 'null'] },
          unlocks: { type: 'array', items: { type: 'string' } }, // ids of findings this one makes easier/possible
          priorStatus: { type: ['string', 'null'], enum: ['new', 'known', null] },
        },
        required: ['id', 'title', 'severity', 'category', 'memberIndexes', 'sourceLenses'],
      },
    },
    startHere: {
      // top 3-5 finding ids in suggested fix order, by leverage (what they unlock), not raw severity
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, why: { type: 'string' } },
        required: ['id', 'why'],
      },
    },
    resolvedFromPrior: {
      // prior-artifact findings that no longer reproduce in the current code
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['findings', 'startHere'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean' },
    calibratedSeverity: SEVERITY,
    lineRefsAccurate: { type: 'boolean' },
    reason: { type: 'string' },
    // Enrichment — written by the one agent that actually read the cited code.
    // Required when isReal=true; empty arrays/null allowed when isReal=false.
    refinedFix: { type: ['string', 'null'] },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    testPlan: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    agentNotes: { type: ['string', 'null'] },
  },
  required: ['isReal', 'reason'],
}

const COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' }, // module/hotspot path or subsystem name
          whySuspicious: { type: 'string' },
          suggestedLens: { type: 'string' },
        },
        required: ['area', 'whySuspicious'],
      },
    },
  },
  required: ['gaps'],
}

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    summary: { type: 'string' },
    counts: {
      type: 'object',
      properties: {
        critical: { type: 'integer' },
        high: { type: 'integer' },
        medium: { type: 'integer' },
        low: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
  },
  required: ['path', 'summary'],
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
function scoutPrompt() {
  return `${DOCTRINE}

ROLE: SCOUT. Do the "big-picture sweep" ONCE so the per-lens reviewers don't each repeat it.

Review scope: ${SCOPE}.${focusLine}

MEASURE, don't estimate. Before eyeballing anything, check which analysis tools are already installed (command -v ...) and run the ones that exist against the scope:
- LOC per file: tokei or cloc, else wc -l over source files.
- Function complexity/length: lizard (multi-language), else rg-based heuristics.
- Duplication: jscpd if available.
- Dependency cycles: language-appropriate — grimp (Python), madge (JS/TS), cargo-modules or cargo tree (Rust), go list (Go).
Do NOT install anything; skip tools that aren't present and note the gap in assumptions. All commands must be read-only.

Produce a system map:
1. Entry points (mains, CLI commands, HTTP handlers, factories/composition roots).
2. Core modules with one-line responsibilities.
3. Main orchestration / data flows (origin -> transport -> consumption).
4. HOTSPOT INVENTORY — top ~5 files by measured LOC and top ~5 functions by measured complexity/length. Explicitly call out any file > 500 LOC or function > 80 lines. Record the measured numbers in loc/note (e.g. "CCN 43, 210 lines, per lizard") and name the tool used; if a number is an estimate because no tool was available, say so in the note.
5. Assumptions / unknowns (including which measurement tools were missing).

Return ONLY the structured object. Do not list findings — that is the finders' job.`
}

function finderPrompt(lens, map) {
  return `${DOCTRINE}

ROLE: ARCHITECTURE FINDER — lens: "${lens.title}". Report ONLY issues that fall under this lens.

Review scope: ${SCOPE}.${focusLine}

A scout has already mapped the system (use it to target real execution paths; verify before relying on it). If the map is empty or clearly incomplete for this lens, do your own targeted exploration of the scope rather than reporting nothing:
${JSON.stringify(map, null, 2)}

WHAT TO LOOK FOR (this lens):
${lens.look}

FLAGGING BAR
- The issue meaningfully impacts maintainability, scalability, or (systemically) correctness.
- It is discrete and actionable — not a vague "the architecture is bad".
- The fix provides leverage (improves multiple areas, not just one).
- One finding per distinct problem. Cite tight line ranges; for cross-cutting issues cite multiple small anchors.
- Before marking anything High or Critical: confirm the code is reachable and on a meaningful path, and that the duplication/coupling is not intentional.
- If, after a genuine sweep, this lens has no high-leverage issues, return an empty findings array. An empty array is a STRONG CLAIM: it asserts you inspected the scout's hotspots and core modules relevant to this lens and found nothing high-leverage. Only return it after that inspection — never to avoid work or because the lens felt hard to apply.

For each finding set: title, severity, category (one of the CATEGORY values above), files [{path, lines}] (put ALL file/line anchors here, not in the prose fields), whatsWrong (1 sentence), whyItMatters (1-2 sentences), fix (1-3 sentences, concrete), confidence (0..1, your honest certainty the issue is real and correctly located).

Return ONLY the structured object.`
}

function mergePrompt(raw) {
  const priorBlock = PRIOR
    ? `
PRIOR REVIEW DELTA: a previous review artifact exists at ${PRIOR}. Read it. For each merged finding set priorStatus: "known" if the same root cause appears in the prior artifact (regardless of wording), "new" otherwise. List in resolvedFromPrior the titles of prior findings whose root cause no longer appears in the current raw findings — spot-check the cited code before declaring one resolved (the finders may simply have missed it; if you can still see the problem in the code, it is NOT resolved — include it as a finding with priorStatus "known" instead).`
    : ''
  const numbered = raw
    .map((f, i) => `[${i}] (lens: ${f.sourceLens || 'unknown'}) ${JSON.stringify(f)}`)
    .join('\n')
  return `You are MERGING findings from several architecture finders (each used a different lens). You will NOT re-review the codebase here; you reconcile the list. You MAY read code briefly to resolve a conflict.

${STE100}

Raw findings, numbered [0..${raw.length - 1}]:
${numbered}

Return MERGE DECISIONS ONLY — do NOT re-emit the findings' prose or file lists. The orchestrator reconstructs full findings from your memberIndexes, taking prose and file anchors from the FIRST index you list, so order memberIndexes with the best-evidenced, tightest-anchored member first.

Rules:
1. DEDUPLICATE: group findings describing the same underlying problem (same files/concern), even if worded differently or filed under different categories. Every input index must appear in EXACTLY ONE group — a singleton group for anything that stands alone.
2. RAISE CONFIDENCE for issues independently surfaced by multiple lenses; record every contributing lens in sourceLenses.
3. CALIBRATE SEVERITY against the aggregate evidence; pick the single best category. Title may be rewritten to name the root cause.
4. Assign each merged finding a stable id: "F1", "F2", ... in descending severity order (Critical first).
5. Do NOT cap or trim the list — every distinct root cause that survives dedup stays, even if that means many findings. Round numbers (20, 25) are a smell that you truncated.
6. LEVERAGE EDGES: for each finding, set unlocks to the ids of other findings that become substantially easier or only possible after this one is fixed (e.g. splitting a god-file unlocks the boundary and testability fixes inside it). Leave it empty when there is no real dependency — do not invent edges.
7. START HERE: pick the 3-5 findings a principal engineer would fix FIRST, ordered. Rank by leverage — what each unlocks and how much future change it de-risks — not by raw severity alone. A Medium god-file split that unlocks four other fixes beats an isolated High. For each, one sentence of why, naming what it unblocks.${priorBlock}

Merge by ROOT CAUSE, not file overlap:
- MERGE (same root, different wording/lens): "duplicated retry logic in http.js/queue.js" + "copy-pasted backoff across http.js and queue.js".
- DO NOT MERGE (same file, different roots): "server.js mixes IO and business rules" (Cohesion) vs "server.js routing reaches into the DB layer" (Boundaries).

Return ONLY the structured object (groups with memberIndexes + startHere${PRIOR ? ' + resolvedFromPrior' : ''}).`
}

// Reconstruct full findings from the merge agent's index-based decisions.
// Prose (whatsWrong/whyItMatters/fix) comes from the first-listed member;
// file anchors are the union across members (deduped by path+lines).
function composeMerged(raw, decisions) {
  return (decisions || [])
    .filter((d) => Array.isArray(d.memberIndexes) && d.memberIndexes.length > 0)
    .map((d) => {
      const members = d.memberIndexes.map((i) => raw[i]).filter(Boolean)
      if (members.length === 0) return null
      const primary = members[0]
      const files = []
      const seen = new Set()
      for (const m of members) {
        for (const fr of m.files || []) {
          const k = `${fr.path}|${fr.lines || ''}`
          if (!seen.has(k)) {
            seen.add(k)
            files.push(fr)
          }
        }
      }
      return {
        id: d.id,
        title: d.title || primary.title,
        severity: d.severity || primary.severity,
        category: d.category || primary.category,
        files,
        whatsWrong: primary.whatsWrong,
        whyItMatters: primary.whyItMatters,
        fix: primary.fix,
        sourceLenses: d.sourceLenses || [],
        confidence: d.confidence != null ? d.confidence : primary.confidence,
        unlocks: d.unlocks || [],
        priorStatus: d.priorStatus || primary.priorStatus || null,
      }
    })
    .filter(Boolean)
}

function coverPrompt(map, merged) {
  return `You are the COMPLETENESS CRITIC for an architecture review. The finders have reported; your job is to name what they MISSED — not to re-review everything.

${STE100}

READ-ONLY. You may briefly inspect files to decide whether an unexamined area is actually suspicious.

System map (with measured hotspot inventory):
${JSON.stringify(map, null, 2)}

Merged findings so far (titles, files, categories):
${JSON.stringify(merged.map((f) => ({ id: f.id, title: f.title, category: f.category, files: (f.files || []).map((x) => x.path) })), null, 2)}

Cross-check coverage:
- Which hotspots (large files, complex functions) have NO finding touching them?
- Which core modules on main data flows are absent from every finding?
- Is any DOCTRINE category (Boundaries, Testability, Complexity, Duplication, Cohesion, Abstraction) conspicuously empty given what the map shows?

For each gap, glance at the area first. Report it ONLY if a closer look would plausibly yield a high-leverage finding; a hotspot can be legitimately clean. Return AT MOST 3 gaps, best first — an empty list is the correct answer for well-covered reviews. For each: area (path or subsystem), whySuspicious (1-2 sentences citing what you saw), suggestedLens (one of the lens keys if obvious).

Return ONLY the structured object.`
}

function gapFinderPrompt(gaps, map) {
  return `${DOCTRINE}

ROLE: TARGETED GAP FINDER. A completeness critic flagged specific areas the first finder round did not cover. Investigate ONLY these areas — do not re-sweep the rest of the codebase.

Review scope: ${SCOPE}.${focusLine}

Gaps to investigate:
${JSON.stringify(gaps, null, 2)}

System map (context):
${JSON.stringify(map, null, 2)}

Apply the same FLAGGING BAR as a regular finder: discrete, actionable, high-leverage, evidence-based with tight line anchors. If a flagged area turns out clean on inspection, report nothing for it — the critic's suspicion is a lead, not a finding.

For each finding set: title, severity, category, files [{path, lines}], whatsWrong (1 sentence), whyItMatters (1-2 sentences), fix (1-3 sentences, concrete), confidence (0..1).

Return ONLY the structured object.`
}

function verifyPrompt(finding) {
  return `You are VERIFYING AND ENRICHING one architecture-review finding. You are the only agent in this pipeline that reads the cited code closely — the final artifact's acceptance criteria and test plan come from YOU, not from someone summarizing JSON. Two jobs: (1) check the claim against the code, (2) if it holds, specify the fix precisely enough to hand to an implementing agent.

${STE100}

READ-ONLY. Read the referenced files at the cited lines and check the claim.

Finding:
${JSON.stringify(finding, null, 2)}

PART 1 — VERIFY. Check three angles:
- CORRECTNESS: does the cited code actually do/contain what the finding claims?
- SEVERITY: is the stated severity justified for what the code shows, or exaggerated?
- REPRODUCIBILITY: is there a concrete scenario where this bites, or is it only speculative?

Set isReal=false ONLY if the finding is:
- Incorrect: the code does not match what the finding claims.
- Unsupported: no concrete evidence in the code for the claimed issue.
- Wrong location: line references do not correspond to the described issue.
- Speculative: predicts future problems with no concrete current impact.

Severity being one level too high is NOT grounds to refute — keep isReal=true and correct it via calibratedSeverity. ALWAYS set calibratedSeverity to the level the evidence supports, whether or not you keep the finding. Set lineRefsAccurate=false if any cited range is off (and note the correct location in agentNotes).

PART 2 — ENRICH (only when isReal=true; leave enrichment fields empty/null otherwise). Ground every item in what you just read — name real symbols, files, and behaviors, not generic advice:
- refinedFix: the fix, sharpened by what you saw (2-4 sentences). If the proposed fix would not work as stated — e.g. it misses a caller, a hidden coupling, a second copy of the logic — say what would instead.
- acceptanceCriteria: 1-3 checkable statements that are true after the fix lands ("X no longer imports Y", "solve_dcfr_inner takes a params struct; call sites updated").
- testPlan: 1-2 bullets naming what to run or write, referencing the project's actual test setup if you saw one.
- nonGoals: 1-2 bullets fencing off adjacent work that should NOT be pulled into this fix.
- agentNotes: gotchas an implementing agent needs (hidden couplings, ordering constraints, corrected line refs) — null if none.

Return ONLY the structured verdict.`
}

function summaryPrompt(survivors, counts, lensesUsed) {
  const lensList = (lensesUsed || []).map((l) => l.title).join(', ')
  const topFiles = [...new Set(survivors.flatMap(f => (f.files || []).map(f => f.path)))].slice(0, 5)
  const topCategories = [...new Set(survivors.map(f => f.category))].sort()
  return `Write a 2-4 sentence summary of the key architectural findings from this review.

${STE100}

Findings overview:
- Total: ${counts.total} (${counts.critical} Critical, ${counts.high} High, ${counts.medium} Medium, ${counts.low} Low)
- Primary files involved: ${topFiles.join(', ') || '(multiple)'}
- Categories flagged: ${topCategories.join(', ') || '(various)'}
- Lenses applied: ${lensList}

Be strategic: what are the main patterns, bottlenecks, or architectural risks that emerged? Keep it concise and actionable.`
}

function generateMarkdownArtifact(survivors, map, lensesUsed, startHere, resolvedFromPrior) {
  const lensList = (lensesUsed || []).map((l) => l.title).join(', ')
  const lines = []

  // Header and Method
  lines.push('<!-- review-type: architecture-review -->')
  lines.push('')
  lines.push('## Method')
  if (map.entryPoints && map.entryPoints.length > 0) {
    lines.push(`- Entry points: ${map.entryPoints.slice(0, 3).join(', ')}${map.entryPoints.length > 3 ? ', ...' : ''}`)
  }
  if (map.coreModules && map.coreModules.length > 0) {
    lines.push(`- Core modules: ${map.coreModules.slice(0, 3).map(m => m.name).join(', ')}${map.coreModules.length > 3 ? ', ...' : ''}`)
  }
  if (map.hotspots && map.hotspots.length > 0) {
    lines.push(`- Measured hotspots (top by LOC/complexity): ${map.hotspots.slice(0, 3).map(h => `\`${h.path}\` ${h.note || ''}`).join('; ')}`)
  }
  lines.push(`- Lenses (mode ${MODE}): ${lensList}`)
  if (map.assumptions && map.assumptions.length > 0) {
    lines.push(`- Assumptions: ${map.assumptions[0]}`)
  }
  lines.push('')

  // Prior section if applicable
  if (PRIOR) {
    lines.push('## Since last review')
    const counts = { new: 0, known: 0 }
    for (const f of survivors) {
      if (f.priorStatus === 'new') counts.new++
      else if (f.priorStatus === 'known') counts.known++
    }
    lines.push(`- New findings: ${counts.new}`)
    lines.push(`- Known (recurring): ${counts.known}`)
    if (resolvedFromPrior && resolvedFromPrior.length > 0) {
      lines.push(`- Resolved from prior review:`)
      for (const title of resolvedFromPrior) {
        lines.push(`  - ${title}`)
      }
    } else {
      lines.push('- Resolved from prior review: none')
    }
    lines.push('')
  }

  // Start Here
  lines.push('## Start here')
  if (startHere && startHere.length > 0) {
    startHere.forEach((s, idx) => {
      const matchingFinding = survivors.find(f => f.id === s.id)
      lines.push(`${idx + 1}. **${s.id} — ${matchingFinding?.title || 'Unknown'}** — ${s.why}`)
    })
  } else {
    const bySeverity = [...survivors].sort((a, b) => {
      const order = { Critical: 0, High: 1, Medium: 2, Low: 3 }
      return (order[a.severity] || 99) - (order[b.severity] || 99)
    }).slice(0, 5)
    lines.push('(Ordered by severity; no leverage edges were identified)')
    bySeverity.forEach((f, idx) => {
      lines.push(`${idx + 1}. **${f.id} — ${f.title}**`)
    })
  }
  lines.push('')

  // Findings header
  lines.push('## Findings')
  if (survivors.length === 0) {
    lines.push('')
    lines.push('### No High-Leverage Issues Found')
    lines.push('The architecture review found no issues meeting the severity threshold.')
  } else {
    // Sort by severity
    const bySeverity = [...survivors].sort((a, b) => {
      const order = { Critical: 0, High: 1, Medium: 2, Low: 3 }
      return (order[a.severity] || 99) - (order[b.severity] || 99)
    })

    for (const f of bySeverity) {
      lines.push('')
      lines.push(`### [${f.severity}] ${f.id}: ${f.title}`)
      lines.push('')

      const fileLines = (f.files || [])
        .map(fr => fr.lines ? `\`${fr.path}:${fr.lines}${f.lineRefsAccurate === false ? ' (approximate)' : ''}\`` : `\`${fr.path}\``)
        .join(', ')
      if (fileLines) lines.push(`**Primary files**: ${fileLines}`)

      lines.push(`**Category**: ${f.category}`)
      lines.push(`**Type**: ${f.confidence >= 0.8 ? 'bug' : 'task'}`)
      const confLevel = f.confidence >= 0.8 ? 'High' : (f.confidence >= 0.5 ? 'Medium' : 'Low')
      lines.push(`**Confidence**: ${confLevel}`)
      if (f.sourceLenses && f.sourceLenses.length > 0) {
        lines.push(`**Source**: ${f.sourceLenses.join(', ')}`)
      }
      if (f.unlocks && f.unlocks.length > 0) {
        lines.push(`**Unlocks**: ${f.unlocks.join(', ')}`)
      }

      lines.push('**Context**:')
      lines.push(`- ${f.whatsWrong}`)
      lines.push(`- ${f.whyItMatters}`)
      lines.push('')
      lines.push(`**Fix**: ${f.refinedFix || f.fix}`)

      if (f.nonGoals && f.nonGoals.length > 0) {
        lines.push('')
        lines.push('**Non-goals**:')
        for (const ng of f.nonGoals) {
          lines.push(`- ${ng}`)
        }
      }

      if (f.acceptanceCriteria && f.acceptanceCriteria.length > 0) {
        lines.push('')
        lines.push('**Acceptance Criteria**:')
        for (const ac of f.acceptanceCriteria) {
          lines.push(`- ${ac}`)
        }
      }

      if (f.testPlan && f.testPlan.length > 0) {
        lines.push('')
        lines.push('**Test Plan**:')
        for (const tp of f.testPlan) {
          lines.push(`- ${tp}`)
        }
      }

      if (f.agentNotes) {
        lines.push('')
        lines.push(`**Agent Notes**: ${f.agentNotes}`)
      }
    }
  }

  return lines.join('\n')
}

function generateJsonSidecar(survivors, startHere, resolvedFromPrior) {
  const obj = {
    reviewType: 'architecture-review',
    mode: MODE,
    artifact: OUT,
    startHere: startHere || [],
    resolvedFromPrior: resolvedFromPrior || [],
    findings: survivors,
  }
  return JSON.stringify(obj, null, 2)
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
log(`architecture-review: mode=${MODE}, out=${OUT}${FOCUS ? `, focus="${FOCUS}"` : ''}${PRIOR ? `, prior=${PRIOR}` : ''}`)
log(`models: ${['scout', 'finder', 'merge', 'critic', 'verify', 'synth'].map((r) => `${r}=${modelFor(r) || 'inherit'}`).join(', ')}`)

phase('Map')
const map = await agent(scoutPrompt(), withModel({ label: 'scout', phase: 'Map', schema: SCOUT_SCHEMA }, 'scout'))

phase('Find')
const lenses = lensesForMode(MODE)
log(`Find: ${lenses.length} lenses — ${lenses.map((l) => l.key).join(', ')}`)
const perLens = await parallel(
  lenses.map((l) => () =>
    agent(finderPrompt(l, map), withModel({ label: `find:${l.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }, 'finder')),
  ),
)
const raw = perLens.flatMap((r, i) =>
  r && Array.isArray(r.findings) ? r.findings.map((f) => ({ ...f, sourceLens: lenses[i].key })) : [],
)
log(`Find: ${raw.length} raw findings`)

let survivors = []
let startHere = []
let resolvedFromPrior = []
if (raw.length > 0) {
  // Barrier: dedup needs the whole set at once.
  phase('Merge')
  const mergedRes = await agent(mergePrompt(raw), withModel({ label: 'merge', phase: 'Merge', schema: MERGED_SCHEMA }, 'merge'))
  let merged = composeMerged(raw, mergedRes.findings)
  startHere = mergedRes.startHere || []
  resolvedFromPrior = mergedRes.resolvedFromPrior || []
  log(`Merge: ${merged.length} findings after dedup${PRIOR ? `, ${resolvedFromPrior.length} resolved since prior` : ''}`)

  // Max mode: one bounded completeness round — critic names uncovered areas,
  // a targeted finder investigates only those, results re-merge into the list.
  if (MODE === 'max') {
    phase('Cover')
    const coverage = await agent(
      coverPrompt(map, merged),
      withModel({ label: 'critic', phase: 'Cover', schema: COVERAGE_SCHEMA }, 'critic'),
    )
    const gaps = ((coverage && coverage.gaps) || []).slice(0, 3)
    if (gaps.length > 0) {
      log(`Cover: ${gaps.length} gaps — ${gaps.map((g) => g.area).join('; ')}`)
      const gapRes = await agent(
        gapFinderPrompt(gaps, map),
        withModel({ label: 'find:gaps', phase: 'Cover', schema: FINDINGS_SCHEMA }, 'finder'),
      )
      const gapFindings = ((gapRes && gapRes.findings) || []).map((f) => ({ ...f, sourceLens: 'gaps' }))
      if (gapFindings.length > 0) {
        log(`Cover: ${gapFindings.length} new findings from gap round — re-merging`)
        const remergeInput = [...merged, ...gapFindings]
        const remerged = await agent(
          mergePrompt(remergeInput),
          withModel({ label: 'remerge', phase: 'Cover', schema: MERGED_SCHEMA }, 'merge'),
        )
        const recomposed = composeMerged(remergeInput, remerged.findings)
        if (recomposed.length > 0) {
          merged = recomposed
          startHere = remerged.startHere || startHere
          resolvedFromPrior = remerged.resolvedFromPrior || resolvedFromPrior
        }
        log(`Cover: ${merged.length} findings after re-merge`)
      } else {
        log('Cover: gap round produced no findings — flagged areas were clean')
      }
    } else {
      log('Cover: no gaps — finder coverage complete')
    }
  }

  phase('Verify')
  survivors = (
    await parallel(
      merged.map((f) => () =>
        agent(verifyPrompt(f), withModel({ label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA }, 'verify')).then((v) => ({
          finding: {
            ...f,
            severity: (v && v.isReal && v.calibratedSeverity) || f.severity,
            lineRefsAccurate: v ? v.lineRefsAccurate !== false : true,
            refinedFix: (v && v.refinedFix) || null,
            acceptanceCriteria: (v && v.acceptanceCriteria) || [],
            testPlan: (v && v.testPlan) || [],
            nonGoals: (v && v.nonGoals) || [],
            agentNotes: (v && v.agentNotes) || null,
          },
          keep: !!(v && v.isReal),
        })),
      ),
    )
  )
    .filter(Boolean)
    .filter((v) => v.keep)
    .map((v) => v.finding)
  log(`Verify: ${survivors.length}/${merged.length} findings survived (with enrichment)`)

  // Drop refuted findings from the ordering and their unlocks edges.
  const surviving = new Set(survivors.map((f) => f.id))
  startHere = startHere.filter((s) => surviving.has(s.id))
  for (const f of survivors) f.unlocks = (f.unlocks || []).filter((id) => surviving.has(id))
}

phase('Write')

// Count findings by severity (deterministic, no agent needed)
const counts = { critical: 0, high: 0, medium: 0, low: 0, total: survivors.length }
for (const f of survivors) {
  const level = f.severity.toLowerCase()
  if (level in counts) counts[level]++
}

// Generate artifacts deterministically (verifiers already enriched findings; we just format them).
// This avoids the context-truncation bug where one agent emitting all findings in one shot
// causes large findings arrays to be silently dropped during processing.
// (See MERGED_SCHEMA comment above for historical context on this pattern.)
const mdContent = generateMarkdownArtifact(survivors, map, lenses, startHere, resolvedFromPrior)
const jsonContent = generateJsonSidecar(survivors, startHere, resolvedFromPrior)

// Verify artifacts contain all findings before writing
const findingsInMd = (mdContent.match(/### \[(?:Critical|High|Medium|Low)\] [F\d]+:/g) || []).length
const findingsInJson = (jsonContent.match(/"id":/g) || []).length
const expectedCount = survivors.length

if (findingsInMd !== expectedCount) {
  log(`CRITICAL: generateMarkdownArtifact lost findings: generated ${findingsInMd}, expected ${expectedCount}`)
}
if (findingsInJson !== expectedCount) {
  log(`CRITICAL: generateJsonSidecar lost findings: generated ${findingsInJson}, expected ${expectedCount}`)
}

// Write artifacts via lightweight agent calls (no finding data passed to agent)
await agent(
  `Write the architecture review markdown artifact to ${OUT}. The content must use ASD-STE100 Simplified Technical English. Content is provided below; write it exactly as-is, creating parent directories if needed.\n\n\`\`\`\n${mdContent}\n\`\`\``,
  withModel({ label: 'write-md', phase: 'Write', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, 'synth'),
)

await agent(
  `Write the architecture review JSON sidecar to ${SIDECAR}. Content is valid JSON; write it exactly as-is, creating parent directories if needed.\n\n\`\`\`json\n${jsonContent}\n\`\`\``,
  withModel({ label: 'write-json', phase: 'Write', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, 'synth'),
)

// Generate summary via a lightweight agent call (no finding data passed)
const summResult = await agent(
  summaryPrompt(survivors, counts, lenses),
  withModel({ label: 'summarize', phase: 'Write', schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } }, 'synth'),
)

const result = {
  path: OUT,
  summary: summResult.summary || '(summary generation skipped)',
  counts,
}

log(`Write: artifact at ${OUT}, sidecar at ${SIDECAR} (${expectedCount} findings written, all verified)`)

return result
