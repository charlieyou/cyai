import { afterAll, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliAmp } from '../src/server'

const dir = mkdtempSync(join(tmpdir(), 'relay-cli-'))
const bin = join(dir, 'amp')
// Mimics `amp`: execute mode prints init + the user message, then keeps running (the turn) until killed.
writeFileSync(bin, `#!/bin/bash
printf '%s\\0' "$@" > "${dir}/args"
case "$1 $2" in
  "projects list") echo '[{"namespace":"me","name":"poker","repositoryURL":"https://github.com/charlieyou/poker"}]' ;;
  "threads export") echo '{"messages":[{"role":"user","content":[]}]}' ;;
  "threads archive"|"threads share") ;;
  "threads continue"|--orb-execute*)
    echo '{"type":"system","subtype":"init","session_id":"T-abc"}'
    echo '{"type":"user","message":{}}'
    sleep 30 ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`)
chmodSync(bin, 0o755)
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const args = () => readFileSync(join(dir, 'args'), 'utf8').split('\0').slice(0, -1)
const amp = cliAmp(bin)

test('createThread detaches once the prompt is in the thread', async () => {
	const started = Date.now()
	expect(await amp.createThread({ project: 'me/poker', prompt: 'line 1\nline 2', title: 'ENG-1: x', mode: 'high' })).toBe('T-abc')
	expect(Date.now() - started).toBeLessThan(5000)
	expect(args()).toEqual(['--orb-execute', '--project', 'me/poker', '--title', 'ENG-1: x', '--mode', 'high', '--execute', 'line 1\nline 2', '--stream-json', '--no-archive-after-execute'])
})

test('send continues the thread in its orb', async () => {
	await amp.send('T-abc', 'more')
	expect(args()).toEqual(['threads', 'continue', 'T-abc', '--orb-execute', '--execute', 'more', '--stream-json', '--no-archive-after-execute'])
})

test('projects, export, archive, URLs', async () => {
	expect((await amp.listProjects())[0]).toMatchObject({ ref: 'me/poker', repo: 'charlieyou/poker' })
	expect(await amp.messages('T-abc')).toEqual([{ role: 'user', content: [] }])
	await amp.archive('T-abc')
	expect(args()).toEqual(['threads', 'archive', 'T-abc'])
	await amp.enableMultiplayer('T-abc')
	expect(args()).toEqual(['threads', 'share', 'multiplayer', 'on', 'T-abc'])
	expect(amp.threadURL('T-abc')).toBe('https://ampcode.com/threads/T-abc')
})

test('a failing command rejects with its stderr', async () => {
	const broken = cliAmp(join(dir, 'missing'))
	await expect(broken.messages('T-abc')).rejects.toThrow()
})

test('delivery fails unless the message is echoed into the thread', async () => {
	for (const [name, script] of [['exit1', 'exit 1'], ['exit0', 'exit 0']] as const) {
		const path = join(dir, `amp-${name}`)
		writeFileSync(path, `#!/bin/bash\necho '{"type":"system","subtype":"init","session_id":"T-x"}'\necho oops >&2\n${script}\n`)
		chmodSync(path, 0o755)
		await expect(cliAmp(path).send('T-x', 'hi')).rejects.toThrow(/before the message reached the thread \(thread T-x\): oops/)
	}
})
