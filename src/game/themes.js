/**
 * The anime themes, and how a thread gets one.
 *
 * Every chat session is dealt a *style* — not a character from a show, but an anime genre
 * with its own palette, silhouette and voice. Two things follow from that one pick: what
 * the character looks like (hair colour and shape, eye colour, outfit, the thing it carries)
 * and how it talks to you when you walk up to it.
 *
 * The pick is a hash of the session id, never a random draw, so a thread keeps the same
 * character across reloads, across polls, and across the day. Nothing is persisted.
 *
 * Adding a thirteenth genre is a data change: push an entry, and the character builder, the
 * dialogue and the name generator all pick it up. The one rule is that `hair` and `prop`
 * must name shapes the builders know (see `agents/anime-parts.js`) — everything else is
 * free-form colour.
 */

/**
 * Hairstyle ids. Each is its own instanced mesh, so this list is also the draw-call budget
 * for hair: one call per style that is on screen, however many characters wear it.
 */
export const HAIR = {
  spiky: 'spiky',
  twintails: 'twintails',
  long: 'long',
  bob: 'bob',
  topknot: 'topknot',
  undercut: 'undercut',
  ponytail: 'ponytail',
  hime: 'hime',
  braid: 'braid',
  messy: 'messy',
  wild: 'wild',
}

/**
 * The one prop a character carries or wears that says which genre it is at a glance. Like
 * hair, one instanced mesh per kind.
 */
export const PROP = {
  headband: 'headband',
  wand: 'wand',
  visor: 'visor',
  katana: 'katana',
  shades: 'shades',
  satchel: 'satchel',
  cloak: 'cloak',
  mask: 'mask',
  mic: 'mic',
  lantern: 'lantern',
  towel: 'towel',
  ears: 'ears',
  strawhat: 'strawhat',
  scarf: 'scarf',
  book: 'book',
  greatsword: 'greatsword',
}

/**
 * Iris colours sit a little over 1.0 rather than far over it. They are painted onto a lit
 * head now, not onto an unlit screen, so anything much brighter is caught by the bloom pass
 * and both eyes turn into one white blob — which is exactly what the space version wanted
 * from a visor and exactly what an anime face must not do.
 *
 * The genres. `accent` also drives the thread's building, so a zone that happens to be all
 * one genre reads as one place rather than as a colour accident.
 */
/**
 * The casts.
 *
 * Twenty-four of them, each one a recognisable corner of anime — the pirate crew, the wall
 * scouts, the soul reapers, the alchemists, the tournament fighters, the bathhouse spirits.
 * A thread is dealt one by hashing its id, so a chat that was a demon-slaying swordsman
 * yesterday is the same swordsman today, and will be next week.
 *
 * **On the names.** These are described rather than branded: `Grand Line Voyage` instead of
 * a studio's trademark, `Wall Scout Corps` instead of a title. What is being built is an
 * original low-poly character in a recognisable *style* — a straw hat and a red vest, a
 * green hooded cloak and a harness — which is fan-adjacent design rather than a reproduction
 * of anyone's character, and the naming keeps it that way. If you want the real titles in
 * your own copy, every one of them is the `name` field on the line below its id and this is
 * the only file that has to change; nothing else reads these strings.
 *
 * `accent` also drives the thread's building, so a zone that happens to be all one cast
 * reads as one place rather than as a colour accident.
 */
