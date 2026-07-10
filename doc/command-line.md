# Dinky Command-Line Usage

Dinky can be launched from a terminal or script, optionally opening a
specific project and jumping straight to a line.

## Synopsis

```
dinky [<project.dinkproj> | <file.ink>] [--goto <target>]
```

All arguments are optional and may appear in any order.

| Argument | Description |
| --- | --- |
| `<project.dinkproj>` | Project to open. |
| `<file.ink>` | An Ink file. Passed alongside a `.dinkproj`, it selects which Ink root to activate. Passed alone, it opens in ad-hoc mode. |
| `--goto <target>` | Open the file containing `<target>` and jump to its line. |

If no project or Ink file is given, Dinky auto-loads your most recent
project — and `--goto` still applies to it.

## `--goto`

Both forms are accepted:

```sh
--goto myKnot
--goto=myKnot
```

`<target>` is either a **line ID** or a **knot/stitch path**. Dinky works
out which:

1. **Line ID** — matched against the hidden `#id:` tags in your script.
   These look like `TheTavern_Line_AbCd` (see
   [The ID System](../README.md#the-id-system)). Write the ID *without*
   the `#id:` prefix.
2. **Knot or stitch path** — a knot name (`theTavern`) or a stitch within
   a knot (`theTavern.greeting`).

The target is tried as a line ID first, then as a knot/stitch path. If a
knot happened to be named exactly like a line ID, the ID would win. Knot
and stitch names are matched exactly first, then case-insensitively.

The jumped-to line is centred, focused, and briefly highlighted — the same
behaviour as the in-app **Jump to ID** command (`Cmd/Ctrl+J`).

### If the target isn't found

Dinky opens as normal and shows a warning dialog naming the target it
couldn't resolve. It does not fail silently.

## Examples

```sh
# Open a project and jump to a line by its ID
dinky TheTavern.dinkproj --goto TheTavern_Line_AbCd

# Jump to a knot
dinky TheTavern.dinkproj --goto theTavern

# Jump to a stitch within a knot
dinky TheTavern.dinkproj --goto theTavern.greeting

# Omit the path: applies to the most recently opened project
dinky --goto theTavern.greeting

# Open a project, activate a specific Ink root, then jump
dinky TheTavern.dinkproj chapters/act2.ink --goto act2_Opening_Zx19
```

## Running instances

Dinky is single-instance. Invoking it again while it's already running
focuses the existing window rather than starting a second copy — and any
`--goto` you pass is applied to that running instance:

```sh
# Focuses the open Dinky and jumps. No reload, no lost editor state.
dinky --goto TheTavern_Line_AbCd
```

If you also pass a project path, Dinky prompts to save any unsaved work,
loads that project, and *then* jumps.

## Invoking the binary

The `dinky` command above is shorthand. In practice:

**macOS** — the executable lives inside the app bundle:

```sh
/Applications/Dinky.app/Contents/MacOS/Dinky --goto theTavern
```

`open -a Dinky --args --goto theTavern` also works, though `open` returns
immediately and won't surface Dinky's console output.

A shell alias makes this bearable:

```sh
alias dinky='/Applications/Dinky.app/Contents/MacOS/Dinky'
```

**Windows** — the installed executable:

```
"C:\Program Files\Dinky\Dinky.exe" --goto theTavern
```

(Per-user installs live under `%LOCALAPPDATA%\Programs\Dinky\`.)

**Development** — from the repo root:

```sh
npm run preview -- --goto theTavern
```

## Integrating with other tools

Because `--goto` accepts a line ID, anything that knows an ID can deep-link
into the script. The IDs in your localisation spreadsheets, recording
scripts, and audio filenames are all the same IDs Dinky understands.

For example, jumping to the source line for an audio file named after its
ID:

```sh
dinky --goto "$(basename path/to/TheTavern_Line_AbCd.wav .wav)"
```

Or wiring a "open in Dinky" action into a bug tracker, a spreadsheet
macro, or a game engine's debug overlay — pass the ID of the offending
line and the writer lands on it.
