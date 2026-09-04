# Rewind — VOD Review — project handoff

## What this is

A browser tool for reviewing competitive matches (any game) from multiple player perspectives at once. It started as a The Finals tool; the September 2026 rebuild removed the game branding. You paste two or more VOD links (YouTube or Twitch), mark a shared reference moment in each, and then switch between POVs while staying at the same point in the match.

Owner: Rauder. Built April 2026, engine rebuilt June 2026, quality-of-life round started September 2026. This file exists so work continues from the current state rather than starting over.

- Repo: `github.com/Rauder999/vod-review`
- Live: `https://rauder999.github.io/vod-review`
- Branding: wordmark "Rewind" with a lit dot, page title "Rewind — VOD Review", setup headline "Every perspective, one moment.", eyebrow "Multi-POV match review".

## Current status

Working and deployed. `main` is the September 2026 build; the June 2026 build is tagged `v1-june-2026` (pushed).

September 2026 round, all merged to `main` and live:

- Session persistence to localStorage
- Error states for videos that fail to load
- Parser, sync math and snapshot tests committed, 63 passing
- Local git workflow with real commit messages instead of web-UI uploads
- Full UI rebuild, game-agnostic, studio palette by default. See UI rebuild below.

## Architecture

**Single file.** Everything is one `index.html` at repo root: markup, CSS, and JS inline. No build step, no bundler, no package.json. Runtime dependencies:

- `https://www.youtube.com/iframe_api` and `https://player.twitch.tv/js/embed/v1.js`, loaded on demand by `ensureApi(platform)`: as soon as a link of that platform is typed on the setup screen, and again (no-op) when a session starts.
- Google Fonts, one stylesheet link with `display=swap` (Bricolage Grotesque 700, Instrument Sans 400/500/600, JetBrains Mono 400/500).
- Nothing else. Icons are an inline SVG sprite at the top of `<body>`. There are no images. The September 2026 rebuild removed the Phosphor icon CSS from unpkg and the THE FINALS art that was hotlinked from Squarespace; the tool is game-agnostic now.

**Player-per-POV adapter model.** This is the core design decision and it should not be reverted. The original build used one YouTube player and called `loadVideoById` on every POV switch. That could not hold a YouTube and a Twitch video simultaneously, so the engine was rebuilt in June: every POV gets its own persistent player instance, all stacked in the stage, and switching just toggles visibility. Two consequences: POV switching is near-instant, and mixed YouTube/Twitch sessions work.

Each player sits behind a unified adapter interface so play, pause, seek, volume, and current time all go through one API regardless of platform. The adapter also carries `error` (null or `{title, msg, code, soft}`), see Error states.

**Pure core block.** The script starts with a block fenced by `// ── PURE CORE START ──` and `// ── PURE CORE END ──`. It holds every function that needs no DOM, no window and no `S`: URL parsing, `syncShift`, `fmt`, `ageLabel`, `esc`, `ytErrorInfo`, `validateSnapshot`. The tests slice that block out of `index.html` verbatim and evaluate it, so anything added there must stay page-free (a test enforces this).

**State object:**

```js
const S = {
  povs: [],        // {name, platform, vid, hex, syncPt, volume}
  players: [],     // adapter objects, same index as povs
  active: 0,
  playing: false,
  speed: 1,        // YouTube playback rate; Twitch ignores this
  dur: 0,
  ready: false,
  ticker: null,
  markers: [],
  loopMode: false,
  loopA: null,
  loopB: null,
  notesOpen: false,
  live: false,     // true while the review screen is showing; gates saving and hotkeys
  lastKnownT: 0,   // last active-player time seen by tick(), persisted as lastTime
  resumeAt: null,  // seek target applied once the active player is ready (resume path)
};
```

**Sync math.** Unchanged since the first working version. Do not rewrite this without a reason. It now lives in one pure function, `syncShift(currentT, fromSync, toSync)`, used by both `switchPov` and the per-POV time labels in `tick`.

```
povs[i].syncPt = the timestamp IN THAT VIDEO at the shared reference moment
masterTime     = activeTime - syncPt[active]
switching to j: targetT = masterTime + syncPt[j]
```

The F key sets the sync flag, and only works on the currently active POV. Pressing it while another POV is active shows "switch to X first". That guard exists because cross-POV flagging was the main source of user error.

**Session flow.** `startSession()` (fresh) and `resumeSession()` (restored) both prepare `S.povs`, `S.markers`, notes and speed, then call `launch(activeIdx)`, which shows the review screen, builds the UI and creates the players. `newSession()` saves one last time, sets `live = false`, destroys the players and returns to setup with the resume card visible.

**URL parsing.** `parseSource(url)` returns `{platform, vid}` or null, auto-detecting the platform. Helpers `getYT()` and `getTwitch()` handle the individual formats. Accepted Twitch forms: `twitch.tv/videos/123`, legacy `twitch.tv/channel/v/123`, links with `?t=`, and bare numeric ids. Accepted YouTube forms: `v=`, `/embed/`, `youtu.be/`, `/live/`, `/shorts/`, and bare 11-char ids. Known leniency: any URL carrying `v=<11 chars>` is treated as YouTube even on a foreign host. Documented in the tests, left as is.

