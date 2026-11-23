---
name: writing-clear-prose
description: "Writes and revises English prose for easy human reading by eliminating dense LLM constructions identified in psycholinguistic research: inanimate subjects paired with animate verbs, stacked noun compounds, ad-hoc denominal verbs, dropped relative-clause signposts, long subject-verb gaps, and compressed phrasing. Use when drafting or editing explanations, documentation, essays, emails, PR descriptions, design docs, or dense AI drafts for human readers. Not for writing agent prompts or code-only edits."
---

# Writing Clear Prose

Write for a single left-to-right pass by a human reader with limited working memory, not for minimum token count. Post-trained LLMs compress phrasing to save tokens, which produces grammatical English that still makes readers pause and re-read—especially during multi-turn technical and chat discussions. Spread new information evenly across each sentence by using a few ordinary function words (`that`, `of`, `for`, `so that`) to make the sentence structure obvious. Cut filler ideas, never structural signposts.

## Six Patterns to Fix

Apply these six rules when drafting or revising prose for human readers (adapted from Clark, Martin, & Mahowald, 2026).

### 1. Pair inanimate subjects with literal verbs

Readers use animacy as a cue to parse clauses. When a non-living subject takes an active verb that normally requires a person, the reader has to re-parse the sentence. This often happens when functions, files, policies, concepts, or pronouns (`it`, `this`) are paired with verbs such as `swallows`, `bites`, `promises`, `forgets`, `expects`, `asks`, `hopes`, `misunderstands`, or `eats`.

- Use a literal verb that fits a non-living subject (`returns`, `skips`, `states`, `omits`, `causes`, `fails when`), or make a person, team, or user the subject.
- Example — dense: "`is_file()` swallows that error and returns `False`, even though the docstring promises it won't."
- Example — clear: "`is_file()` handles that error by returning `False`, even though the docstring specifies that it raises an exception."
- Example — dense: "The check covered `str` but forgot `bytes`, which is where this asymmetry bites."
- Example — clear: "The check handled `str` but omitted `bytes`, which is where this mismatch causes a bug."
- Example — dense: "The time objection misunderstands how community service actually works."
- Example — clear: "Critics who raise the time objection misunderstand how community service actually works."

### 2. Break up stacked nouns (three or more in a row)

When three or more nouns pile up as modifiers, the reader cannot tell immediately which noun modifies which (`dotfile backup path handling`, `class-time shutdown requirement`, `reader-patience budget`).

- Keep natural two-noun phrases intact, even when an adjective or participle precedes them (keep `database timeouts` and `failed login attempts` rather than rewriting them as `timeouts from the database` or `failed attempts at login`). Also keep fixed proper names intact.
- Unpack stacks of three or more nouns by using an active verb, an `-ing` phrase, or a simple preposition (`for`, `in`, `during`, `about`). Prefer verbal phrasing (`validating user input during signup`, `backing up dotfiles`) over heavy `of` chains (`validation of input of users during signup`).
- Example — dense: "Fixed absolute dotfile backup path handling and split long error-message string literals."
- Example — clear: "Fixed how absolute paths are handled when backing up dotfiles, and split long string literals used for error messages."
- Example — dense: "Policy 1's class-time shutdown requirement directly addresses distraction."
- Example — clear: "Policy 1's requirement to shut down phones during class directly addresses distraction."

### 3. Replace ad-hoc denominal verbs with plain verbs

Turning a noun into a verb saves a word or two, but it forces the reader to resolve part-of-speech ambiguity. Common examples in AI text include `footnote it`, `calendar it`, `cushion price spikes`, `mask that inconsistency`, `mirror real-world challenges`, and `pool judgments`.

- Use a plain, unambiguous verb—or a short verb phrase—instead of converting a noun into a verb.
- Keep a noun-derived verb only when it is the standard action verb in that domain, such as `stage` in Git or `cache` in systems work.
- Example — dense: "Footnote that caveat, and calendar a review before the fallback masks the inconsistency."
- Example — clear: "Put that caveat in a footnote, and schedule a review before the fallback hides the inconsistency."
- Example — dense: "High inventory cushions price spikes, and pooling independent estimates mirrors real-world forecasting."
- Example — clear: "High inventory softens price spikes, and combining independent estimates resembles real-world forecasting."

### 4. Keep optional signposts and avoid nested object relative clauses

Under compression pressure, LLMs favor bare object relative clauses and drop optional signposts such as `that`, `which`, `who`, `so that`, `in order to`, and `all of`. Missing signposts cause brief misreads when a new subject starts unexpectedly, as in `behavior the old code never reached` or `the policy you are considering`.

