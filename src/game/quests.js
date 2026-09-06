import { STATUS_LABEL } from './colony.js'

/**
 * Quests, derived entirely from what your threads are actually doing.
 *
 * The temptation with a feature called "quests" is to invent errands — fetch six things,
 * walk to three places — and that would be the one thing this whole project is built to
 * avoid. A world where some of what you see is real and some is busywork is a world where
 * none of it can be trusted, and it stops being a view of your work and becomes a game with
 * your repo names printed on it.
 *
 * So every quest here is a *real* piece of state wearing a quest's clothes. "Somebody is
 * waiting for you" is a thread whose status is `waiting`. "Nobody has answered them" is a
 * thread that has been waiting a long time. "Do the rounds" is the set of repos you have
 * genuinely not walked into yet this session. Complete one and something true has happened:
 * you read the thread that was blocked, or you visited the project you had been ignoring.
 *
 * The ordering matters as much as the list. A thread that needs a reply outranks everything,
 * because that is the one thing this app exists to surface; exploration quests sit at the
 * bottom, because they are the ones that are merely pleasant.
 *
 * Progress is session-local and deliberately not persisted. A quest log that remembered
 * yesterday would need to reason about threads that have since changed status, been
 * archived, or stopped existing — and the honest answer to "what needs you" is always the
 * one computed from the file on disk right now.
 */

/** How long a thread has to have been waiting before it is an *urgent* quest, in hours. */
const STALE_HOURS = 3

/** How many objectives to show at once. More than three and it is a to-do list, not a game. */
const MAX_ACTIVE = 3

const hoursSince = (ts) => (ts ? (Date.now() - ts) / 36e5 : 0)

export class Quests {
  constructor() {
    /** Character ids you have actually talked to this session. */
    this.talkedTo = new Set()
    /** Repo names you have actually stood inside this session. */
    this.visited = new Set()
    /** Thread ids you have opened. */
    this.opened = new Set()
    /** Quest ids already completed, so a finished one does not reappear on the next poll. */
    this.done = new Set()
    /** The last computed list, so the HUD can diff rather than re-render every frame. */
    this.active = []
    this.completedThisTick = []
  }

  /** Walking into a zone counts as visiting it. */
  visit(project) {
    if (project) this.visited.add(project)
  }

  /** Talking to somebody is how most quests are actually finished. */
  talk(agent) {
    if (!agent) return
    this.talkedTo.add(agent.id)
  }

  open(threadId) {
    if (threadId) this.opened.add(threadId)
  }

  /**
   * Recompute the board from the current thread list.
   *
   * Pure in its inputs apart from the three progress sets, so it can be called on every
   * poll without accumulating anything. Returns the quests that *became* complete on this
   * call, so the page can celebrate them exactly once.
   */
  refresh(threads, statusOf, projects) {
    const candidates = []

    // ── somebody is waiting on you ─────────────────────────────────────────────────────
    for (const thread of threads) {
      if (statusOf(thread) !== 'waiting') continue
      const hours = hoursSince(thread.lastActivityAt)
      const stale = hours >= STALE_HOURS
      candidates.push({
        id: `waiting:${thread.id}`,
        kind: 'waiting',
        // Urgency is what sorts the board, and a thread that has been waiting since this
        // morning genuinely is more urgent than one that asked a minute ago.
        priority: stale ? 0 : 1,
        title: stale ? 'Nobody has answered them' : 'Someone is waiting for you',
        detail: thread.title || 'An unnamed conversation',
        where: thread.project,
        threadId: thread.id,
        hint: stale ? `Waiting ${Math.round(hours)}h in ${thread.project}` : `Waiting in ${thread.project}`,
        // Reading it is the point, so either talking to them or opening the thread counts.
        complete: () => this.talkedTo.has(thread.id) || this.opened.has(thread.id),
      })
    }

    // ── something fell over ────────────────────────────────────────────────────────────
    for (const thread of threads) {
      if (statusOf(thread) !== 'blocked') continue
      candidates.push({
        id: `blocked:${thread.id}`,
        kind: 'blocked',
        priority: 0,
        title: 'Something went wrong here',
        detail: thread.title || 'An unnamed conversation',
        where: thread.project,
        threadId: thread.id,
        hint: `Errored in ${thread.project}`,
        complete: () => this.talkedTo.has(thread.id) || this.opened.has(thread.id),
      })
    }

    // ── good news worth collecting ─────────────────────────────────────────────────────
    for (const thread of threads) {
      if (statusOf(thread) !== 'celebrating') continue
      candidates.push({
        id: `cheer:${thread.id}`,
        kind: 'celebrating',
        priority: 2,
        title: 'Go and congratulate them',
        detail: thread.title || 'An unnamed conversation',
        where: thread.project,
        threadId: thread.id,
        hint: `Landed in ${thread.project}`,
        complete: () => this.talkedTo.has(thread.id),
      })
    }

    // ── do the rounds ──────────────────────────────────────────────────────────────────
    // Only worth offering once there is somewhere to go: a colony of two zones does not
    // need a sightseeing quest.
    const unseen = projects.filter((p) => !this.visited.has(p))
    if (projects.length >= 4 && unseen.length) {
      const target = Math.min(projects.length, this.visited.size + Math.min(3, unseen.length))
      candidates.push({
        id: `tour:${target}`,
        kind: 'tour',
        priority: 3,
        title: 'Walk the neighbourhood',
        detail: `Visit ${target} of the ${projects.length} zones`,
        where: unseen[0],
        hint: `${this.visited.size} of ${target} so far — nearest unseen: ${unseen[0]}`,
        progress: [this.visited.size, target],
        complete: () => this.visited.size >= target,
      })
    }

    // ── say hello ──────────────────────────────────────────────────────────────────────
    const target = this.talkedTo.size < 3 ? 3 : this.talkedTo.size + 3
    if (threads.length >= 3) {
      candidates.push({
        id: `greet:${target}`,
        kind: 'greet',
        priority: 4,
        title: 'Meet the cast',
        detail: `Talk to ${target} of them`,
        hint: `${this.talkedTo.size} of ${target} so far — walk up and press E`,
        progress: [this.talkedTo.size, target],
        complete: () => this.talkedTo.size >= target,
      })
    }

    // Anything already finished and celebrated drops out for good.
    const live = candidates.filter((q) => !this.done.has(q.id))

    // Completions are collected before the board is trimmed, or a quest that finished while
    // sitting in fourth place would never be noticed.
    this.completedThisTick = live.filter((q) => q.complete())
    for (const q of this.completedThisTick) this.done.add(q.id)

    live.sort((a, b) => a.priority - b.priority)
    this.active = live.filter((q) => !this.done.has(q.id)).slice(0, MAX_ACTIVE)
    return this.completedThisTick
  }

  /** A one-line label for a completed quest, for the toast. */
  static describe(quest) {
    if (quest.kind === 'tour') return 'Neighbourhood walked'
    if (quest.kind === 'greet') return 'You have met the cast'
    const what = STATUS_LABEL[quest.kind] || quest.kind
    return `${what}: ${quest.detail}`
  }
}
