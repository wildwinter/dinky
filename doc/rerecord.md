# Re-record flags (`rerecord.json`)

A way to mark already-recorded lines as needing to be **re-recorded** in the
next recording session, without touching the source Ink.

## Why

Sometimes a line has final/recorded audio but the take needs redoing: a
performance note, a script tweak that doesn't change the wording enough to
alter the ID, a mispronunciation. You want that line to show up in the next
recording script and the re-recording stats as work still to do, while leaving
the audio in place until it's replaced.

This can't live in the Ink source (IDs are the stable thread to the audio, and
the flag needs to be editable outside Dinky), so it's tracked in a small
sibling file.

## The file

`rerecord.json`, alongside your `.dinkproj`. A plain JSON array of line IDs:

```json
[
  "chapter1_TheTavern_S494",
  "chapter2_Docks_9MXL"
]
```

- Hand-editable. Add or remove IDs with any editor.
- Written by Dinky through the version-control library (like the project file
  and `characters.json`), so Perforce/Git/etc. are informed of changes.
- Missing file means nothing is flagged (the normal state).

## Flagging a line in Dinky

Put the cursor on a line and use the **Re-record** checkbox in the audio
section of the toolbar.

The checkbox is only enabled when the current line's audio is at a status whose
**Recorded** box is ticked (Project Settings, Audio Status). A line that hasn't
been recorded yet can't be "re-recorded" because it's already in the record
pipeline, so the flag doesn't apply. When a flagged line is current, the audio
status label shows **Re-record** in orange.

## What the compiler does with it

On compile, dink reads `rerecord.json` and, for any listed ID whose audio status
actually counts as recorded:

- **Recording script**: the line's status becomes `Re-record` instead of its
  recorded status, so it appears as work to do.
- **Stats**: the Cast Summary gains a **Re-record** column (per-actor counts),
  and the per-line and per-scene sheets show the line under a **Re-record**
  column rather than a recorded one. Re-record lines are excluded from the
  Recorded / Ready-to-record / In-draft tallies so the four categories still
  add up to the total.

A flagged ID that isn't actually recorded (no audio, or audio at a
non-recorded status) is ignored. The flag has no effect until the line is
recorded.

## Notes

- The ID list is de-duplicated and trimmed on save; ordering isn't significant.
- If you hand-edit the file and add JSON comments, Dinky can still read it, but
  saving from the app rewrites it as plain JSON (comments are not preserved).
- If the file is present but malformed, Dinky disables the checkbox and refuses
  to overwrite it. Fix or remove the file to re-enable flagging.
