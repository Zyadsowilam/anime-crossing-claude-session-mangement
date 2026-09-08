/**
 * Two of your threads, actually asked to talk to each other.
 *
 * Everything else in this world is a *picture* of your sessions. This is the one place where
 * the picture reaches back: it takes two real threads, writes a prompt out of what they are
 * genuinely doing, and runs a real headless Claude call to answer it. What comes back is a
 * real model response about your real work, spoken by the character standing in front of you.
 *
 * Four rules hold this down, and they are the reason it is safe to have at all:
 *
 * 1. **Never automatic.** Nothing in the simulation may call this. It runs when the player
 *    deliberately asks two characters to confer, and it costs a request every time, so a
 *    colony that chattered on its own would quietly spend the user's quota all afternoon.
 * 2. **One at a time.** A second call while one is in flight is refused rather than queued.
 * 3. **The page cannot write the prompt.** It sends *fields* — titles, branches, statuses —
 *    and the template below is assembled here, on the server, out of them. A page that could
 *    post arbitrary text straight into a model call would be an injection hole wearing a
 *    friendly name.
 * 4. **No tools and one turn.** `--allowed-tools ""` and `--max-turns 1`, so this can only
 *    ever produce text. It cannot read a file, run a command, or touch the repos it is
 *    describing.
 */

import fsp from 'node:fs/promises'
import { spawn } from 'node:child_process'

/** How long to wait for a reply before giving up on it. */
const TIMEOUT_MS = 75_000
/** Cap on every field the page sends, so no single value can bloat the prompt. */
const FIELD_MAX = 200
/** Cap on the reply we pass back to the page. */
const REPLY_MAX = 600

/**
 * Things the CLI says when it has failed rather than answered.
 *
 * Matched against the whole reply rather than its start, because these arrive on stdout
 * mixed in with whatever else the process felt like printing.
 */
const CLI_FAILURE =
  /(failed to authenticate|oauth|not logged in|invalid api key|credit balance|usage limit|rate limit|please run .?claude login)/i

/** One in flight at a time. See rule 2. */
let busy = false

/** Take a field from the page as plain text: a string, trimmed, capped, newlines removed. */
function field(value) {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX)
}

/**
 * Describe one thread in a couple of lines.
 *
 * Only fields that actually exist are mentioned — the same rule the in-world dialogue follows.
 * A thread with no branch does not get a line claiming it has one.
 */
function describe(label, t) {
  const bits = [`${label}:`]
  if (t.title) bits.push(`  title: ${t.title}`)
  if (t.project) bits.push(`  repo: ${t.project}`)
  if (t.branch) bits.push(`  branch: ${t.branch}`)
  if (t.status) bits.push(`  state: ${t.status}`)
  if (t.model) bits.push(`  model: ${t.model}`)
  if (t.idleFor) bits.push(`  last touched: ${t.idleFor} ago`)
  return bits.join('\n')
}

/**
 * The prompt. Fixed here, filled from validated fields.
 *
 * Deliberately asks for something *short and useful* rather than a chat. The answer is going
 * to be read in a speech bubble over a character's head by somebody standing in a street, so
 * two sentences that say something true about how these two pieces of work relate is the
 * entire brief. Anything longer is unreadable where it lands.
 */
function buildPrompt(a, b) {
  return [
    'You are one coding-agent session speaking briefly to another session working in the same repository.',
    '',
    describe('You', a),
    '',
    describe('The other session', b),
    '',
    'In at most two short sentences, say something genuinely useful to the other session:',
    'an overlap worth knowing about, a risk of collision, or a question worth asking them.',
    'Speak in the first person, plainly. No preamble, no bullet points, no markdown.',
    'If there is nothing useful to say, say so in one sentence.',
  ].join('\n')
}

/**
 * Run it.
 *
 * @returns {{ok: true, reply: string, prompt: string} | {ok: false, error: string}}
 */