- Keep `that`, `who`, or `which` in object relative clauses and complement clauses whenever dropping the word puts two noun phrases—or a verb and a new subject—side by side, as in `knew that the answer was wrong` and `the policy that you are considering`.
- Choose between other syntactic variants by context and natural rhythm rather than defaulting to either the shortest or longest form: use `so that` when `so` alone could read as "therefore", keep plain `to` when purpose is already clear instead of forcing `in order to`, and order dative or genitive phrases (`gave a gift to his wife` vs. `gave his wife a gift`, `the roof of the old house` vs. `the old house's roof`) with shorter phrases before longer ones.
- When an object relative clause sits inside an already complex sentence, rewrite it in direct active order, passive order, or two short clauses.
- Example — dense: "The remaining tests check behavior the old code never reached; the unclosed-tag error is the papercut people feel day-to-day."
- Example — clear: "The remaining tests check behavior that the old code never reached. The unclosed-tag error is the everyday annoyance that people run into most."
- Example — dense: "They knew the answer was wrong and spoke slowly so everyone could follow the policy the committee drafted."
- Example — clear: "They knew that the answer was wrong and spoke slowly so that everyone could follow the policy drafted by the committee."

### 5. Keep subjects close to their verbs

Human working memory fades across intervening words. When you wedge a long list, qualifier, or embedded clause between a subject and its verb, the reader has to hold the start of the sentence in mind until the verb arrives. The same strain occurs when a long modifier list sits between a verb and its head noun.

- Place each main verb close to its subject, and keep each verb close to its object.
- Move parenthetical lists, conditions, and secondary clauses to the end of the sentence or into a second sentence. Place shorter phrases before longer ones.
- Example — dense: "All five expression shapes — attribute access, subscript, calls, nested calls, string literals — leave `current` on `NAME('b')`."
- Example — clear: "All five expression shapes leave `current` on `NAME('b')`: attribute access, subscript, calls, nested calls, and string literals."
- Example — dense: "A lattice constructed with duplicate points, or a `SymbolSet` with colliding labels, can overwrite internal dictionary or attribute mappings."
- Example — clear: "If a lattice has duplicate points or a `SymbolSet` has colliding labels, it can overwrite internal dictionary or attribute mappings."
- Example — dense: "Has the building had water, mold, structural, or insurance claims?"
- Example — clear: "Has the building had any claims for water, mold, structural damage, or insurance?"

### 6. Use plain collocations instead of compressed shorthand

Reading slows down when unfamiliar or overly dense word pairs appear back-to-back, such as `idempotent config reinstalls`, `existing xfailed lazy-intermediate Lookup behavior`, `a gear trap`, or `reader-patience budget`.

- Express one new technical or abstract idea per clause, surrounded by ordinary, predictable phrasing.
- Favor conventional word pairings over clever coinages or telegraphic summaries.
- Example — dense: "The most substantive unfixed item is the existing xfailed lazy-intermediate `Lookup` behavior, alongside idempotent config reinstalls."
- Example — clear: "The biggest remaining issue is the lazy-intermediate `Lookup` behavior, which already has an `xfail` test. We also added tests to make sure that reinstalling the config is idempotent."
- Example — dense: "The convoluted sentence you are currently reading is quietly eating its own reader-patience budget — footnote it."
- Example — clear: "Readers will quickly lose patience with this convoluted sentence, so move it to a footnote."

## Workflow

1. Draft for technical accuracy and completeness first. Keep exact code symbols, API names, numbers, and domain terms intact.
2. Do one editing pass before finalizing. Scan each sentence for the six patterns above: animate verbs on non-living subjects, stacks of three or more nouns, ad-hoc denominal verbs, dropped `that`/`which`/`so that` signposts, wide subject-verb gaps, and compressed word pairs.
3. Preserve accuracy and conciseness. Add only structural signposts and plain verbs, not filler or throat-clearing. Leave quoted text, error messages, and fixed proper names untouched.

## Common Excuses That Do Not Hold

- "Cutting `that` and stacking nouns makes the writing tighter and punchier." Saving one token shifts parsing work onto the reader. Remove unnecessary claims or repetition instead of removing syntactic cues.
- "Verbs like `swallows`, `bites`, `promises`, or `masks` sound natural in technical writing." They violate animacy and part-of-speech cues on first pass and accumulate into dense jargon across multi-turn conversations.
- "Technical precision requires noun chains like `dotfile backup path handling`." You keep every technical detail when you use prepositions and short clauses, and you remove ambiguity about how the terms group together.
