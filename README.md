# Bollwerk

A multiplayer castle siege for 2–8 players: shoot down your opponents' castle walls, then
race to rebuild your own with falling blocks before the next barrage. Fail to seal a
castle and you lose a life; run out of lives and you are out. After ten rounds, the best
score among those still standing wins.

> _Bollwerk_ is an unofficial fan game inspired by _Rampart_ (Atari Games, 1990). It is not
> affiliated with or endorsed by Warner Bros. Entertainment, which owns the _Rampart_
> trademark. It uses no code, graphics or sound from the original; the audio is from
> OpenGameArt.org under the licences listed in [`CREDITS.md`](CREDITS.md).

- 2–8 players, free-for-all or in equal teams; bots of ten skill levels fill any empty seat
- Play alone on your own computer, with friends on your home network, or over the internet
- Thirteen visual styles — Medieval, Minimal, Night, Cyberpunk, Blueprint, Parchment, Toy
  bricks, Stained glass, Chocolate, Halloween, Sakura, Oktoberfest and Opera — one for building and one for combat, swapped by the
  banners as in Rampart
- Awards at the end of every match, and a rematch in one click
- Played with the mouse alone; How to play in the menu shows the rules in pictures
- An authoritative server, with a deterministic simulation shared by client, server and bots

---

## Play it with the app