export async function confer(body) {
  if (busy) return { ok: false, error: 'Already conferring — one at a time' }

  const a = {
    title: field(body?.from?.title),
    project: field(body?.from?.project),
    branch: field(body?.from?.branch),
    status: field(body?.from?.status),
    model: field(body?.from?.model),
    idleFor: field(body?.from?.idleFor),
  }
  const b = {
    title: field(body?.to?.title),
    project: field(body?.to?.project),
    branch: field(body?.to?.branch),
    status: field(body?.to?.status),
    model: field(body?.to?.model),
    idleFor: field(body?.to?.idleFor),
  }
  if (!a.title && !a.project) return { ok: false, error: 'Nothing known about that thread' }

  const prompt = buildPrompt(a, b)
  // Only a directory that actually exists is passed through; anything else falls back to the
  // server's own cwd rather than failing the call.
  let cwd = null
  const asked = field(body?.cwd)
  if (asked) {
    try {
      if ((await fsp.stat(asked)).isDirectory()) cwd = asked
    } catch {
      cwd = null
    }
  }
  busy = true
  try {
    const reply = await run(prompt, cwd)
    return { ok: true, reply: reply.slice(0, REPLY_MAX), prompt }
  } catch (err) {
    return { ok: false, error: err?.message || 'The relay failed', prompt }
  } finally {
    busy = false
  }
}

/**
 * Spawn the CLI and collect its answer.
 *
 * The prompt goes in on **stdin** rather than as an argument. Windows has a command-line
 * length limit and an argument this shape is exactly the sort that trips quoting bugs across
 * three different shells; stdin has neither problem.
 */
function run(prompt, cwd = null) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--allowed-tools', '', '--max-turns', '1']
    let child
    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        /**
         * Run in the thread's *own* folder, not wherever this server happens to live.
         *
         * `--allowed-tools ''` stops the model doing anything, and it turns out not to stop it
         * *knowing* things: Claude Code puts the working directory's git state into context
         * before the prompt is even read. Left at the server's own cwd, a session asked about
         * two manufacturing threads confidently described the uncommitted files of the game
         * it was running inside — fluent, specific, and about the wrong repository entirely.
         *
         * Pointing it at the thread's directory turns that from a bug into the best part of
         * the feature: the answer now comes with real knowledge of the actual codebase the two
         * threads share.
         */
        cwd: cwd || undefined,
        // `claude` is a shell shim on Windows, so it needs the shell to be found on PATH.
        shell: process.platform === 'win32',
      })
    } catch (err) {
      reject(new Error('Could not start the claude CLI: ' + err.message))
      return
    }

    let out = ''
    let errOut = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The other session did not answer in time'))
    }, TIMEOUT_MS)

    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (errOut += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error('Could not start the claude CLI: ' + err.message))
    })
    child.on('close', () => {
      clearTimeout(timer)
      const text = out.trim()
      /**
       * The CLI reports its own failures on **stdout**, with exit code 0.
       *
       * Found the hard way: an expired OAuth session came back as a perfectly successful
       * response whose body was "Failed to authenticate: OAuth session expired", which the
       * game then put in a speech bubble as though a character had said it. Exit code and
       * stderr are both useless here, so the diagnostics have to be recognised by sight.
       */
      if (text && !CLI_FAILURE.test(text)) return resolve(text)
      const why = (text || errOut.trim() || 'no answer').split(String.fromCharCode(10))[0]
      /**
       * Say what to *do* about it, not just what went wrong.
       *
       * This is far and away the most common way this feature fails, and the raw CLI text is
       * actively misleading: people see their desktop Claude Code working perfectly and
       * reasonably conclude the relay is broken. It is not — the two authenticate separately.
       * The desktop app has its own session, and reading your threads off disk needs no
       * credentials at all, so everything *else* in this world keeps working while this one
       * feature is signed out.
       */
      if (/failed to authenticate|oauth|not logged in|please run/i.test(why)) {
        reject(new Error('The claude CLI is signed out — run `claude auth login` in a terminal. (Your desktop app signs in separately.)'))
        return
      }
      reject(new Error(why.slice(0, 180)))
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}
