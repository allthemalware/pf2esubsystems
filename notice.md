# Third-Party Notices & Attribution

**pf2e-subsystems**

This file records the licensing of the two distinct kinds of material in this
package: the application **code**, and the Pathfinder **rules text** it bundles
(the GM Core subsystems chapter, plus condition and action descriptions). They
are covered by different licenses and the distinction below is intentional.

---

## 1. Application code

All original source code in this package is released under the **MIT License**.
See the [`LICENSE`](./LICENSE) file for the full text.

```
Copyright (c) 2026 Whyte Erminae
```

The MIT License covers only the code authored for this project. It does **not**
cover the Pathfinder game content described in section 2, which carries its own
license and notice. The encounters a GM builds in this app are their own; the app
stores them in the GM's browser and transmits them nowhere.

---

## 2. Pathfinder rules content (ORC License)

The bundled reference data consists of the **rules expressions of Pathfinder
Second Edition subsystems, conditions and actions** — their names and functional
effect text, including the sample chase obstacles and the Victory Point scales
tables. Under the Open RPG Creative License this is **Licensed Material** (the
copyrighted expression of game mechanics), used here under that license. It
originates with **Paizo Inc.** and is derived from the open-source [Foundry VTT
`pf2e` system](https://github.com/foundryvtt/pf2e) data — the subsystem text from
the GM Screen journal (`packs/pf2e/journals/gm-screen.json`), the conditions and
actions from their own packs.

Every page of subsystem text carries the Paizo page range it came from; those
citations are generated into `data/subsystems.generated.js` alongside the text
and are shown in the app's Reference tab.

### ORC Notice

This product is licensed under the ORC License located at the Library of Congress
at TX 9-307-067 and available online at various locations including
paizo.com/orclicense, azoralaw.com/orclicense, and others. All warranties are
disclaimed as set forth therein.

### Attribution

This product is based on the following Licensed Material:

Pathfinder Player Core © 2023 Paizo Inc., Designed by Logan Bonner, Jason
Bulmahn, Stephen Radney-MacFarland, and Mark Seifter.

Pathfinder Player Core 2 © 2024 Paizo Inc.

Pathfinder GM Core © 2023 Paizo Inc., Designed by Logan Bonner and Mark Seifter.

Pathfinder Treasure Vault (Remastered) © 2025 Paizo Inc.

Pathfinder Dark Archive (Remastered) © 2025 Paizo Inc.

> NOTE — The precise list of source books is generated into `GENERATED_REF_META`
> in `data/reference.generated.js` and `GENERATED_SUB_META` in
> `data/subsystems.generated.js`, from the licenses and citations recorded in the
> Foundry pf2e data. Re-sync this section whenever either is rebuilt
> (`npm run build:ref`, `npm run build:sub`).

### Reserved Material

Reserved Material elements are excluded from this product. To avoid confusion,
such items include all trademarks, registered trademarks, and proper nouns,
artwork, dialogue, organizations, plots, and storylines. Where a rule's mechanics
are included, any such Reserved Material has been omitted or genericized.

### Crediting this work downstream

pf2e-subsystems © 2026 Whyte Erminae.

---

## 3. Pathfinder rules content (OGL)

Three of the bundled action descriptions originate in pre-Remaster books that
were published under the **Open Game License v1.0a** rather than the ORC License
(2 from *Pathfinder Secrets of Magic*, 1 from *Pathfinder Gamemastery Guide*).
They are included here as Open Game Content under that license.

### OGL Section 15

```
Open Game License v 1.0a © 2000, Wizards of the Coast, Inc.

System Reference Document © 2000, Wizards of the Coast, Inc.; Authors Jonathan
Tweet, Monte Cook, and Skip Williams, based on material by E. Gary Gygax and
Dave Arneson.

Pathfinder Secrets of Magic © 2021, Paizo Inc.; Authors: Amirali Attar Olyaee,
Alexander Augunas, Kate Baker, James Case, Jeff Collins, Vanessa Hoskins,
James Jacobs, Jason Keeley, Lyz Liddell, Ron Lundeen, Patchen Mortimer, Stephen
Radney-MacFarland, David N. Ross, Michael Sayre, Owen K.C. Stephens, Mark
Seifter, Ashton Sperry, Andrew White.

Pathfinder Gamemastery Guide © 2020, Paizo Inc.; Authors: Alexander Augunas,
Jesse Benner, John Bennett, Logan Bonner, Clinton J. Boomer, Jason Bulmahn,
James Case, Paris Crenshaw, Jesse Decker, Robert N. Emerson, Eleanor Ferron,
Jaym Gates, Matthew Goetz, T.H. Gulliver, Kev Hamilton, Sasha Laranoa Harving,
BJ Hensley, Vanessa Hoskins, Brian R. James, Jason LeMaitre, Lyz Liddell, Luis
Loza, Ron Lundeen, Colm Lundberg, Stephen Radney-MacFarland, Jessica Redekop,
Patrick Renie, Mikhail Rekun, Alistair Rigg, David N. Ross, David Schwartz,
Michael Sayre, Amber Stewart, Christina Stiles, Landon Winkler, Linda Zayas-Palmer.
```

> NOTE — Regenerate this list from `GENERATED_REF_META` whenever the reference
> data is rebuilt (`npm run build:ref`); the licence recorded per entry decides
> which section it belongs in.

---

## 4. Compatibility / trademark notice

Pathfinder and all associated marks and logos are trademarks of Paizo Inc.
This package is an independent work, is **not** published, endorsed, sponsored,
or affiliated with Paizo Inc., and no such association is implied. Any reference
to Pathfinder is made under nominative fair use solely to identify the game
system with which this material is compatible.

The explanatory prose, the two pregenerated characters, the teaching NPC and all
the interactive demos are original work by the author of this package.
