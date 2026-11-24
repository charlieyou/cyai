# Landing a worker's commit

The coordinator lands every worker commit; workers never push to the shared branch. The landing worktree is a separate git worktree used only for landing, so gates never disturb a worker's tree or the user's main checkout. Its path, the gate command and the acceptance bar are project settings in the schedule prompt.

## Before the gate

1. Verify the report as in SKILL.md ("Verifying a report") and check it against the acceptance bar. A change that does not clear the bar is not landed even when nothing got worse; tell the worker to save the patch and drop it.
2. Check that the landing worktree is free: no gate process running in it (`pgrep -af <land>`), and `git -C <land> status` shows no rebase or merge in progress. Only one gate runs in a landing worktree at a time; record the queue in the schedule prompt and start the next commit when the monitor reports the current gate done. A second suite that runs at the same time needs its own build directory.
3. Rebase in the landing worktree:

   ```bash
   git -C <land> fetch -q origin               # also fetches an orb worker's pushed branch
   git -C <land> rev-parse origin/<branch>     # orb worker: must equal <reported-sha>
   git -C <worktree> rev-parse <branch>        # runner worker: must equal <reported-sha>
   git -C <land> diff --name-only origin/main...<reported-sha> > /tmp/land-files
   git -C <land> checkout -q --detach <reported-sha>
   git -C <land> rebase origin/main
   xargs -d '\n' -a /tmp/land-files git -C <land> diff <reported-sha> HEAD --
   ```

   `/tmp/land-files` lists every file the worker's commits changed since they left `origin/main`. If it is empty, the commit is already in `origin/main`; stop and tell the worker it has landed. If the rebase stops on a conflict, run `git -C <land> rebase --abort` and tell the worker to rebase its branch onto `origin/main` and report the new SHA. The last command must print nothing, which shows the rebase did not change the files the worker changed and checked. If it prints a diff, the worker's evidence no longer describes this tree; ask the worker to rebase and rerun the affected checks.

   To land several workers' commits together, cherry-pick each worker's range onto the result of the previous one, run the same file list and diff check for each worker against its own reported SHA, and gate the stack once; one gate then covers all of them.

## Running the gate

Run the gate in the background with all output in a log named for this landing. Run it under the shared lock when its load would disturb other jobs on the machine. Empty the log before waiting for the lock, so the monitor never reads a previous gate's result. The gate prints the SHA first and `RC[n]` after each step; the wrapper prints the done marker, so it appears even when the gate script dies early:

```bash
: > <log> && { flock <lock> bash <gate-script> <land>; echo "GATE_DONE rc=$?"; } >> <log> 2>&1
```

Start a monitor on the log as SKILL.md ("Waiting") describes, for example `tail -n +1 -F <log> | grep --line-buffered -E 'GATE_DONE|RC\[[1-9]|FAIL'` plus the failure words of the project's test runner, then end the turn. When it fires, check that the log's first line names the SHA you gated.

The gate must run every check `main` is held to, including lint steps that CI or another coordinator enforces. When the change touches a component with its own suite or hardware, run that suite too. The schedule prompt says when a suite can be skipped.

When the monitor fires, read the summary lines in the log (test counts, `RC[...]` per step). Do not trust a wrapper's exit code alone.

## When a test fails

- A failure in a test not on the known-flaky list blocks the landing. Tell the worker the test, the log path and the failing lines.
- A test on the known-flaky list follows the user's written rule in the schedule prompt. If the schedule prompt has no rule for it, do not land: ask the user, and propose a rule such as "rerun it alone 25 times in the landing worktree after the other jobs finish, and land only if all 25 pass". Run `scripts/rerun-alone.sh` for the reruns.
- If the reruns do not meet the rule, take it to the user with numbers instead of landing. A useful comparison: alternate blocks of solo runs on `origin/main` and on the candidate, and report the pass rate of each. Ask whether to land and whether to start a fix; a fix never loosens tolerances, drops coverage or adds tests that only pass by construction. Write the user's answer and its scope into the schedule prompt ("covered this commit only").
- A failure in a mechanical check that the coordinator may repair, such as re-keying a lint allowlist, follows the repair rule in the schedule prompt. Commit the repair as a separate commit and push both together.

## Pushing

Push only as the schedule prompt allows: the user decides whether the coordinator pushes each landing on its own, pushes batches, or asks first. If the schedule prompt does not say, ask the user before the first push and record the answer.

Immediately before every push, in the same command:

```bash
git -C <land> fetch -q origin && git -C <land> merge-base --is-ancestor origin/main HEAD && git -C <land> push origin HEAD:main
```

If the ancestor check fails, `origin/main` moved after the rebase (git would also refuse the push; the check makes the next step explicit). Rebase again, then compare: `git -C <land> diff <gated-sha> HEAD --stat`.
- If the only differences are new upstream files that the gated change does not build against, import or test (for example a UI file in a backend change), push without gating again, and say so in your summary.
- Otherwise gate again.

Never force-push `main`.

## After the push

1. Subscribe this thread to CI for the pushed SHA (`create_github_subscription`, `filter_kind: 'ci'`). If CI fails because of the landed change, fix it or revert it before landing anything else.
2. Stop the gate's monitor.
3. Tell the worker the landed SHA and that it should rebase its branch onto it. Tell every other thread that lands on the same branch or depends on the changed code (other workers, other coordinators) the new SHA and whether they must rebase.
4. Update the schedule prompt or tracker: remove the commit from the queue and record anything the user decided during the landing.
