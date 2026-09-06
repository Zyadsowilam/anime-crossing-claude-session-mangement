# Anime Crossing — the concept

A fork of [Bot Crossing](../bot-crossing) that keeps its whole architecture and replaces its
setting. The original is a space colony you look down on. This is an anime world you stand
in.

## 1. Every thread is a character from a cast

Each coding-agent session is dealt one of **twenty-four casts** — a pirate crew, the wall
scouts, a soul reaper division, a demon slayer corps, an alchemy bureau, a hero academy, a
spirit bathhouse, a jazz-scored bounty freighter. The cast decides hair shape and colour, eye
colour, outfit, the prop the character carries, the name they are given, and the lines they
say when you talk to them.

The pick is `hash(sessionId) % 24`, never a random draw. That matters more than it sounds: it
means the same chat is the same character every time you open the page, on every reload, with
**nothing persisted anywhere** to make it true. You come to recognise a thread by its face the
way you would recognise a colleague.

**On the naming.** The casts are described rather than branded — `Grand Line Voyage`,
`Wall Scout Corps`, `Hidden Leaf Academy` — and the characters are original low-poly designs
in a recognisable *style* rather than reproductions of anyone's character. If you want the
real titles in your own copy, they are the `name` field of each entry in
[`src/game/themes.js`](src/game/themes.js) and that is the only file that has to change;
nothing else reads those strings.

## 2. The world is an anime world, not a repainted moon

Six presets, cycled with `G`: **Hanami Hills** (blossom season, the default), **Neo-Akihabara**,
**The Spirit Realm**, **Summer Festival**, **Skyward Isles**, **The Winter Arc**. Terrain, sky,
fog, sun, ambient and foliage all come from one data table in
[`src/world/planet.js`](src/world/planet.js).

Three things carried more of the "this is science fiction" feeling than the sky did, and all
three were replaced:

- **The lander became a torii gate.** It sits at the centre of the map with everything
  arranged around it, so it was the single most load-bearing object in the scene. A gate also
  carries the meaning the object already needed: a threshold that threads arrive through and
  leave through. Pillars lean inward, the top rail sweeps up at the ends, and there is a
  strut between the rails — get those three wrong and it is a rugby post.
- **The bolted steel decks became boardwalk.** A zone is a large flat field of one texture,
  so whatever that texture is made of is what the world is made of. Planks with visible grain
  read as a shrine veranda or a festival stage depending only on the stain over them.
- **The space-base buildings became a hidden village.** Procedural, because there is no
  anime building pack to load — and it suits the subject: Japanese vernacular architecture
  is unusually composable, so a townhouse, a teahouse, a storehouse, a dojo, a pagoda, a
  shrine and the round village tower are different arrangements of four functions (framed
  wall, tiled roof, veranda, curtain) rather than seven models. The roof does nearly all the
  work: shallow pitch, deep eaves, and a *concave* slope so the line dips before the eave.
  See [`src/world/village.js`](src/world/village.js).
- **The cargo containers became festival props** — lantern posts, nobori banners, stalls, sake
  barrels, stone lanterns, wayside torii. This is the layer that does the most work per
  triangle in the fork, because walk mode is the default: most of the time you are at ground
  level, and what fills that view is whatever stands at eye height a few metres away.

## 3. Zones are places you travel to

The lattice used to tile exactly — every zone shared an edge with its neighbours and the
colony was one continuous floor. That is right when you are looking *down* at it and wrong
the moment you are walking, because arriving somewhere means nothing when you were already
there.

The lattice is now half again as wide as the deck standing in it, so there is real ground
between repos, and every zone is ringed by its own copse tinted from its own accent colour.
Walk from a repo ringed in deep green into one ringed in rust and you have unmistakably
arrived somewhere, before any label is involved. Roughly a third of each ring is left open
so a copse is a landmark rather than a wall, and every trunk goes into the navigation grid
so the crew paths between them.

