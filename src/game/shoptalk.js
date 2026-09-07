/**
 * What two threads actually say to each other.
 *
 * The speech bubbles started out showing `voiceFor` — the character's genre catchphrase. That
 * made the colony look inhabited and told you nothing, and "nothing" is the wrong answer here
 * because these characters are *sitting on real information*. Each one is a live coding-agent
 * session that knows its own title, its branch, how many times it has been picked up, how big
 * its transcript has grown, which model it runs on, and how long it has been waiting on you.
 *
 * So they trade that instead. Every line below is built from a field that came off disk; there
 * is no invented fact anywhere in this file. That is the whole point and it is also the
 * project's own rule — decoration must never lie about data — applied to dialogue rather than
 * to geometry. If a thread has no branch, its character does not mention branches.
 *
 * Conversations only ever form between threads in the same repo (see `social.js`), which is
 * what makes the comparing lines meaningful: two sessions on the same codebase genuinely do
 * have something to compare.
 */

/** Roughly how long ago, in words. Only ever called with a real timestamp. */
function ago(ts) {
  if (!ts) return null
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60000))
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${Math.round(hours / 24)} days`
}

/** A transcript's size, in words rather than bytes. */
function heft(bytes) {
  if (!bytes) return null
  if (bytes < 40_000) return 'barely started'
  if (bytes < 200_000) return 'a few pages'
  if (bytes < 800_000) return 'getting long'
  return 'enormous'
}

/** Trim a title to something a character would actually say out loud. */
function shortTitle(title) {
  if (!title) return null
  const t = String(title).trim()
  return t.length > 46 ? t.slice(0, 44).trimEnd() + '…' : t
}

/**
 * The things a character can truthfully say about its own thread.
 *
 * Each entry returns null when the underlying field is missing, and the caller drops those —
 * which is how a thread with no git branch simply never brings one up.
 */
const ABOUT_SELF = [
  (t) => {
    const title = shortTitle(t.title)
    return title ? `I'm on “${title}”.` : null
  },
  (t) => (t.gitBranch ? `Still on ${t.gitBranch}.` : null),
  (t) => {
    const size = heft(t.sizeBytes)
    return size ? `My transcript is ${size}.` : null
  },
  (t) => {
    const runs = t.runCount || 0
    return runs > 1 ? `They've come back to me ${runs} times.` : null
  },
  (t) => (t.model ? `I'm running on ${t.model}.` : null),
  (t) => (t.worktree ? `I'm off in the ${t.worktree} worktree.` : null),
]

/** What a character says about *how it is going* — driven by its real status. */
function statusLine(status, thread) {
  const waited = ago(thread.lastActivityAt)
  switch (status) {
    case 'waiting':
      return waited ? `I've been waiting ${waited} for an answer.` : "I'm waiting on a reply."
    case 'blocked':
      return 'I fell over and nobody has looked at it.'
    case 'working':
      return 'Mid-run. Ask me later.'
    case 'celebrating':
      return 'Mine just went green.'
    case 'sleeping':
      return waited ? `Nothing for ${waited}. I think they forgot me.` : 'Nobody has touched me in days.'
    default:
      return waited ? `Quiet since ${waited} ago.` : 'Quiet at the moment.'
  }
}

/** What a character says *back*, having heard the other one. Compares real fields. */
function replyLine(mine, theirs, myStatus, theirStatus) {
  // Same branch is worth remarking on: two sessions on one branch is a real situation.
  if (mine.gitBranch && theirs.gitBranch) {
    if (mine.gitBranch === theirs.gitBranch) return `We're both on ${mine.gitBranch}. Mind the toes.`
    return `I'm on ${mine.gitBranch}, you're on ${theirs.gitBranch}.`
  }
  if (myStatus === 'waiting' && theirStatus === 'waiting') return 'Both of us waiting, then.'
  if (theirStatus === 'blocked' && myStatus !== 'blocked') return 'Better you than me. Mine still runs.'
  if (theirStatus === 'working') return "I'll leave you to it."
  const size = heft(mine.sizeBytes)
  if (size) return `Mine's ${size}, for what that's worth.`
  const title = shortTitle(mine.title)
  return title ? `I'm on “${title}”.` : 'Same repo, different corner of it.'
}

/**
 * One line for this character, in this conversation.
 *
 * `turn` advances as the conversation goes on, so a pair works through opening, status and
 * reply rather than repeating one fact at each other. Deterministic in the conversation's own
 * id, so the same exchange reads the same way for as long as it lasts and does not reshuffle
 * every frame.
 */
export function shoptalk(agent, thread, partner, partnerThread, turn = 0) {
  const t = thread || {}
  const pt = partnerThread || {}

  if (turn === 0) {
    const options = ABOUT_SELF.map((fn) => fn(t)).filter(Boolean)
    if (options.length) return options[Math.abs(hashTurn(agent.id, turn)) % options.length]
    return statusLine(agent.status, t)
  }
  if (turn === 1) return statusLine(agent.status, t)
  if (turn === 2) return replyLine(t, pt, agent.status, partner?.status)

  const options = ABOUT_SELF.map((fn) => fn(t)).filter(Boolean)
  if (!options.length) return statusLine(agent.status, t)
  return options[Math.abs(hashTurn(agent.id, turn)) % options.length]
}

/** A small stable hash, so a given character and turn always pick the same fact. */
function hashTurn(id, turn) {
  let h = 2166136261
  const s = String(id) + ':' + turn
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}
