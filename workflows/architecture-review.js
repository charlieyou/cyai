export const meta = {
  name: 'architecture-review',
  description: 'Principal-engineer architecture review via lensed Claude subagents (no cerberus)',
  whenToUse:
    'High-leverage design/refactor review of a codebase. Replaces the cerberus architecture-review skill: where that skill fanned out across three model vendors, this fans out across distinct architectural lenses. Output is a markdown artifact that feeds /create-tasks.',
  phases: [
    { title: 'Map', detail: 'one scout builds the system map + hotspot inventory' },
    { title: 'Find', detail: 'one finder per architectural lens, in parallel (read-only)' },
    { title: 'Merge', detail: 'dedup + severity-calibrate across all findings' },
    { title: 'Verify', detail: 'adversarially refute each finding before it lands (read-only)' },
    { title: 'Write', detail: 'synthesizer writes the review artifact' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (all optional, passed via Workflow `args`)
//   mode  : 'fast' | 'smart' | 'max'   (default 'smart')
//   focus : free-text emphasis, e.g. "the API layer"     (default none)
//   scope : files/dirs to review                          (default whole repo)
//   out   : artifact path                                 (default docs/architecture-review.md)
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
const FOCUS = ARGS.focus || ''
const SCOPE = ARGS.scope || 'the entire repository, starting from entry points and high-traffic modules'
const OUT = ARGS.out || 'docs/architecture-review.md'

// Model assignment by role. Each mode ships a cost/quality-tuned default map:
// fast is Sonnet everywhere except Opus discovery; smart spends Opus on the
// lossy judgment phases; max uses Fable only where it has the highest leverage.
// Callers override globally with args.model or per role with
// args.models = { scout, finder, merge, verify, synth }.
// Precedence: args.models[role] > args.model > per-mode default.
const VALID_MODELS = ['opus', 'sonnet', 'fable']
const validModel = (m) => (VALID_MODELS.includes(m) ? m : undefined)
const MODE_MODELS = {
  fast: { scout: 'sonnet', finder: 'opus', merge: 'sonnet', verify: 'sonnet', synth: 'sonnet' },
  smart: { scout: 'sonnet', finder: 'opus', merge: 'opus', verify: 'opus', synth: 'sonnet' },
  max: { scout: 'opus', finder: 'fable', merge: 'opus', verify: 'fable', synth: 'sonnet' },
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

// ---------------------------------------------------------------------------
// Shared review doctrine (distilled from the cerberus architecture-review
// generator + reviewer prompts). Kept identical across finders so lenses stay
// comparable; each lens then narrows the "What to look for" section.
// ---------------------------------------------------------------------------
const DOCTRINE = `You are performing a PRINCIPAL-ENGINEER architecture review focused on HIGH-LEVERAGE design improvements — maximum long-term payoff per hour invested. Prefer functional patterns (pure functions, explicit data flow, composition) unless the code clearly benefits from OO.

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
          files: { type: 'array', items: FILE_REF },
          whatsWrong: { type: 'string' },
          whyItMatters: { type: 'string' },
          fix: { type: 'string' },
          sourceLenses: { type: 'array', items: { type: 'string' } },
          confidence: { type: ['number', 'null'] },
        },
        required: ['id', 'title', 'severity', 'category', 'files', 'whatsWrong', 'fix', 'sourceLenses'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean' },
    calibratedSeverity: SEVERITY,
    lineRefsAccurate: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['isReal', 'reason'],
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

Produce a system map:
1. Entry points (mains, CLI commands, HTTP handlers, factories/composition roots).
2. Core modules with one-line responsibilities.
3. Main orchestration / data flows (origin -> transport -> consumption).
4. HOTSPOT INVENTORY — the top ~5 files by LOC and top ~5 functions by complexity (or best proxy). Explicitly call out any file > 500 LOC or function > 80 lines (record loc and a short note).
5. Assumptions / unknowns.

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
  return `You are MERGING findings from several architecture finders (each used a different lens). You will NOT re-review the codebase here; you reconcile the list. You MAY read code briefly to resolve a conflict.

Raw findings (JSON):
${JSON.stringify(raw, null, 2)}

Rules:
1. DEDUPLICATE: merge findings describing the same underlying problem (same files/concern), even if worded differently or filed under different categories.
2. RAISE CONFIDENCE for issues independently surfaced by multiple lenses; record every contributing lens in sourceLenses.
3. CALIBRATE SEVERITY against the aggregate evidence; pick the single best category.
4. Assign each merged finding a stable id: "F1", "F2", ... in descending severity order (Critical first).
5. Preserve concrete file/line anchors; keep the tightest accurate ranges.

Merge by ROOT CAUSE, not file overlap:
- MERGE (same root, different wording/lens): "duplicated retry logic in http.js/queue.js" + "copy-pasted backoff across http.js and queue.js".
- DO NOT MERGE (same file, different roots): "server.js mixes IO and business rules" (Cohesion) vs "server.js routing reaches into the DB layer" (Boundaries).

Return ONLY the structured object (deduped, id'd findings).`
}

function verifyPrompt(finding) {
  return `You are ADVERSARIALLY VERIFYING one architecture-review finding. Your job is NOT to review the architecture — it is to decide whether THIS claim is accurate. Default to refuting (isReal=false) if the evidence does not clearly support it.

READ-ONLY. Read the referenced files at the cited lines and check the claim.

Finding:
${JSON.stringify(finding, null, 2)}

Check three angles before deciding:
- CORRECTNESS: does the cited code actually do/contain what the finding claims?
- SEVERITY: is the stated severity justified for what the code shows, or exaggerated?
- REPRODUCIBILITY: is there a concrete scenario where this bites, or is it only speculative?

Set isReal=false ONLY if the finding is:
- Incorrect: the code does not match what the finding claims.
- Unsupported: no concrete evidence in the code for the claimed issue.
- Wrong location: line references do not correspond to the described issue.
- Speculative: predicts future problems with no concrete current impact.

Severity being one level too high is NOT grounds to refute. If the design problem is real but over- or under-rated, keep isReal=true and correct it via calibratedSeverity. "Default to refuting" applies only when evidence is genuinely thin — a finding with concrete, accurate file/line evidence for a real design problem should be KEPT even if you would personally prioritize it lower. ALWAYS set calibratedSeverity to the level the evidence supports, whether or not you keep the finding.

Return ONLY the structured verdict: isReal, calibratedSeverity, lineRefsAccurate, reason (one sentence naming the single decisive factor).`
}

function synthPrompt(survivors, map, lensesUsed) {
  const lensList = (lensesUsed || []).map((l) => l.title).join(', ')
  return `You are the SYNTHESIZER. Write the final architecture-review artifact to disk using the Write tool, then return the structured result.

OUTPUT PATH: ${OUT}  (create parent directories if needed)

Verified findings (already deduped and adversarially verified — keep all, sort by severity Critical -> High -> Medium -> Low):
${JSON.stringify(survivors, null, 2)}

System map (for the Method block):
${JSON.stringify(map, null, 2)}

REQUIRED ARTIFACT FORMAT — the file MUST:
1. Begin EXACTLY with this line:
<!-- review-type: architecture-review -->
2. Then a "## Method" block (3-6 bullets): tools/approach used, entry points reviewed, key files scanned, the hotspot inventory (one bullet), lenses run (mode ${MODE}): ${lensList} — list ALL of these even if a lens produced no surviving findings, so coverage is not understated; assumptions/unknowns.
3. Then a single unified list of issues sorted by severity. For EACH issue use this shape:

### [Severity] Short title

**Primary files**: \`path/to/file:lines\` (list all touched; approximate lines fine)
**Category**: Boundaries | Testability | Complexity | Duplication | Cohesion | Abstraction | Crosscutting
**Type**: bug | task | chore (task for refactors; chore for cleanup; bug if behavior is broken)
**Confidence**: High | Medium | Low (map from the finding's numeric confidence: >=0.8 High, 0.5-0.79 Medium, <0.5 or missing Low; you may raise one band if it survived a multi-vote verify panel)
**Source**: which lens(es) surfaced it (from sourceLenses)
**Context**:
- What's wrong (1 sentence)
- Why it matters / what breaks (1-2 sentences)
**Fix**: Concrete action (1-3 sentences; include tests unless tests are the only change).
**Non-goals**: 1-2 bullets (recommended for Medium+ severity)
**Acceptance Criteria**: 1-3 bullets
**Test Plan**: 1-2 bullets
**Agent Notes**: optional gotchas/constraints

If there are NO findings, still write the Method block, then:

### No High-Leverage Issues Found
The architecture review found no issues meeting the severity threshold. <brief note on what was checked and any positive structural observations>.

Keep descriptions tight (<= 3 sentences each). Do not modify any source files — only write the artifact.

Return: path, a 2-4 sentence summary of key findings, and counts {critical, high, medium, low, total}.`
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
log(`architecture-review: mode=${MODE}, out=${OUT}${FOCUS ? `, focus="${FOCUS}"` : ''}`)
log(`models: ${['scout', 'finder', 'merge', 'verify', 'synth'].map((r) => `${r}=${modelFor(r) || 'inherit'}`).join(', ')}`)

phase('Map')
const map = await agent(scoutPrompt(), withModel({ label: 'scout', phase: 'Map', schema: SCOUT_SCHEMA }, 'scout'))

phase('Find')
const lenses = lensesForMode(MODE)
log(`Find: ${lenses.length} lenses — ${lenses.map((l) => l.key).join(', ')}`)
const raw = (
  await parallel(
    lenses.map((l) => () =>
      agent(finderPrompt(l, map), withModel({ label: `find:${l.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }, 'finder')),
    ),
  )
)
  .filter(Boolean)
  .flatMap((r) => r.findings || [])
log(`Find: ${raw.length} raw findings`)

let survivors = []
if (raw.length > 0) {
  // Barrier: dedup needs the whole set at once.
  phase('Merge')
  const mergedRes = await agent(mergePrompt(raw), withModel({ label: 'merge', phase: 'Merge', schema: MERGED_SCHEMA }, 'merge'))
  const merged = mergedRes.findings || []
  log(`Merge: ${merged.length} findings after dedup`)

  phase('Verify')
  survivors = (
    await parallel(
      merged.map((f) => () =>
        agent(verifyPrompt(f), withModel({ label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA }, 'verify')).then((v) => ({
          finding: { ...f, severity: (v && v.isReal && v.calibratedSeverity) || f.severity },
          keep: !!(v && v.isReal),
        })),
      ),
    )
  )
    .filter(Boolean)
    .filter((v) => v.keep)
    .map((v) => v.finding)
  log(`Verify: ${survivors.length}/${merged.length} findings survived`)
}

phase('Write')
const result = await agent(synthPrompt(survivors, map, lenses), withModel({ label: 'synthesize', phase: 'Write', schema: WRITE_SCHEMA }, 'synth'))
log(`Write: artifact at ${result.path}`)

return result
