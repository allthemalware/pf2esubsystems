# PF2e Subsystems

A GM-side runner for **Pathfinder 2e (Remaster)** GM Core's Victory Point
subsystems — the chase, the infiltration, the influence encounter, the research
montage, and the bare framework underneath all of them.

These are rules that get abandoned mid-session, not because they're hard but
because tracking them by hand is tedious and easy to get wrong. This keeps the
bookkeeping honest: awareness ticks up on its own at the end of every round,
leftover chase points are discarded at each obstacle rather than carried, a
research source stops paying out once it's spent, and every one of those moves
can be undone.

Single self-contained `dist/index.html` — no framework, no build step to *use*
it, with encounters saved on your device. Open it from a file, host it, or
install it as an app.

## The five modes

| Mode | Tracks | The thing it gets right |
|------|--------|-------------------------|
| **Chase** | Chase Points | Excess points are discarded at each obstacle, not carried to the next |
| **Infiltration** | Infiltration + Awareness | A failure costs 0 IP **and** hands over 1 AP; every round adds another |
| **Influence** | Influence Points | Which of the NPC's resistances and weaknesses the party has actually Discovered |
| **Research** | Research Points | Each source has a maximum, after which it gives nothing |
| **Victory Points** | whatever you name them | Accumulating and diminishing scales, seeded from GM Core's own table |

The fifth is the escape hatch. Reputation, duels, leadership and hexploration
ship as reference text rather than runners — name your own points, set your own
thresholds, and the same board runs them.

### At the table

- **One tap per PC per round.** Four buttons, one per degree of success, and the
  app works out what moves.
- **Undo.** Every action is reversible, including across an obstacle boundary
  where points were discarded and no arithmetic could put them back.
- **42 sample obstacles.** GM Core's Underground, Urban and Wilderness chase
  tables, with their real skills and DCs, pickable when you're building a chase.
- **Prep and run are separate.** Resetting a run hands the prepped chase back
  untouched; an export code carries the prep and none of last week's dice.
- **Where the book says "the GM decides", the app asks.** Obstacle costs, the
  awareness failure point, round lengths and thresholds are prefilled with the
  book's rule of thumb and left editable.

## Run it

### Android

The Android app includes Run, Prep and Reference; the separate PF2e Primer is
not bundled. It works offline and shares encounter codes through Android's
share sheet. See [android/README.md](android/README.md) for building a test APK,
installing it on a phone, and creating a signed release bundle.
Optional tips in Settings use Google Play Billing. Every feature remains free;
the browser build has no payment flow. Product setup and payment testing are
documented in [the Android guide](android/README.md#google-play-tips).

```sh
npm run android:apk
```

Requires Python 3, a supported JDK and the Android SDK. The GitHub Actions
**Build Android app** workflow can also produce an installable debug APK.
For external testers, **Prepare Android prerelease** builds a signed APK and
creates a draft prerelease with a checksum. See the
[GitHub testing instructions](android/README.md#github-prereleases-for-testers)
for signing secrets, publishing the download, and collecting feedback.

### Browser

```sh
python3 tools/build.py        # assemble dist/index.html
# then either:
open dist/index.html          # straight from the file, fully offline
npx pf2e-subsystems           # serve at http://localhost:8727 and open the browser
```

## Where the rules text comes from

Every word of quoted rules text is Paizo's own, generated from the open-source
Foundry VTT pf2e data so it can't drift from the book. The subsystems chapter
lives in the GM Screen journal; the conditions and actions come from their own
packs. The subsystem pages are on the `v14-dev` branch:

```sh
git clone --depth 1 --filter=blob:none --sparse -b v14-dev \
    https://github.com/foundryvtt/pf2e.git pf2e-data
cd pf2e-data && git sparse-checkout set packs/pf2e/journals \
    packs/pf2e/conditions packs/pf2e/actions && cd ..

python3 tools/build_subsystems.py \
    --src pf2e-data/packs/pf2e/journals/gm-screen.json \
    --out data/subsystems.generated.js
python3 tools/build_reference.py --src pf2e-data/packs/pf2e \
    --out data/reference.generated.js
python3 tools/build.py
```

The Influence page in particular is *only* a pointer to the **Influence** and
**Discover** actions — which is why `build_reference.py` here pulls
`actions/subsystems/` as well as the four folders the other tools use. Without
it that page renders as two bare headings. The test suite asserts that every
action the rules text names actually resolves.

The explanations *around* that text, the run board, and every judgement about
what to enforce and what to ask are ours.

## Tests

Additional mobile checks cover complete-library backup and restore, validated
encounter codes, party presets, setup forms, searchable obstacle selection,
screen-awake behavior and accessible controls. Run all checks with `npm run check`.

```sh
npm install                   # jsdom
node tools/test.mjs
```

107 assertions over the built file. They cover the arithmetic rather than the
rendering: every degree-of-success scale, the chase discard at an obstacle
boundary, awareness accruing at end of round, the 2× failure threshold and its
quarter marks, individual versus group obstacles, Edge Point spends, research
caps, thresholds firing exactly once against the right count, both Victory
Point scales, undo restoring exactly across an obstacle advance, and that the
two generated data files line up with each other.

## The other three tools

- [PF2e Primer](https://allthemalware.github.io/pf2eprimer/) — an interactive introduction for new players.
- [PF2e Spellbook](https://allthemalware.github.io/pf2espellcards/) — player-side spell preparation and casting.
- [PF2e Party Tracker](https://allthemalware.github.io/pf2epartytracker/) — GM-side passive stats, secret checks and the exploration board.

## Licensing

Application code is MIT (see [`LICENSE`](./LICENSE)). Bundled Pathfinder
subsystem, condition and action text is Paizo content under the ORC and OGL
licenses — see [`notice.md`](./notice.md). This is an unofficial fan tool, not
affiliated with Paizo.
