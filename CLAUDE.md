# Rewind — VOD Review — project handoff

## What this is

A browser tool for reviewing competitive The Finals matches from multiple player perspectives at once. You paste two or more VOD links (YouTube or Twitch), mark a shared reference moment in each, and then switch between POVs while staying at the same point in the match.

Owner: Rauder. Built April 2026, upgraded June 2026. This file exists so work continues from the current state rather than starting over.

- Repo: `github.com/Rauder999/vod-review`
- Live: `https://rauder999.github.io/vod-review`
- Branding: logo reads "Rewind", page title "VOD Review", tagline "Multi-POV sync analysis for competitive teams."

## Current status

Working and deployed. No known bugs as of the last session. It has not been touched since June 2026.

Rauder wants three things now: a better UI, a generally more pleasant experience, and to rebuild it with current models. See Open questions before starting.

## Architecture

**Single file.** Everything is one `index.html` at repo root: markup, CSS, and JS inline. No build step, no bundler, no package.json, no dependencies beyond two CDN scripts loaded at runtime:

- `https://www.youtube.com/iframe_api`
- `https://player.twitch.tv/js/embed/v1.js`

**Player-per-POV adapter model.** This is the core design decision and it should not be reverted. The original build used one YouTube player and called `loadVideoById` on every POV switch. That could not hold a YouTube and a Twitch video simultaneously, so the engine was rebuilt in June: every POV gets its own persistent player instance, all stacked in the stage, and switching just toggles visibility. Two consequences: POV switching is near-instant, and mixed YouTube/Twitch sessions work.

Each player sits behind a unified adapter interface so play, pause, seek, volume, and current time all go through one API regardless of platform.

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
};
```

**Sync math.** Unchanged since the first working version. Do not rewrite this without a reason.

```
povs[i].syncPt = the timestamp IN THAT VIDEO at the shared reference moment
masterTime     = activeTime - syncPt[active]
switching to j: targetT = masterTime + syncPt[j]
```

The F key sets the sync flag, and only works on the currently active POV. Pressing it while another POV is active shows "switch to X first". That guard exists because cross-POV flagging was the main source of user error.

**URL parsing.** `parseSource(url)` returns `{platform, vid}` or null, auto-detecting the platform. Helpers `getYT()` and `getTwitch()` handle the individual formats. Accepted Twitch forms: `twitch.tv/videos/123`, legacy `twitch.tv/channel/v/123`, links with `?t=`, and bare numeric ids. Accepted YouTube forms: `v=`, `/embed/`, `youtu.be/`, `/live/`, `/shorts/`, and bare 11-char ids. There were 16 passing parser unit tests at the time of the rebuild; they were not committed.

## Features

- Setup screen with dynamic POV cards, add and remove, color-coded pips
- POV tabs for switching, colored per player
- Sidebar mini list with YouTube thumbnails, branded placeholder for Twitch
- Timeline with click-to-seek
- Timeline markers, drawn only for the POV they were captured on
- Slide-out notes panel that auto-opens on timestamp insert
- Note tags: mistake, good play, rotation, comms
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

**Twitch video ids are passed without a `v` prefix.** The `v` form is only for the raw iframe embed, not the JS `Twitch.Player`. Confirmed working with a real VOD.

**Twitch has no public thumbnail without an API key.** Hence the placeholder in the sidebar.

**Twitch's native control bar cannot be hidden** in the interactive embed. Follow, Subscribe, Clip, and fullscreen will always show. Use the tool's own controls and keyboard shortcuts instead.

## Deployment

Currently manual: the file is uploaded through the GitHub web UI, and Pages serves it from the main branch.

**The filename must be lowercase `index.html`.** A capital `Index.html` produced a 404 because GitHub Pages runs on Linux and is case-sensitive. This has bitten this project once already.

There is no local clone, no git workflow, and no CI. Setting up a proper local repo and push flow is worth doing as a first step.

## Known gaps

- No version control discipline. A working backup was kept once as `index_working_backup.html` in a sandbox that no longer exists. Tag a known-good commit before any refactor.
- No tests committed, despite tests having been written for the parser and sync math.
- Sessions are not persisted. Closing the tab loses all POVs, markers, and notes. Nothing is saved to localStorage or anywhere else.
- No mobile or narrow-viewport handling. `html,body{overflow:hidden}` and the fixed layout assume desktop.
- No error state when a video is private, region-locked, or embedding-disabled. The player just sits blank.
- All CSS and JS live in one file with no separation, which is fine at this size but makes review harder as it grows.

## Design system as built

Dark, near-black, restrained. Fonts: Outfit for UI, JetBrains Mono for labels and monospace bits, both from Google Fonts.

```
--bg:#09090b  --s1:#111113  --s2:#18181c  --s3:#222228
--b1:rgba(255,255,255,0.06)  --b2:rgba(255,255,255,0.11)  --b3:rgba(255,255,255,0.17)
--tx:#f1f1f4  --t2:#9090a8  --t3:#55556a
--blue:#5b8ef0  --green:#4ecb8d  --red:#f06b5b  --yellow:#f0c55b  --purple:#9b6ef0
--r:8px  --r2:5px
```

POV colors are assigned in order from that accent list.

Feedback from Rauder on earlier iterations, worth keeping in mind: the transport buttons once looked like a 2000s media player, and the timeline looked "tired". Both were reworked. Whatever comes next should not regress toward stock media-player styling.

## Scope of this round

UI refresh and quality of life only. No AI features, no backend, no new platforms. The tool stays a single static file on GitHub Pages.

The engine works. Do not rewrite the adapter model or the sync math to make the UI work; if a UI idea requires touching either, that is a signal the idea needs rethinking.

## Suggested order of work

1. Clone the repo locally, init a proper git workflow, tag the current working state
2. Session persistence to localStorage. Losing every POV, marker, and note on a tab close is the single most painful thing about the tool today, and it is a quality-of-life fix before it is a feature.
3. Error states for videos that fail to load: private, region-locked, embedding disabled. Right now the player just sits blank with no explanation.
4. UI pass. Keep the dark restrained direction and the existing palette as a starting point rather than starting from a blank page.
5. Commit the parser and sync tests that already exist but were never checked in

Other quality-of-life candidates worth raising with Rauder, not yet approved: a visible keyboard shortcut reference, renaming POVs mid-session, reordering POV tabs, jumping between markers with a key, and undo for a deleted note.

## Working notes

- Rauder describes himself as a vibe coder: he directs the work rather than writing code by hand. Explain what changed and why.
- Recommend one path rather than listing alternatives. Verify technical claims against official docs before stating them, especially anything about the YouTube or Twitch embed APIs.
- Do not use em dashes in output.
- The sync math and the player-per-POV model are the two things that took the longest to get right. Treat them as load-bearing.