## 4. Six worlds, six sets of architecture, six kinds of weather

A world preset now carries three things rather than one: its palette, **which buildings it
may put up**, and **what falls out of its sky**.

| World | Architecture | Weather |
| --- | --- | --- |
| Hanami Hills | Plaster townhouses, slate hip roofs, pagodas, shrines | Blossom |
| Summer Festival | The same village, warmer, more shopfronts | Rising embers |
| The Spirit Realm | Mostly shrines and pagodas, verdigris and moss | Spirit lights, rising |
| Neo-Akihabara | Concrete block towers, arcades, lit window grids | Hard vertical rain |
| Skyward Isles | White stucco cottages, steep terracotta, chimneys | Seed fluff |
| The Winter Arc | Dark timber under snow-white roofs | Snow |

The mechanism is small on purpose. Every part in `village.js` is painted with one of a dozen
*named* colours, so a style is a **remap of those names** plus a list of allowed building
kinds — six architectures for six palettes and six lists, not six sets of models. The kind
list does more work than the palette: recolouring alone gives the same village in different
paint, and it is swapping a pagoda for a concrete block, or a deep-eaved hip roof for a steep
gable with no overhang, that makes two worlds read as two places.

Changing world rebuilds the buildings, because the geometry is baked per world. A given chat
keeps *its* building through the change — the same house in Hanami Hills is the same cottage
in Skyward Isles, in the same slot, every time.

## 5. Sound, and the feel of moving

**The first version was a motor**, and the reason is worth keeping: it band-passed noise at
420 Hz with a low Q and held the gain constant. Constant + low + faintly pitched is how you
synthesise an engine, and no amount of slow filter wobble argues the ear out of it. It is
now high (around 1.5 kHz, where leaves are), very wide (Q 0.28, so there is no pitch in it at
all), and driven by **gusts** — a new target every few seconds, two thirds of them near
silence, because the quiet between gusts is what the gusts are heard against. The constant
three-oscillator drone underneath it is gone entirely, replaced by a single soft pentatonic
note every several seconds with a slow attack and a long decay. Master level halved.

**Everything is synthesised, nothing is loaded.** No audio files: a wind loop would be tens of
megabytes on a page whose point is that it opens instantly off your own disk, and a loop is
audible as a loop within a minute. Filtered noise never repeats, and each world moves one
filter frequency to get its own bed — rain sits high and bright, a spirit realm low and
hollow, snow almost silent.

Four sounds, and only four: a wind bed that thickens as you move, footsteps driven from the
walk cycle so they land on the feet, a chime for arriving somewhere and for being spoken to,
and **one bell** for a thread that has just started waiting on you — the only event in this
world worth interrupting anybody for, and it rings on the *transition* only. `M` mutes.

Movement got two things that cost nothing and change everything in first person: **head bob**
driven from the character's own stride phase — so the eye drops on the same frame the foot
lands and the footstep fires, three systems agreeing on one number — and **a field-of-view
kick** when running, 38° to 43°, easing back as you stop.

## 6. Every repo is a town, and the map is a country

A zone used to be a hex deck with seven buildings on it. It is now a **town**: a main street
of thread-buildings, two back streets behind each row, a cross street joining them at the
top, and roads out to the countryside.

The density comes from **scenery** — buildings on the back streets with nobody in them, no
doors that open, no badges and no characters. That is allowed by the project's own rule
(*"make it scenery and put it somewhere the data never goes"*) and it is the only way this
could work: the buildings that carry meaning are threads, and there are only ever as many of
those as you have conversations open. Seven buildings is not a town at any spacing. Forty is,
and thirty-three of them are set dressing that is impossible to mistake for data because none
of them does anything.

They cost almost nothing. Every thread's building is its own object because each has its own
growth, its own roof that lifts and its own room; scenery has none of that, so a whole town's
worth merges into **one draw call**. Adding thirty-odd buildings per town left the frame at
260 draw calls and 2.0M triangles — where it already was.

