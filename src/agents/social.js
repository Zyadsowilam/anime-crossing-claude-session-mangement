/**
 * Characters noticing each other.
 *
 * A crowd where everybody pointedly ignores everybody else reads as a screensaver, however
 * well each individual is animated — the giveaway is that nothing on screen is *about*
 * anything else. Two characters turning to face each other fixes that for almost no cost,
 * and it is the cheapest life available once a crowd already exists.
 *
 * The rule this file lives by is the same one the quest board lives by: **nothing here may
 * invent a relationship.** Every pairing is drawn from something true about the threads.
 *
 * - Two characters chat only if their threads are **in the same repo**. Colleagues talk;
 *   strangers from different projects walk past each other.
 * - A **celebrating** thread draws a small crowd, because a merged pull request is the one
 *   piece of news in this world worth crossing a plot for.
 * - A **blocked** thread gets exactly one character coming over to look, which reads as
 *   concern rather than as a party.
 * - A **working** thread gets one character who wanders over to watch it hammer, which is
 *   the ambient version of the same idea: something is happening at that site right now.
 * - Anything **waiting on you** is left strictly alone. It is holding a `?` over its head
 *   and standing still on purpose, and a neighbour wandering over to chat is the one thing
 *   that would make that signal harder to see.
 *
 * Everything is time-boxed. A conversation that never ends is two characters frozen facing
 * each other, which looks worse than no conversation at all.
 */

/**
 * How close two characters have to be before they will strike up a conversation.
 *
 * Sized against how far apart colleagues actually stand, which changed completely when a
 * repo stopped being one small deck and became a district. Characters wait at their own
 * building's door, and those doors are now dealt down a thirty-unit avenue instead of
 * clustered on an eleven-unit platform — measured over a live colony, the median distance
 * from a character to its nearest same-repo neighbour is **11 units**. At the old 6.5 almost
 * no pair in the colony was ever eligible, and the answer to "why does nobody talk to each
 * other" was that the constant had been left behind by the map.
 *
 * Comfortably past that median, so next door and across the street both count, and still
 * short enough that a conversation is with somebody you are plainly standing near rather
 * than shouted down the length of the high street.
 */
const CHAT_RANGE = 13
/** How close a spectator tries to get to whatever it walked over to look at. */
const WATCH_RANGE = 2.6
/** Conversations last somewhere in this range, in seconds. */
const CHAT_MIN = 5
const CHAT_MAX = 13
/** Spectating lasts longer — the news is the point, not the company. */
const WATCH_SECONDS = 9
/** How often the whole crowd is reconsidered. Twice a second is far more than enough. */
const TICK = 0.5
/** At most this many spectators per celebration, so a merge does not empty the colony. */
const MAX_AUDIENCE = 3

/** Only these are free to socialise. Everything else is busy, asleep, or asking for you. */
const AVAILABLE = new Set(['idle'])

export class Social {
  constructor() {
    this._next = 0
  }

  /**
   * @param agents the whole crew
   * @param dt seconds since the last frame
   * @param elapsed seconds since boot, used for the timers
   */
  update(agents, dt, elapsed) {
    // Expire whatever is running, every frame — a partner that has walked off, been
    // archived or started working has to release its other half immediately, or that half
    // stands there facing an empty patch of deck.
    for (const agent of agents) {
      if (!agent.social) continue
      const partner = agent.social.with
      const gone =
        elapsed > agent.social.until ||
        !partner ||
        partner.state === 'gone' ||
        (agent.social.kind === 'chat' && !AVAILABLE.has(partner.status)) ||
        !AVAILABLE.has(agent.status) ||
        this._far(agent, partner, agent.social.kind === 'chat' ? CHAT_RANGE * 1.6 : 14)
      if (gone) this._end(agent)
    }

    if (elapsed < this._next) return
    this._next = elapsed + TICK

    this._formChats(agents, elapsed)
    this._gather(agents, elapsed)
  }

  /** Pair up colleagues who happen to be standing near each other with nothing to do. */
  _formChats(agents, elapsed) {
    for (const a of agents) {
      if (!this._free(a)) continue
      // A quarter of the eligible pairs per tick, so a plot fills with conversation over a
      // few seconds rather than every character on it turning at the same instant.
      if (Math.random() > 0.25) continue
      const project = a.thread?.project
      if (!project) continue

      let best = null
      let bestD = CHAT_RANGE
      for (const b of agents) {
        if (b === a || !this._free(b)) continue
        if (b.thread?.project !== project) continue
        const d = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z)
        if (d < bestD) {
          bestD = d
          best = b
        }
      }
      if (!best) continue

      const until = elapsed + CHAT_MIN + Math.random() * (CHAT_MAX - CHAT_MIN)
      a.social = { kind: 'chat', with: best, until, talker: true }
      best.social = { kind: 'chat', with: a, until, talker: false }
    }
  }

  /**
   * Send a few neighbours over to whatever just happened.
   *
   * Deliberately one-directional: the character being watched is never given a `social` of
   * its own, because it is busy celebrating or stuck, and turning it to face its audience
   * would stop it doing the thing they came to see.
   */
  _gather(agents, elapsed) {
    for (const focus of agents) {
      const news =
        focus.status === 'celebrating'
          ? 'cheer'
          : focus.status === 'blocked'
            ? 'concern'
            : focus.status === 'working'
              ? 'watch'
              : null
      if (!news) continue
      // A merge is news worth a crowd; a build in progress and a broken thread each rate
      // exactly one onlooker, which reads as interest rather than as a spectacle.
      const wanted = news === 'cheer' ? MAX_AUDIENCE : 1

      let audience = 0
      for (const a of agents) {
        if (a.social?.with === focus) audience++
      }
      if (audience >= wanted) continue

      for (const a of agents) {
        if (audience >= wanted) break
        if (!this._free(a) || a === focus) continue
        // Only from the same repo. A stranger crossing the whole map to applaud somebody
        // else's merge is a nice image and a lie about how these threads relate.
        if (a.thread?.project !== focus.thread?.project) continue
        if (this._far(a, focus, 13)) continue
        a.social = { kind: news, with: focus, until: elapsed + WATCH_SECONDS, talker: false }
        audience++
      }
    }
  }

  _free(agent) {
    return (
      !agent.social &&
      !agent.player &&
      agent.state === 'at-site' &&
      AVAILABLE.has(agent.status) &&
      agent.scale > 0.9
    )
  }

  _far(a, b, range) {
    return Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) > range
  }

  _end(agent) {
    const partner = agent.social?.with
    agent.social = null
    // Release the other half too, but only if it was pointed back at this one — a spectator
    // dropping out must not end the celebration for everybody else.
    if (partner?.social?.with === agent) partner.social = null
  }

  /**
   * Where a socialising character wants to stand and look, or null if it is not.
   *
   * Returned rather than applied, so the movement code stays the only thing that writes to
   * an agent's position — two places moving the same character is how a crowd starts
   * vibrating.
   */
  static intent(agent) {
    const social = agent.social
    if (!social?.with) return null
    const target = social.with.pos
    const d = Math.hypot(target.x - agent.pos.x, target.z - agent.pos.z)
    return {
      look: target,
      // Chatting characters have already arrived; spectators still have to walk over.
      approach: social.kind === 'chat' ? false : d > WATCH_RANGE,
      // Watching and worrying both look like standing still and looking; only a
      // celebration and a conversation have a gesture of their own.
      clip: social.kind === 'cheer' ? 'cheer' : social.kind === 'chat' ? 'wave' : 'idle',
    }
  }
}