export const THEMES = [
  {
    id: 'strawhat',
    name: 'Grand Line Voyage',
    blurb: 'A pirate crew, a bottomless appetite, and absolutely no navigational skill.',
    hair: HAIR.messy,
    prop: PROP.strawhat,
    hairColor: 0x1f1c1a,
    outfit: 0xd8443c,
    trim: 0xf2c14e,
    eye: [0.9, 0.55, 0.28],
    accent: 0xd8443c,
    voice: ['I am going to be king of this repository!', 'Set sail. We fix the build at sea.', 'Meat first. Merge after.'],
    names: ['Luffy', 'Nami', 'Zoro', 'Usopp', 'Robin', 'Chopper', 'Franky', 'Brook'],
  },
  {
    id: 'wallscout',
    name: 'Wall Scout Corps',
    blurb: 'Green cloaks, gas harnesses, and a survival rate nobody discusses.',
    hair: HAIR.undercut,
    prop: PROP.cloak,
    hairColor: 0x5a4632,
    outfit: 0x4a5240,
    trim: 0x2f6b3f,
    eye: [0.62, 0.9, 0.5],
    accent: 0x2f6b3f,
    voice: ['Something is beyond that wall. Probably a merge conflict.', 'Dedicate your hearts. And your test coverage.', 'Advance. Do not look back at the diff.'],
    names: ['Eren', 'Mikasa', 'Armin', 'Levi', 'Hange', 'Erwin', 'Sasha', 'Jean'],
  },
  {
    id: 'soulreaper',
    name: 'Soul Reaper Division',
    blurb: 'Black robes, an oversized blade, and a great deal of standing dramatically.',
    hair: HAIR.spiky,
    prop: PROP.greatsword,
    hairColor: 0xe8763a,
    outfit: 0x16161c,
    trim: 0xf2f2f2,
    eye: [0.8, 0.62, 0.35],
    accent: 0x6b6f9a,
    voice: ['Release your blade. And your feature branch.', 'I do not protect because I want to win.', 'The captain will hear about this commit.'],
    names: ['Ichigo', 'Rukia', 'Renji', 'Byakuya', 'Toshiro', 'Rangiku', 'Uryu', 'Orihime'],
  },
  {
    id: 'alchemy',
    name: 'State Alchemy Bureau',
    blurb: 'A red coat, a metal arm, and an unhealthy relationship with equivalent exchange.',
    hair: HAIR.braid,
    prop: PROP.book,
    hairColor: 0xf2c14e,
    outfit: 0xc4392b,
    trim: 0x2b2b33,
    eye: [1.05, 0.75, 0.2],
    accent: 0xc4392b,
    voice: ['Equivalent exchange. You get the feature, I get the weekend.', 'Do not call this refactor small.', 'The transmutation circle is basically a build script.'],
    names: ['Edward', 'Alphonse', 'Winry', 'Roy', 'Riza', 'Ling', 'Lan Fan', 'Izumi'],
  },
  {
    id: 'slayer',
    name: 'Demon Slayer Corps',
    blurb: 'Chequered haori, breathing techniques, and a great deal of crying mid-fight.',
    hair: HAIR.wild,
    prop: PROP.katana,
    hairColor: 0x8a3b2a,
    outfit: 0x1f2430,
    trim: 0x3fae8f,
    eye: [1.15, 0.6, 0.35],
    accent: 0x3fae8f,
    voice: ['Total concentration. Constant. Breathing.', 'I will not let this test suite fall.', 'Nezuko is guarding the build.'],
    names: ['Tanjiro', 'Nezuko', 'Zenitsu', 'Inosuke', 'Giyu', 'Shinobu', 'Rengoku', 'Kanao'],
  },
  {
    id: 'jujutsu',
    name: 'Curse Technical College',
    blurb: 'Cursed energy, a blindfold, and an extremely relaxed strongest man alive.',
    hair: HAIR.spiky,
    prop: PROP.shades,
    hairColor: 0xe8eef6,
    outfit: 0x1a1d24,
    trim: 0x4f9ee0,
    eye: [0.35, 1.15, 1.4],
    accent: 0x4f9ee0,
    voice: ['Domain expansion. The scope has grown again.', 'Throughout code and dev, I alone am the reviewed one.', 'That is a special grade bug.'],
    names: ['Yuji', 'Megumi', 'Nobara', 'Gojo', 'Nanami', 'Maki', 'Toge', 'Panda'],
  },
  {
    id: 'heroacademy',
    name: 'Hero Academy',
    blurb: 'Quirks, costumes, and a school that is destroyed roughly once a term.',
    hair: HAIR.messy,
    prop: PROP.visor,
    hairColor: 0x2f6b3f,
    outfit: 0x3a6b4f,
    trim: 0xd94f4f,
    eye: [0.4, 1.1, 0.65],
    accent: 0x3fae63,
    voice: ['Plus ultra! And also, please review my PR.', 'I can be the hero this backlog needs.', 'Smash. Gently. It is production.'],
    names: ['Izuku', 'Ochaco', 'Bakugo', 'Todoroki', 'Tsuyu', 'Iida', 'Momo', 'Kirishima'],
  },
  {
    id: 'ninja',
    name: 'Hidden Leaf Academy',
    blurb: 'Orange tracksuit, a forehead protector, and shouting the name of every technique.',
    hair: HAIR.spiky,
    prop: PROP.headband,
    hairColor: 0xf5c542,
    outfit: 0xf2872e,
    trim: 0x2f6fd0,
    eye: [0.35, 0.85, 1.3],
    accent: 0xf2872e,
    voice: ['Believe it. The tests will pass.', 'Shadow clone the work. Merge one of them.', 'I never go back on my word. That is my ninja way.'],
    names: ['Naruto', 'Sakura', 'Sasuke', 'Kakashi', 'Hinata', 'Shikamaru', 'Rock Lee', 'Gaara'],
  },
  {
    id: 'saiyan',
    name: 'Tournament of Power',
    blurb: 'Orange gi, hair that changes colour under stress, and planets used as furniture.',
    hair: HAIR.wild,
    prop: PROP.headband,
    hairColor: 0xf7e04a,
    outfit: 0xf28a1e,
    trim: 0x2f5fc9,
    eye: [0.45, 0.95, 1.35],
    accent: 0xf28a1e,
    voice: ['My power level on this branch is rising.', 'Give me a senzu and one more sprint.', 'I have been holding back the whole refactor.'],
    names: ['Goku', 'Vegeta', 'Gohan', 'Piccolo', 'Trunks', 'Krillin', 'Bulma', 'Beerus'],
  },
  {
    id: 'hunter',
    name: 'Hunter Examination',
    blurb: 'A green tunic, a fishing rod, and an exam with a mortality rate.',
    hair: HAIR.spiky,
    prop: PROP.satchel,
    hairColor: 0x1f2a1c,
    outfit: 0x3f8a52,
    trim: 0xf2f2f2,
    eye: [0.8, 1.05, 0.4],
    accent: 0x3f8a52,
    voice: ['My nen type suits this problem exactly.', 'The exam has a fourth phase. It is code review.', 'Killua says the deadline is a trap.'],
    names: ['Gon', 'Killua', 'Kurapika', 'Leorio', 'Hisoka', 'Biscuit', 'Meruem', 'Netero'],
  },
  {
    id: 'devilhunter',
    name: 'Public Safety Devil Hunters',
    blurb: 'A chainsaw, a dog, and a young man with extremely modest ambitions.',
    hair: HAIR.messy,
    prop: PROP.greatsword,
    hairColor: 0xc4622e,
    outfit: 0x2a2a30,
    trim: 0xd94f4f,
    eye: [1.2, 0.45, 0.4],
    accent: 0xd94f4f,
    voice: ['I just want to fix this and eat some bread.', 'Pull the cord. Ship it.', 'The contract says I own the merge rights.'],
    names: ['Denji', 'Power', 'Aki', 'Makima', 'Himeno', 'Kobeni', 'Angel', 'Pochita'],
  },
  {
    id: 'titanmecha',
    name: 'Evangelion Cage',
    blurb: 'A plugsuit, a countdown, and a truly enormous amount of unresolved parental issues.',
    hair: HAIR.undercut,
    prop: PROP.visor,
    hairColor: 0x2b3550,
    outfit: 0xf2f4f8,
    trim: 0xd93a3a,
    eye: [0.3, 1.0, 1.45],
    accent: 0xd93a3a,
    voice: ['Synchronisation at eighty-nine percent.', 'I mustn\'t run away. From the code review.', 'Launching. Do not touch the config.'],
    names: ['Shinji', 'Asuka', 'Rei', 'Misato', 'Kaworu', 'Mari', 'Ritsuko', 'Gendo'],
  },
  {
    id: 'bathhouse',
    name: 'The Spirit Bathhouse',
    blurb: 'Do not eat anything, do not forget your name, and mind the river spirit.',
    hair: HAIR.ponytail,
    prop: PROP.lantern,
    hairColor: 0x3a2a24,
    outfit: 0xd94f6b,
    trim: 0xf2e0c0,
    eye: [0.75, 0.62, 0.5],
    accent: 0xd94f6b,
    voice: ['Work hard and they cannot turn you into a pig.', 'Once you do a thing, you never truly forget it.', 'The boiler room takes anyone who asks.'],
    names: ['Chihiro', 'Haku', 'Lin', 'Kamaji', 'Yubaba', 'No-Face', 'Boh', 'Zeniba'],
  },
  {
    id: 'skycastle',
    name: 'The Sky Castle',
    blurb: 'Airships, a crystal on a string, and a great deal of running along a roof.',
    hair: HAIR.twintails,
    prop: PROP.satchel,
    hairColor: 0x3a2a1c,
    outfit: 0xd94f4f,
    trim: 0x4f9ee0,
    eye: [0.55, 0.9, 1.15],
    accent: 0x4f9ee0,
    voice: ['The stone is glowing. That usually means a rebase.', 'Take root in the ground, live in harmony with the wind.', 'Hold on! I have the branch!'],
    names: ['Pazu', 'Sheeta', 'Dola', 'Muska', 'Uncle Pom', 'Charles', 'Louis', 'Henri'],
  },
  {
    id: 'notebook',
    name: 'The Notebook Case',
    blurb: 'A very clever boy, a very clever detective, and an obscene amount of monologue.',
    hair: HAIR.bob,
    prop: PROP.book,
    hairColor: 0x3a2f28,
    outfit: 0x1f2028,
    trim: 0xb03040,
    eye: [1.15, 0.35, 0.4],
    accent: 0xb03040,
    voice: ['Just as planned.', 'I have already written the outcome of this sprint.', 'The detective knows. Delete the branch.'],
    names: ['Light', 'L', 'Misa', 'Near', 'Mello', 'Ryuk', 'Rem', 'Watari'],
  },
  {
    id: 'bebop',
    name: 'The Bebop Freighter',
    blurb: 'Bounty hunting, jazz, and a fridge containing precisely one bell pepper.',
    hair: HAIR.messy,
    prop: PROP.shades,
    hairColor: 0x2f3a4a,
    outfit: 0x3f5a6b,
    trim: 0xf2c14e,
    eye: [0.85, 0.7, 0.5],
    accent: 0x3f5a6b,
    voice: ['Whatever happens, happens.', 'You are gonna carry that technical debt.', 'See you, space cowboy.'],
    names: ['Spike', 'Jet', 'Faye', 'Ed', 'Ein', 'Vicious', 'Julia', 'Lin'],
  },
  {
    id: 'slime',
    name: 'The Slime Nation',
    blurb: 'A salaryman reincarnated as a blob who is now, inexplicably, a head of state.',
    hair: HAIR.long,
    prop: PROP.cloak,
    hairColor: 0x6fc9e0,
    outfit: 0x2f6b7a,
    trim: 0xf2c14e,
    eye: [0.4, 1.05, 1.25],
    accent: 0x3fa8c9,
    voice: ['I have analysed and absorbed this codebase.', 'Great Sage says the deadline is optimistic.', 'I was a backend developer in my last world.'],
    names: ['Rimuru', 'Benimaru', 'Shuna', 'Souei', 'Shion', 'Gobta', 'Ranga', 'Milim'],
  },
  {
    id: 'monstertrainer',
    name: 'The Monster League',
    blurb: 'A red cap, six companions, and a decade-long refusal to go home.',
    hair: HAIR.messy,
    prop: PROP.headband,
    hairColor: 0x2b2b33,
    outfit: 0x3f6bd0,
    trim: 0xd94f4f,
    eye: [0.9, 0.6, 0.35],
    accent: 0xd94f4f,
    voice: ['I choose this branch!', 'It is super effective against the bug.', 'One more gym badge and we ship.'],
    names: ['Ash', 'Misty', 'Brock', 'Dawn', 'Serena', 'Gary', 'May', 'Iris'],
  },
  {
    id: 'sailor',
    name: 'Moonlight Guardians',
    blurb: 'Sailor collars, transformation sequences, and punishment in the name of the moon.',
    hair: HAIR.twintails,
    prop: PROP.wand,
    hairColor: 0xf7e04a,
    outfit: 0xf2f4fa,
    trim: 0xd94f8b,
    eye: [0.5, 0.85, 1.35],
    accent: 0xd94f8b,
    voice: ['In the name of clean code, I will punish you.', 'Moon prism power. Make up. Deploy.', 'This refactor is powered by friendship.'],
    names: ['Usagi', 'Ami', 'Rei', 'Makoto', 'Minako', 'Chibiusa', 'Setsuna', 'Hotaru'],
  },
  {
    id: 'idol',
    name: 'School Idol Club',
    blurb: 'Nine members, one stage, and a schedule that would kill a normal person.',
    hair: HAIR.twintails,
    prop: PROP.mic,
    hairColor: 0x8ec5ff,
    outfit: 0xfff6fb,
    trim: 0xffb3d9,
    eye: [1.35, 0.9, 1.2],
    accent: 0xffb3d9,
    voice: ['One more take and it is perfect!', 'Everyone, please look at this pull request!', 'Encore? For you, of course.'],
    names: ['Honoka', 'Kotori', 'Umi', 'Maki', 'Nico', 'Eli', 'Nozomi', 'Hanayo'],
  },
  {
    id: 'volley',
    name: 'Karasuno Gymnasium',
    blurb: 'A very short boy, a very tall net, and a flashback mid-jump.',
    hair: HAIR.spiky,
    prop: PROP.towel,
    hairColor: 0xf2872e,
    outfit: 0x2b2b33,
    trim: 0xf2a83f,
    eye: [1.1, 0.75, 0.3],
    accent: 0xf2a83f,
    voice: ['One more set! One more!', 'Toss it to me. I will take the ticket.', 'We are going to nationals with this branch.'],
    names: ['Hinata', 'Kageyama', 'Daichi', 'Sugawara', 'Tsukishima', 'Nishinoya', 'Asahi', 'Tanaka'],
  },
  {
    id: 'samurai',
    name: 'Meiji Wanderer',
    blurb: 'A reversed blade, a cross-shaped scar, and a vow never to kill again.',
    hair: HAIR.ponytail,
    prop: PROP.katana,
    hairColor: 0xc4392b,
    outfit: 0xd94f6b,
    trim: 0x2c3e6b,
    eye: [0.65, 0.95, 0.55],
    accent: 0xc4392b,
    voice: ['This blade is reversed. It only refactors.', 'One cut. One commit.', 'That, I will not do again.'],
    names: ['Kenshin', 'Kaoru', 'Sanosuke', 'Yahiko', 'Saito', 'Megumi', 'Aoshi', 'Misao'],
  },
  {
    id: 'chibicafe',
    name: 'The Cat Café',
    blurb: 'Warm brown, cat ears, and a suspiciously large mug.',
    hair: HAIR.bob,
    prop: PROP.ears,
    hairColor: 0x8a5a3c,
    outfit: 0xffe6c9,
    trim: 0xe08a5a,
    eye: [1.1, 0.8, 0.5],
    accent: 0xe08a5a,
    voice: ['Welcome back!', 'One refactor, extra foam.', 'The build is warm. Come and sit.'],
    names: ['Mocha', 'Latte', 'Anzu', 'Momo', 'Tama', 'Coco', 'Nana', 'Puri'],
  },
  {
    id: 'sliceoflife',
    name: 'The Afternoon Club',
    blurb: 'Cream walls, low sunlight, and nothing much happening. That is the point.',
    hair: HAIR.hime,
    prop: PROP.satchel,
    hairColor: 0x3a2f28,
    outfit: 0xf6f1e6,
    trim: 0x7fb3d5,
    eye: [0.6, 0.85, 1.0],
    accent: 0x7fb3d5,
    voice: ['I made too much lunch. Want some?', 'It is a nice day for a small refactor.', 'Mm. Let us not rush this one.'],
    names: ['Yui', 'Hana', 'Nao', 'Chika', 'Miku', 'Tsumugi', 'Aoi', 'Kotone'],
  },
]

export const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]))

/** FNV-1a. Small, stable across runs, and good enough to spread ids over twelve buckets. */
export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The theme for a session. Deterministic in the id alone, so the same chat is the same
 * character every time you open the page.
 */
export function themeFor(sessionId) {
  return THEMES[hashString(String(sessionId)) % THEMES.length]
}

/**
 * A character name for a session, drawn from its own theme's pool. The salt keeps the name
 * from correlating with the theme pick — otherwise every shonen thread would be Haruki.
 */
export function nameFor(sessionId, theme = themeFor(sessionId)) {
  const h = hashString('name:' + sessionId)
  const first = theme.names[h % theme.names.length]
  // A one-in-eight chance of a suffix, so a crowded zone does not read as clones.
  const suffix = ['', '', '', '', '-kun', '-chan', '-san', '-senpai'][(h >>> 8) % 8]
  return first + suffix
}

/** One of the theme's lines. `salt` varies it without losing determinism. */
export function voiceFor(sessionId, theme = themeFor(sessionId), salt = 0) {
  const h = hashString('voice:' + sessionId + ':' + salt)
  return theme.voice[h % theme.voice.length]
}