Scenery is also built a little smaller than the real thing, so the main street stays the
tallest part of the skyline and the eye goes to the buildings that mean something.

**The world grew with the towns.** The lattice went from 11 units a cell to 17 and the deck
from 7.5 to 11.2, so the colony now reaches past 120 units instead of 70 — which meant
widening the navigation grid to match (undersized, the outer towns fall off the edge of it
and nobody who lives there can move), pushing the fog out by more than double, and doubling
how far the map view can pull back. Crossing the whole country on foot is now a real trip,
and about twelve seconds on the cat.

## 7. Making it feel big

Scale and *size* are different problems. The map was already 176 units across; it did not
feel it, and doubling it again would only have made the same picture take longer to cross.
Four things did the work instead, and none of them is a bigger number:

**Mountains on the horizon.** A world with nothing beyond it has no scale — however far the
ground runs, if it fades into fog then the fog *is* the edge and you can feel it. Three rings
of low-poly ridges at 260, 400 and 560 units, each fainter and bluer than the last. That
fading is aerial perspective, which is how the eye actually judges outdoor distance, and it
does more than the geometry does. Unlit, unfogged, three draw calls.

**Ground that rolls.** The colony floor was held nearly flat, which was sensible — everything
has to stand on it — and was the single biggest thing keeping the world small. A flat plane
has no horizon of its own: from anywhere on it you see everywhere else, so nothing is left to
discover. There is now a very low-frequency swell across the whole country, one rise every
eighty units or so: enough to put a town out of sight behind a crest, not enough to make
walking between two of them mountaineering. Towns now sit anywhere from −4 to +1 and you
crest a rise to find one.

Making that work meant towns standing at *their own* height with a much deeper skirt under
the deck (a town on a slope was otherwise a platform hovering over a hillside), and the
runtime height sampler matching the baked mesh term for term — if those two disagree, the
whole colony ends up underground.

**A spire per town.** Rooftops all of a height read as texture from any distance and give you
nothing to steer by. The building at the head of every main street is always a tower or a
pagoda, chosen by the *slot* rather than by the thread, so which conversation lands there
never changes the skyline. It is what you see first over a rise and what you walk toward.

**A wider lens on the ground.** The map view's 38° is right for looking down at a model on a
table. At head height the same lens compresses distance until a valley reads as a courtyard.
Walk mode now uses 55°, which costs nothing and makes the same ground feel twice as far
across.

## 8. The street itself

Buildings used to sit one in the middle of a cell and six evenly around it — the obvious way
to fit seven things on a hexagon, and from the ground it reads as seven objects on a
platform. Nothing faces anything, there is no route through, and nothing has a front.

Now each cell is a **street**: three buildings a side facing each other across a dirt road
with stepping stones down it, a seventh closing the far end, lanterns at even intervals down
both kerbs, and stalls and banners filling the gaps between frontages. Every building is
turned to face the road — the slot decides the yaw, with a couple of degrees of slop so the
row is built rather than stamped. Every cell's street runs on the same axis, so a multi-cell
zone is one long thoroughfare.

Houses vary by **silhouette** rather than by size: one or two storeys, an optional lean-to,
a balcony on the upper floor, roof ridge running either way, eaves at different depths, and
tiles drawn from a narrow range of firings. Varying width and height alone — which is what
the first version did — is invisible, because those are the things the eye is worst at
comparing side by side.

## 9. Inside the buildings

Press `E` at a doorway and the roof lifts off. Inside is one room, and everything in it is a
reading of the thread that lives there: the **stack of scrolls** is as tall as the transcript
is long, the **desk lamp** is lit only while the thread is running, and the **wall scroll**
carries the zone's colour. The resident walks home and sits down in it, because it is their
house.

