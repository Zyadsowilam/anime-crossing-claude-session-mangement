import { voiceFor } from './themes.js'

/**
 * Conversations, assembled from what a thread has actually been doing.
 *
 * The previous version of talking was one line and a card: you pressed E, somebody said a
 * fixed phrase from their genre, and a panel opened with the same fields the sidebar was
 * already showing. It was worth doing once per character and never again, because nothing
 * you learned came from *them*.
 *
 * So every answer here is built from the thread record — how long since it last ran, how
 * many times it has run, which branch it is on, which model, how big the transcript has
 * grown, whether a pull request landed, whether it fell over. The genre only decides *how*
 * it is said. That split is the whole design: **the facts are the thread's, the voice is the
 * character's**, and no line may exist that is not one or the other.
 *
 * It also means the dialogue can never go stale or lie. There is no script to maintain
 * against a changing app, because there is no script — there is a thread, and a few ways of
 * reading it out loud.
 */

const HOUR = 36e5
const DAY = 24 * HOUR

/** Rough, human durations. Nobody wants "1.03 days ago" from a person. */
function ago(ts) {
  if (!ts) return 'a while back'
  const d = Date.now() - ts
  if (d < 90 * 6e4) return 'just now'
  if (d < HOUR) return `${Math.round(d / 6e4)} minutes ago`
  if (d < DAY) return `${Math.round(d / HOUR)} hours ago`
  const days = Math.round(d / DAY)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** Transcript size, in words a person would use rather than in bytes. */
function heft(bytes) {
  const kb = (bytes || 0) / 1024
  if (kb < 8) return 'barely started'
  if (kb < 40) return 'a short one'
  if (kb < 200) return 'a decent length'
  if (kb < 800) return 'long — properly long'
  return 'enormous. I have lost track of the beginning'
}

/**
 * How a character describes its own state. First person, present tense, and specific: the
 * status is the one thing the player can already see from the badge over their head, so
 * saying it back adds nothing unless it comes with the detail behind it.
 */
function stateLine(status, thread) {
  switch (status) {
    case 'working':
      return `I am in the middle of something right now. Started ${ago(thread.lastActivityAt)} and still going.`
    case 'waiting':
      return `I am waiting on you, actually. Have been since ${ago(thread.lastActivityAt)}.`
    case 'blocked':
      return 'Something broke. I stopped rather than make it worse.'
    case 'celebrating':
      return 'It landed! The pull request went in. I am still a bit giddy about it.'
    case 'sleeping':
      return `Nothing since ${ago(thread.lastActivityAt)}. I have been asleep, honestly.`
    default:
      return `Nothing pressing. Last thing I did was ${ago(thread.lastActivityAt)}.`
  }
}

/** The topics, each one a question the player can ask and an answer built from the record. */
const TOPICS = {
  doing: {
    label: 'What are you working on?',
    answer: (agent, thread) => {
      const title = thread?.title ? `“${thread.title}”` : 'something I never named'
      const branch = thread?.gitBranch ? ` I am on ${thread.gitBranch}.` : ''
      return `${title}.${branch}`
    },
  },

  going: {
    label: 'How is it going?',
    answer: (agent, thread) => stateLine(agent.status, thread || {}),
  },

  history: {
    label: 'How long have you been at this?',
    answer: (agent, thread) => {
      const runs = thread?.runCount || 1
      const times = runs === 1 ? 'once' : runs === 2 ? 'twice' : `${runs} times`
      const size = heft(thread?.sizeBytes)
      return `You have picked this up ${times}. The transcript is ${size}.`
    },
  },

  who: {
    label: 'Who are you, exactly?',
    answer: (agent, thread) => {
      const model = thread?.model ? ` I am running on ${thread.model}.` : ''
      const tree = thread?.worktree ? ` I live in the ${thread.worktree} worktree.` : ''
      return `${agent.charName}, out of ${agent.theme.name}.${model}${tree}`
    },
  },

  need: {
    label: 'Do you need anything?',
    answer: (agent, thread) => {
      if (agent.status === 'waiting') return 'Yes. Read what I said and tell me which way to go.'
      if (agent.status === 'blocked') return 'A look at the error would help. I cannot get past it on my own.'
      if (agent.status === 'working') return 'Not yet. Ask me again when I stop.'
      return 'Nothing right now. Come back when you have something for me.'
    },
  },
}

/**
 * Which topics a character offers, in order.
 *
 * A thread that wants something puts that first, because it is the one thing the
 * conversation exists to surface; everything else is context you may or may not want.
 */
function topicsFor(agent) {
  const urgent = agent.status === 'waiting' || agent.status === 'blocked'
  const order = urgent ? ['need', 'going', 'doing', 'history'] : ['doing', 'going', 'history', 'who']
  return order
}

export class Dialogue {
  constructor() {
    this.agent = null
    this.thread = null
    this.asked = new Set()
  }

  get open() {
    return Boolean(this.agent)
  }

  /**
   * Begin. The opening line is the character's own — the genre phrase they have always had —
   * because a greeting is the one place personality should lead and data should wait.
   */
  start(agent, thread) {
    this.agent = agent
    this.thread = thread || agent.thread || {}
    this.asked = new Set()
    return {
      name: agent.charName,
      genre: agent.theme.name,
      accent: agent.theme.accent,
      line: voiceFor(agent.id, agent.theme, agent.status),
      options: this._options(),
    }
  }

  /** Answer one topic. Returns the same shape as `start`, so the HUD has one renderer. */
  ask(id) {
    if (!this.agent) return null
    if (id === 'bye') return this.end()
    const topic = TOPICS[id]
    if (!topic) return null
    this.asked.add(id)
    return {
      name: this.agent.charName,
      genre: this.agent.theme.name,
      accent: this.agent.theme.accent,
      line: topic.answer(this.agent, this.thread),
      options: this._options(),
    }
  }

  end() {
    this.agent = null
    this.thread = null
    return null
  }

  /**
   * What is left to ask, plus the two actions worth having.
   *
   * Topics already asked drop off rather than staying and repeating themselves — a list
   * that never shrinks is a menu, and this is supposed to be a conversation that goes
   * somewhere and then ends.
   */
  _options() {
    const out = topicsFor(this.agent)
      .filter((id) => !this.asked.has(id))
      .slice(0, 3)
      .map((id) => ({ id, label: TOPICS[id].label }))
    // Opening the thread is the point of the whole app, so it is always on the list.
    out.push({ id: 'open', label: 'Open this thread', action: true })
    out.push({ id: 'bye', label: 'Goodbye', action: true })
    return out
  }
}
