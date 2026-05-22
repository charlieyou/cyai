import { describe, expect, test } from 'bun:test'

import safetyNet from './safety-net'

type SafetyNetAction = 'allow' | 'prompt'

async function safetyNetAction(command: string): Promise<SafetyNetAction> {
	let handler: ((event: { command: string }, ctx: { ui: { confirm: () => Promise<boolean> } }) => Promise<{ action: string }>) | undefined

	safetyNet({
		helpers: {
			shellCommandFromToolCall: (event: { command: string }) => ({ command: event.command }),
		},
		on: (_name: string, callback: typeof handler) => {
			handler = callback
		},
	} as never)

	if (!handler) throw new Error('safety-net handler was not registered')

	let prompted = false
	await handler({ command }, {
		ui: {
			confirm: async () => {
				prompted = true
				return false
			},
		},
	})

	return prompted ? 'prompt' : 'allow'
}

describe('safety-net', () => {
	const solverSmokeWithTmpLog = `tmp=$(mktemp -d /tmp/solver-parallel-smoke.XXXXXX); cat > "$tmp/config.yaml" <<'YAML'
suite_name: parallel_smoke
output_dir: results/mccfr-variants
seeds: [0, 1]
probe_m: 1
m_sampled_br: 0
checkpoint_strategy: { kind: log_spaced, per_decade: 2 }
games:
  - name: kuhn
    tier: toy
    budgets: [8, 16]
variants: [A, B]
YAML
target/release/run_mccfr_variants --config "$tmp/config.yaml" --output-dir "$tmp/out" --jobs 2 >/tmp/solver-parallel-smoke.log 2>&1
run_dir=$(find "$tmp/out/mccfr-variants" -mindepth 1 -maxdepth 1 -type d | head -1)
wc -l "$run_dir/metrics.csv"
find "$run_dir/checkpoints" -type f | wc -l
rm -rf "$tmp" /tmp/solver-parallel-smoke.log`

	const solverSmokeWithTmpLocalLog = `tmp=$(mktemp -d /tmp/solver-parallel-smoke.XXXXXX); cat > "$tmp/config.yaml" <<'YAML'
suite_name: parallel_smoke
output_dir: results/mccfr-variants
seeds: [0, 1]
probe_m: 1
m_sampled_br: 0
checkpoint_strategy: { kind: log_spaced, per_decade: 2 }
games:
  - name: kuhn
    tier: toy
    budgets: [8, 16]
variants: [A, B]
YAML
target/release/run_mccfr_variants --config "$tmp/config.yaml" --output-dir "$tmp/out" --jobs 2 >"$tmp/log" 2>&1 || { cat "$tmp/log"; exit 1; }
find "$tmp" -maxdepth 4 -type f -o -type d | sort | sed -n '1,80p'
run_dir=$(find "$tmp/out" -name metrics.csv -printf '%h\n' | head -1)
echo "run_dir=$run_dir"
wc -l "$run_dir/metrics.csv"
find "$run_dir/checkpoints" -type f | wc -l
rm -rf "$tmp"`

	const externalCalibrationCommand = `python3 - <<'PY'
from pathlib import Path
p=Path('/tmp/nlhe_turnriver_3way_external_calibration.yaml')
s=p.read_text()
s=s.replace('variants:\n  - name: C\n', '''variants:\n  - name: A\n    config:\n      sampler: external\n  - name: C\n''')
p.write_text(s)
PY
rm -rf /tmp/nlhe-turnriver-3way-external-calibration
cargo run --release -p solver-experiments --bin run_mccfr_variants -- --config /tmp/nlhe_turnriver_3way_external_calibration.yaml --output-dir /tmp/nlhe-turnriver-3way-external-calibration --jobs 4`

	test.each([
		['original smoke command with redirected /tmp log', solverSmokeWithTmpLog],
		['original smoke command with log inside temp dir', solverSmokeWithTmpLocalLog],
		['external calibration command with /tmp cleanup', externalCalibrationCommand],
		['generic mktemp cleanup', 'tmp=$(mktemp -d); echo hi; rm -rf "$tmp"'],
		['quoted mktemp assignment cleanup', 'tmp="$(mktemp -d)"; echo hi; rm -rf $tmp'],
		['templated mktemp cleanup', 'workdir=$(mktemp -d /tmp/foo.XXXXXX); echo hi; rm -rf $workdir'],
		['braced mktemp var cleanup', 'tmp=$(mktemp -d); rm -rf "${tmp}"'],
		['redirected /tmp file created in same command', 'tmp=$(mktemp -d); echo hi >/tmp/created.log; rm -rf "$tmp" /tmp/created.log'],
		['direct /tmp directory cleanup', 'rm -rf /tmp/nlhe-turnriver-3way-external-calibration'],
		['quoted direct /tmp directory cleanup', 'rm -rf "/tmp/nlhe-turnriver-3way-external-calibration"'],
		['direct /tmp file cleanup', 'rm -rf /tmp/not-created.log'],
		['direct /tmp cleanup with quoted text nearby', "echo ' > /tmp/keep-me'; rm -rf /tmp/keep-me"],
		['relative node_modules cleanup', 'rm -rf node_modules'],
		['relative nested __pycache__ cleanup', 'rm -rf ./pkg/__pycache__'],
	])('allows %s', async (_name, command) => {
		expect(await safetyNetAction(command)).toBe('allow')
	})

	test.each([
		['mktemp cleanup followed by force push', 'tmp=$(mktemp -d); rm -rf "$tmp"; git push --force'],
		['mktemp cleanup followed by dd', 'tmp=$(mktemp -d); rm -rf "$tmp"; dd if=/dev/zero of=/dev/sda'],
		['commented mktemp assignment', '# tmp=$(mktemp -d)\nrm -rf "$tmp"'],
		['different variable cleanup', 'tmp=$(mktemp -d); rm -rf "$other"'],
		['mktemp cleanup plus root delete', 'tmp=$(mktemp -d); rm -rf "$tmp" /'],
		['tmp root delete', 'rm -rf /tmp'],
		['tmp parent traversal delete', 'rm -rf /tmp/../home'],
		['absolute node_modules cleanup', 'rm -rf /root/node_modules'],
		['parent-traversing node_modules cleanup', 'rm -rf ../../other-repo/node_modules'],
		['force refspec push', 'git push origin +main'],
		['force HEAD refspec push', 'git push origin +HEAD'],
		['delete push', 'git push --delete origin branch'],
		['short delete push', 'git push -d origin branch'],
		['delete refspec push', 'git push origin :branch'],
		['mirror push', 'git push --mirror'],
		['unsupported syntax force push', "X=$(printf '%s %s' a b) git push -f"],
		['unsupported syntax force-with-lease push', "X=$(printf '%s %s' a b) git push --force-with-lease"],
		['unsupported syntax force refspec push', "X=$(printf '%s %s' a b) git push origin +main"],
		['unsupported syntax delete push', "X=$(printf '%s %s' a b) git push --delete origin branch"],
		['unsupported syntax mirror push', "X=$(printf '%s %s' a b) git push --mirror"],
	])('prompts for %s', async (_name, command) => {
		expect(await safetyNetAction(command)).toBe('prompt')
	})
})