It is a doll's house rather than a doorway you step through, and that was forced by
arithmetic. The village is built at doll's-house scale so the map reads from above: a room
comes out about 1.4 units tall against a character 1.25 tall, so walking in first-person puts
the camera in the ceiling with a wall filling the frame. Building the interior *larger* than
the shell — the usual trick — fails here because the shell is solid and visible from outside,
so you end up standing in a field beside the little house you are supposedly inside. So the
lid comes off, the shell's walls stand down, the room brings three walls of its own, and the
camera rises to look in.

Three attempts, and each failure is preserved in a comment where the next person will hit it:
the interior sharing the shell's shader and being deleted by the shell's own discard rule;
the room's double-sided front wall filling the frame; the lifted roof going on shadowing the
room it came off.

## 10. Conversations, read off the thread

`E` at a person opens a conversation with replies on `1`–`3`. You can ask what they are
working on, how it is going, how long they have been at it, who they are, and whether they
need anything — and every answer is assembled from the thread record:

| You ask | They answer from |
| --- | --- |
| What are you working on? | The thread title and its git branch |
| How is it going? | Its status, and how long since it last ran |
| How long have you been at this? | Run count, and transcript size in plain words |
| Who are you? | Model, worktree, and their own cast |
| Do you need anything? | Whether it is waiting, blocked, or busy |

**The facts are the thread's, the voice is the character's**, and no line exists that is not
one or the other. There is no script to keep in step with the app, because there is no
script — there is a thread and a few ways of reading it out loud. Walk more than five metres
away and the conversation ends on its own.

## 11. Roads, and something to ride

Zones are joined by a **minimum spanning tree** over their centres — the shortest set of
roads that still connects everywhere, which produces a trunk with spurs rather than a
spider's web, and gives every pair of zones exactly one route so "follow the road" is a
complete instruction. Flagstones are laid on the terrain's own height with a lantern every
few metres, so a road at night is a line of lights. The gate is on the network too.

Roads are deliberately **not** in the navigation grid: a road is a suggestion, not a
corridor, and walking off one to cut across the grass has to stay possible.

`R` summons a large cat. It moves at about 1.7 times a sprint — enough to turn a
thirty-second crossing into twelve seconds, which is still a journey and no longer a commute.
It is drawn *at* the player rather than simulated separately, because the player is the thing
with collision and a position everything else already agrees on; its legs cycle from the
distance actually travelled, in diagonal pairs, which is the difference between an animal and
a prop being dragged along.

## 12. Characters notice each other

A crowd where everybody ignores everybody else reads as a screensaver: nothing on screen is
*about* anything else. So characters pair off — but under the same rule the quest board
lives by, that **nothing may invent a relationship**:

| What you see | What it actually is |
| --- | --- |
| Two characters turn and talk | Two threads **in the same repo**, both idle, standing near each other |
| A small crowd gathers | A thread whose pull request **merged** |
| One character comes over to look | A thread that is **blocked** |
| Someone stops to watch | A thread that is **running right now** |
| Nobody approaches them | The thread is **waiting on you** — it is holding a `?` up and must stay easy to see |

Everything is time-boxed, because a conversation that never ends is two characters frozen
facing each other. See [`src/agents/social.js`](src/agents/social.js).

## 13. You are down there with them

Walk mode is the default. WASD to walk, Shift to run, **E** to talk, **V** to drop into first
person, **Tab** to step back out to the overhead map.

- **Clicking is travelling.** Clicking a repo or a thread in the sidebar walks *you* there
  rather than flying the camera. Above the map it still flies. One behaviour, both modes.
- **Zones announce themselves.** Walking onto a repo's deck names it, the way a game names a
  region, and says how many conversations live there.
- **Quests, and all of them are real.** See below.

The player is not a separate system. It is an ordinary member of the crew whose velocity
comes from the keyboard instead of from the state machine, and the follow camera is the
existing camera rig with its target pinned.

## 14. Quests that cannot lie

