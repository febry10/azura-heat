# azura-heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/febry10/azura-heat/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/febry10/azura-heat/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**AZURA HEAT** is an original open-world crime game that runs entirely in the browser — no downloads, no server, no network requests. Explore **Port Azura**, a sun-soaked coastal city of pastel towers, palm-lined avenues and one long beach, on foot and behind the wheel.

Play the new driver in town: café owner **Mama Rosa** hands out a four-job story chain — deliver her sedan to Sal's Garage, "valet" a hotel guest's teal coupe, run a package that must never be opened, and beat the clock to the marina. Steal any car you can hotwire, outrun a five-star wanted system with pursuing police cruisers, brawl on the pavement, and stash your cash and progress in an automatic browser save.

Everything is wired together: a full traffic system with lane-following cars that pause at junctions, wandering pedestrians who flee from trouble, police who spawn, chase, pin and bust you, a live minimap with police blips and objective markers, a HUD with wanted stars / health / speedometer, golden-hour lighting with soft shadows, animated ocean surf, and a synthesized WebAudio soundtrack (engine, sirens, jingles) — no audio files. Built with Three.js (vendored locally) and plain JavaScript modules, one per system.

## Run it

You need Node.js 22 or later. From this repository:

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. That is the whole install: `serve.ts` is a tiny static server for the `game/` folder, and the game itself is plain static files — you can equally serve `game/` with any static file server, or open it through the make.fun hand-in below.

Controls: **WASD** move/drive · **mouse drag** camera · **Shift** sprint · **Space** jump/handbrake · **E** enter car, talk, next dialogue line · **F** exit car · **click/J** punch · **P** pause · **M** mute.

To reproduce the bounty hand-in (copies `game/` and `screenshots/` out and writes `dossier.json` with the vendored library):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=xttqesbf&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