## Session persistence

One snapshot in `localStorage` under `rewind.session.v1`, overwritten on every change. Contents: POVs (name, platform, id, sync point, volume), markers, notes text, active POV, speed, and `lastTime` (the active player's position).

- Saves are debounced 400 ms after any change (`saveSoon()`), plus a periodic write from `tick` every 5 s so the position stays fresh, plus an immediate write on `pagehide` and on tab hide.
- Saving only happens while `S.live` is true, so the setup screen never overwrites a snapshot with an empty state.
- On load and on returning to setup, `renderResumeCard()` shows "Last session found" with names, marker count, notes, sync status and position, and prefills the POV cards if they are empty. Resume restores everything and seeks the active player to `lastTime`, paused. Discard clears the snapshot.
- Restored data goes through `validateSnapshot()` first: wrong version, missing POVs or unknown platforms reject the whole snapshot; bad optional fields fall back to defaults; markers pointing at a missing POV or with a non-hex color are dropped.

## Error states

Neither platform promises a "failed to load" event, so every player gets a 20 s ready deadline. On failure `failPov()` draws an overlay on that POV's layer (visible only when it is active) with the player name, a title, a plain-language explanation, the raw code, an "Open on YouTube/Twitch" link and a "Change links" button back to setup. The POV's tab gets a red `!` prefix and its sidebar card greys out.

- YouTube: `onError` codes from the official reference. 100 = removed or private, 101 and 150 = embedding disabled by the owner, 2 = invalid id, 5 = HTML5 player error, 153 = missing referer (happens on `file://`).
- Twitch: no error event exists (verified against the embed docs, September 2026). Two fallbacks: the 20 s ready deadline, and a soft dismissible warning if `getDuration()` is still 0 fifteen seconds after READY, which usually means the VOD is deleted or subscriber-only. Twitch's own "content unavailable" message also shows inside the iframe because its control bar cannot be hidden.
- If the active POV fails, the ticker still starts so the rest of the UI works; the timeline just stays at zero for that POV.

## Features

- Setup screen with dynamic POV cards, add and remove, color-coded pips
- Resume card on setup when a saved session exists
- POV tabs for switching, colored per player, error mark when a video fails
- Sidebar mini list with YouTube thumbnails, branded placeholder for Twitch
- Timeline with click-to-seek
- Timeline markers, drawn only for the POV they were captured on
- Slide-out notes panel that auto-opens on timestamp insert
- Note tags: mistake, good play, rotation, comms, note
- Loop A/B for repeating a segment
- Frame-by-frame stepping on `.` and `,`
- Per-POV volume
- Speed control (YouTube only)
- HTML export report with clickable timestamps and correct per-platform watch links
- Toast notifications

## Platform constraints (verified against official docs, do not re-derive from memory)

**Twitch has no playback-rate method at all.** Speed control greys out and shows 1x whenever the active POV is Twitch. This is not a bug to fix.

**Twitch embeds require https and a `parent` domain.** They will not load from `file://`. The code wires `parent` to the current hostname automatically plus localhost and 127.0.0.1. The setup screen shows a warning when a Twitch URL is detected. YouTube works either way.

**Volume scales differ.** YouTube is 0 to 100, Twitch is 0.0 to 1.0. The adapter converts.

**Twitch video ids are passed without a `v` prefix to `Twitch.Player`.** Confirmed working with a real VOD in June 2026. Note: the current Twitch docs page says the video id "must have a v prefix"; that wording covers the iframe URL form. Do not change the JS player call on the strength of the docs alone, test with a real VOD first.

**Twitch has no public thumbnail without an API key.** Hence the placeholder in the sidebar.

**Twitch's native control bar cannot be hidden** in the interactive embed. Follow, Subscribe, Clip, and fullscreen will always show. Use the tool's own controls and keyboard shortcuts instead.

## Tests

`tests/core.test.mjs`, Node's built-in `node:test`, no dependencies. Run from the repo root:

```
node --test
```

Covers: YouTube and Twitch URL forms, parseSource edge cases, watchUrl round-trip, sync math (identity, forward, backward, round trip, negative), `fmt`, `ageLabel`, `esc`, YouTube error code mapping, snapshot validation and normalization, plus two guards: the whole inline script must parse, and the pure core block must not reference the page. Node 24 is installed on Rauder's machine.

## Development and deployment

- Local clone lives at `C:\Users\taksa\My project\Vod-review`. Git Bash is broken on that machine (fork errors); use PowerShell.
- Local preview: any static server on the repo root. A throwaway Node server plus `.claude/launch.json` are used in sessions; `.claude/` is git-ignored because the launch config points at a machine-specific path.
- Work on a branch, merge into `main` and push when Rauder approves; GitHub Pages serves `main` and rebuilds in about a minute.
- Push works from Rauder's machine without prompting (Git Credential Manager holds the login).

**The filename must be lowercase `index.html`.** A capital `Index.html` produced a 404 because GitHub Pages runs on Linux and is case-sensitive. This has bitten this project once already.

## Known gaps

- No mobile or narrow-viewport handling. `html,body{overflow:hidden}` and the fixed layout assume desktop.
- Only one saved session at a time. Starting a new session overwrites the previous snapshot.
- Region-locked YouTube videos do not raise `onError`; YouTube shows its own message inside the iframe and the tool only notices via the 20 s deadline if the player never reports ready.
- All CSS and JS live in one file with no separation, which is fine at this size but makes review harder as it grows.

## UI rebuild (September 2026)

**Concept: a control room.** POVs are cameras, labelled CAM 1 to 6 everywhere (setup cards, cam buttons under the timeline, the stage badge, multiview chips, the export). The active camera carries a tally: coloured ring, lit dot, glow. A failed camera gets a struck-through name and a red mark. Timecode is monospaced with tabular numerals.

**Palettes.** Three, switched by `data-palette` on `<html>` and stored in `localStorage` under `rewind.palette`. Component CSS reads only tokens, so a palette is a pure token swap. Swatches live in the setup footer. Rauder picked `studio` on 2026-09-04; it is the bare `:root` block and the first entry of `PALETTES`. The other two stay available through the swatches; drop them by deleting their `:root[data-palette]` blocks, their swatch buttons and their names in `PALETTES`.

```
studio  (default)  bg #0e0d10  s1 #151317  s2 #1b191e  s3 #242127  tx #f3eff6  t2 #a59db2  accent #c4a6ff (lilac)
signal             bg #0b0c0f  s1 #111318  s2 #171a20  s3 #1f232b  tx #eef0f4  t2 #9aa1b0  accent #f2b544 (amber)
monitor            bg #090c12  s1 #0f131b  s2 #151a24  s3 #1c2330  tx #edf2fa  t2 #94a3bd  accent #7cc4ff (ice blue)
semantic (all)     ok #3fd18f  warn #f2b544  bad #ff5d5d
POV colours (CHEX) #4f9cf9 #3fd18f #ff7a59 #b48cff #ff8fc2 #33d3cc
tag colours        mistake #ff5d5d  good #3fd18f  rotation #4f9cf9  comms #33d3cc  note #b48cff
radii              --r 10px  --r2 7px  --r3 4px, pills are 999px
```

POV colours deliberately avoid yellow (so the signal amber never collides with a camera) and the lilac CAM 4 `#b48cff` sits close to the studio accent; if that ever reads as confusing, swap CAM 4 for a different hue rather than touching the accent. Tag colours are stored inside saved markers as hex, so changing them only affects new markers. The exported HTML report is hard-coded to the studio colours.

**Type.** Bricolage Grotesque 700 for the wordmark and overlay titles only. Instrument Sans for UI. JetBrains Mono for timecode, eyebrows, chips and `kbd`.

**Layout.** Top bar (wordmark, session names, shortcuts `?`, Notes, Export, New). Main: stage, then the deck (timecode + timeline row; transport pill, speed pill, volume pill, cam buttons; mark tags). Right rail: Multiview cards with live per-camera time, Sync points, Markers, and a footer hint for `?`. Notes slide in from the right. A shortcuts overlay opens on `?` and closes on Esc.

**What is new in behaviour, beyond looks.** Hover on the timeline shows the time under the cursor. `Esc` closes notes or the shortcuts overlay. The setup link field shows a YT or TW chip as you type and "no match" for a bad link. Remove is hidden on the last card; Add POV disables at six. The stage shows "Loading players" until the active one is ready.

**Rauder's earlier feedback still applies:** the transport once looked like a 2000s media player and the timeline looked "tired". The rebuild uses pill clusters and a thick glowing playhead; do not regress toward stock media-player chrome.

## Scope

Quality of life and UI only. No AI features, no backend, no new platforms. The tool stays a single static file on GitHub Pages.

The engine works. Do not rewrite the adapter model or the sync math to make the UI work; if a UI idea requires touching either, that is a signal the idea needs rethinking.

## Next up

1. Rauder checks the live rebuild, including a real Twitch VOD on the github.io page (Twitch cannot be tested from localhost over http).
2. Decide whether to keep the palette switcher or lock studio only.

Other quality-of-life candidates worth raising with Rauder, not yet approved: renaming POVs mid-session, reordering cameras, jumping between markers with a key, undo for a deleted note, more than one saved session, a grid view showing all cameras at once.

## Working notes

- Rauder describes himself as a vibe coder: he directs the work rather than writing code by hand. Explain what changed and why. He writes in Russian.
- Recommend one path rather than listing alternatives. Verify technical claims against official docs before stating them, especially anything about the YouTube or Twitch embed APIs.
- Do not use em dashes in output.
- The sync math and the player-per-POV model are the two things that took the longest to get right. Treat them as load-bearing.