The temptation with a feature called "quests" is to invent errands, and that is the one thing
this project is built to avoid: a world where some of what you see is real and some is
busywork is a world where none of it can be trusted.

So every quest is a real piece of state wearing a quest's clothes.

| Quest | What it actually is |
| --- | --- |
| Someone is waiting for you | A thread whose status is `waiting` |
| Nobody has answered them | …and it has been waiting over three hours |
| Something went wrong here | A thread whose status is `blocked` |
| Go and congratulate them | A thread whose status is `celebrating` |
| Walk the neighbourhood | Repos you have genuinely not stood inside this session |
| Meet the cast | Characters you have genuinely talked to |

Completing one means something true happened: you read the thread that was stuck, or you
visited the project you had been ignoring. Progress is session-local and deliberately not
persisted — the honest answer to "what needs you" is always the one computed from disk now.

See [`src/game/quests.js`](src/game/quests.js).

## The mapping

| In the world | In your threads |
| --- | --- |
| One hex zone | One repo |
| One character + one building | One session |
| Which cast a character is from | A hash of that session's id — stable forever |
| How finished a building looks | How large its transcript is, on a log scale |
| The spirit orb at their shoulder | What the thread is doing right now |
| The badge over their head | The thread wants a reply from you |
| Walking out through the gate | A thread that just appeared |
| Walking back through it | You archived it |

**Status lives on the orb and the badge, never on the character.** The outfit belongs to the
cast, and repainting it by status would erase the one thing that says *which chat* this is.

## What was genuinely hard, and how it is handled

**Hundreds of characters, one draw call each for what they wear.** The body is one instanced
GPU-skinned mesh, inherited unchanged. Hair and props are one `InstancedMesh` per *style*,
with per-frame instance counters, so twenty characters wearing twintails cost one draw call
and styles nobody wears cost nothing. Eleven hairstyles, sixteen props.

**Anime eyes need three layers, not one.** The original drew faces as a single-channel mask
tinted by one colour — right for a glowing visor, useless for an eye, which is a dark outline
around a saturated iris around a white catchlight. The atlas is a three-channel mask
(ink / iris / highlight) with the channels kept **mutually exclusive**, composited in paint
order in the fragment shader. Getting that last part wrong is instructive: leave the sclera
filled underneath the iris and the highlight layer, applied last, paints the whole eye white.

**Recolouring one pack of green trees six ways.** A tint is a multiply, so pink over green is
olive. The scatter shader collapses the atlas most of the way to its own luminance first,
turning it into a shading map that surrenders its hue to the world preset. One line, and the
difference between six worlds and six worlds that are all green.

**A follow camera lives inside the scenery unless you stop it.** The boom marches out and
stops at the first thing that would block the view, testing a *camera-only* occluder list of
buildings and the gate — not the navigation grid, which also contains crates, boulders and
lampposts, none of which hide a character.

**The crowd will pin you.** Seventy characters at the gate sum into a wall of separation
forces; at full strength the player travelled fourteen centimetres in a second and a half
while the walk animation played. The player feels a quarter of the crowd's push while still
pushing back at full strength.

**Strafe was inverted.** `right = cross(forward, up)`, and with +Y up a character facing +Z
has its right hand at −X. Written as `(z, −x)` — which looks like a perpendicular, and is one
— A and D come out swapped every time.

## What is deliberately not done

- **No licensed art or trademarked titles**, for the reason in §1. Bring your own VRM/GLB and
  the parts layer is where it would hook in.
- **No music.** The wind bed is ambience, not a score, and a score is the kind of thing that
  is either very good or muted within a minute.
- **Only the resident is ever inside.** Open a house and one character is in it. A zone's
  other threads carry on outside, because sending everybody indoors would empty the street
  the moment you opened anything.
- **The mount cannot be ridden into a building**, and gets put away when you go in. A cat the
  size of a sofa in somebody's front room is funny exactly once.