The easiest way to host a game: no Node, no terminal. Download the file for your system
from the [Releases](https://github.com/Thomarius/Bollwerk/releases) page and run it.

- **Windows 11**: `Bollwerk-<version>-windows.exe`, a portable file — nothing to install.
  The file is not signed, so Windows warns of an unknown publisher the first time: choose
  **More info**, then **Run anyway**.
- **Linux**: `Bollwerk-<version>-linux.AppImage`. Mark it executable once — in the file
  manager's _Properties → Permissions_, or `chmod +x Bollwerk-*.AppImage` — then open it.

The app starts the game server at once and shows the addresses other players open, each
with a **Copy** button. **Play here** opens the game in the app's own window; **Open in
browser** in your browser. If the port is taken — another server already running — it says
so and offers the next one. Closing the window stops the server.

Everyone else at the table needs only a browser; see [Play with others](#play-with-others)
for the firewall and the addresses.

---

## Play it from the source

You need **Node.js 22.12 or newer** (24 recommended). Get it from
[nodejs.org](https://nodejs.org) — the "LTS" download is fine. Then, in a terminal, in
this folder:

```bash
npm install     # once: fetches everything the game needs
npm start       # builds the game and starts it
```

When it says `bollwerk server on http://localhost:8080`, open that in your browser; the
lines under it give this computer's network addresses, for others at the table to open.
Leave the terminal open while you play; `Ctrl+C` stops the game.

Enter a name, press **Play**, set up the table — how many players, teams, bot skill,
rounds — and press **Start match**. If nobody else joins, the match runs on your own
computer against bots.

---

## Play with others

The computer running the app, or `npm start`, is the **host**. Everyone else only needs a
browser.

### On the same network (LAN, Wi-Fi at home)

1. **Find the host's address on the network.** The app lists it, and so does `npm start`.
   Otherwise:
   - Windows: open a terminal, run `ipconfig`, and look for **IPv4 Address**, e.g.
     `192.168.1.23`.
   - macOS: _System Settings → Network → Wi-Fi (or Ethernet) → Details_, the **IP address**.
   - Linux: run `hostname -I` and take the first address.
2. **Let the game through the host's firewall**, on **port 8080**, TCP.
   - Windows asks the first time the game starts — choose **Allow**, at least for private
     networks.
   - macOS may ask likewise — choose **Allow**.
   - Linux with ufw: `sudo ufw allow 8080/tcp`.
3. **The host presses Play.** The lobby shows a **room code**, e.g. `AX8ZLU`. A public
   table is also listed under **Open games** in everyone's menu.
4. **Everyone else** opens **`http://192.168.1.23:8080`** — the host's address from step 1,
   then `:8080` — types their name and joins from **Open games**, or enters the room code
   and presses **Join**. Or the host can send them a direct link:
   `http://192.168.1.23:8080/?join=AX8ZLU&name=Bo` — the `&name=` part sets their name.
5. The host sets up the table and presses **Start match**.

Use `http://`, not `https://`. The address has to be the host's network address —
`localhost` only ever means "this computer".

### Over the internet

Everything on the LAN applies; in addition, people outside your network need a way in.

1. **Forward port 8080 on your router to the host.** In the router's settings (usually
   at `http://192.168.1.1` or `http://192.168.0.1`; look for _Port forwarding_,
   _Virtual server_ or _NAT_), add a rule:
   - external port **8080**, protocol **TCP**
   - to internal IP **the host's LAN address** (step 1 above), internal port **8080**

   That single port carries everything — the web page and the live game connection.
   Nothing else needs opening.

2. **Find your public address**, for instance at [whatismyip.com](https://whatismyip.com),
   e.g. `203.0.113.7`.
3. **Friends open `http://203.0.113.7:8080`** and join with the room code, as above.

Good to know:

- **Your public address can change** when the router reconnects; check it again before
  a session. A dynamic DNS name (many routers offer one) avoids this.
- **Some internet connections cannot take incoming connections at all** ("CGNAT", common
  on mobile and some fibre and cable providers): the forward is set up correctly and still
  nobody gets in. Then use a VPN that puts everyone on one network — for example
  [Tailscale](https://tailscale.com) or ZeroTier — and play as on a LAN with the host's VPN
  address; or run the game on a server with a public address, as below.
- **To test the forward, use a phone on mobile data**, not a device on your own Wi-Fi —
  many routers do not loop connections back to their own public address.
- To use another port, start with `PORT=3000 npm start` (on Windows PowerShell:
  `$env:PORT=3000; npm start`) and forward that port instead. The app offers the next port
  itself when 8080 is taken.

### On a server, with Docker

One image, one process: it serves the game over HTTP and runs the matches over the same
port.

```bash
docker build -t bollwerk .
docker run -p 8080:8080 bollwerk          # http://<server address>:8080
docker run -e PORT=3000 -p 3000:3000 bollwerk
```

Hosts that assign a port themselves (Fly, Railway) set `PORT` and need nothing else. If
the game is served through `https://`, it connects over secure WebSockets automatically.
`PORT` and `HOST` are the only settings the environment may change: everything else is a
game rule, and a rule an environment variable could alter is a rule two players could
disagree about — which is a desync, not a setting. The runtime image carries no
`node_modules`: the config files, the built client, and one bundled `main.js`.

---

## Development

```bash
npm install
npm run check                       # format, lint, typecheck, test — takes a few minutes
npm run dev   -w @bollwerk/client   # play offline with live reload at http://localhost:5173
npm start     -w @bollwerk/server   # the server alone, serving the last build
npm start     -w @bollwerk/headless -- --matches 8 --players 3 --level 5 --stats out.csv
npm start     -w @bollwerk/headless -- --map --players 3 --seed 2   # print a map as ASCII
tools/screenshots.sh /tmp/shots     # the client in fixed states, against the dev server
```

The dev server has no game server behind it, so its lobby is always a local table.
The client takes query parameters for development: `?autostart=1&players=4&seed=3` skips
the menu, `&snapshot=build&round=3` jumps to a phase, `&teams=2` seats teams of two,
`&watch=1&level=8` fills every seat with Level 8 bots, `&style=flat` picks a style, and
`&speed=10` runs the clock faster.

See [`docs/PLAN.md`](docs/PLAN.md) for the design and what is still open, and
[`docs/ARCHIVE.md`](docs/ARCHIVE.md) for how each decision was reached — with the
measurements behind it, and the attempts that were reverted. `CLAUDE.md` is the short
orientation.

### The desktop app

The app lives in `packages/desktop`: Electron, with the server and the whole simulation
bundled into it. To run it from the source, build the game first, then start it:

```bash
npm run build                       # the client and server the app serves
node node_modules/electron/install.js   # once, if npm install did not fetch Electron
npm start -w @bollwerk/desktop      # opens the app's window
```

To make the portable file yourself, on the system it is for:

```bash
npm run build
npm run package -w @bollwerk/desktop # → packages/desktop/release/
```

On Windows that makes `Bollwerk-<version>-windows.exe`, on Linux
`Bollwerk-<version>-linux.AppImage`; each can only be built on its own system. The version
is the package's own unless `BOLLWERK_VERSION` says otherwise — `BOLLWERK_VERSION=1.0.0 npm run package -w @bollwerk/desktop`, or in PowerShell
`$env:BOLLWERK_VERSION='1.0.0'; npm run package -w @bollwerk/desktop`. `release/` is never
committed.

### Publishing a release

Releases are made for major versions only, not for every change, by
`.github/workflows/release.yml`, which builds both files on GitHub — Windows on Windows,
Linux on Linux.

- **To try a build first**: on GitHub, _Actions → Release → Run workflow_, type a version
  (e.g. `1.0.0`) and run it. When it finishes, the two files are at the bottom of the
  run's page under _Artifacts_. Nothing is published.
- **To publish**: tag the commit with the version, starting with `v`, and push the tag:

  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

  The workflow builds both files and publishes them as the release _Bollwerk v1.0.0_ on the
  repository's Releases page, where anyone can download them. Use a new number each time
  (`v1.0.1`, `v1.1.0`, `v2.0.0`); a tag is meant to be permanent.

- **To withdraw one**: delete the release on the Releases page, then the tag —
  `git push origin --delete v1.0.0` and `git tag -d v1.0.0`.

Do not create the release through GitHub's _Draft a new release_ page: that makes the tag
and the release together, and the workflow, started by the tag, then finds its release
already there and fails. Push the tag, and let the workflow make the release.

## Layout

| Path                | Contents                                                    |
| ------------------- | ----------------------------------------------------------- |
| `config/`           | Every tunable in the game, as JSON                          |
| `packages/config`   | Schemas, typed defaults, cross-file validation              |
| `packages/sim`      | Deterministic game core — no DOM, no Node, no I/O           |
| `packages/protocol` | Wire message types and validators                           |
| `packages/ai`       | Bot logic                                                   |
| `packages/analysis` | Per-round match statistics, for bot soaks and recorded play |
| `packages/server`   | Authoritative match server                                  |
| `packages/client`   | Renderer, UI, lobby, procedural asset generators            |
| `packages/desktop`  | The desktop app for releases: the server behind a window    |
| `tools/headless`    | Bot-vs-bot harness for balance tuning and soak tests        |
| `assets/audio`      | Audio cues                                                  |

## Configuration

No game rule is hardcoded. Phase timings, cannon rewards, scoring, teams, map generation,
palettes and sprite parameters all live in `config/*.json`, validated by strict schemas —
an unknown key is an error rather than a silently ignored one. The server sends the
ruleset to every client in the match snapshot, so all of them run one identical copy.

## Status

| Milestone                                       | State       |
| ----------------------------------------------- | ----------- |
| M0 — scaffold, config schemas, CI               | Done        |
| M1 — simulation core                            | Done        |
| M2 — locally playable, placeholder art          | Done        |
| M3 — procedural art                             | Done        |
| M4 — online multiplayer                         | Done        |
| M5 — AI opponents                               | Done        |
| M6 — full scope, 2–8 players, audio, deployment | Done        |
| M7 — balance pass                               | In progress |
| M8 — team mode, one lobby online and offline    | Done        |
| M9–M12 — visual passes and thirteen styles      | Done        |
| M13 — bots as skill levels and personalities    | Done        |
| M14 — a desktop app for releases                | Done        |

## License

The code is MIT. The audio is under its authors' own open licences, listed in
[`CREDITS.md`](CREDITS.md), which is made from `config/audio.manifest.json` by
`npm run credits` — a release cannot be built while any sound is uncredited.
