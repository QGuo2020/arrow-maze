# Piano samples

Sample source:

- **Salamander Grand Piano V3** by Alexander Holm
- License: **CC BY 3.0** — https://creativecommons.org/licenses/by/3.0/
- Original library: https://archive.org/details/SalamanderGrandPianoV3
- MP3 subset package: https://www.npmjs.com/package/@audio-samples/piano-mp3-velocity1

The MP3 files in this folder come from `@audio-samples/piano-mp3-velocity1@1.0.5`,
which packages the Salamander Grand Piano V3 samples.

Changes: 17 samples were trimmed to 4 seconds, converted to mono 44.1kHz MP3
(96kbps), and concatenated into one audio sprite. The sprite is stored with a
`.png` extension so the static host serves it as opaque data instead of media;
the bytes are still MP3 audio. No claim of authorship over the samples is made.

The file `assets/audio/canon-loop.png` is an original arrangement generated
from those samples for this game, using the public-domain Canon in D chord
progression and melody. It is also stored as opaque MP3 bytes behind a `.png`
extension.

The composition used with these samples, Pachelbel's **Canon in D**, is in the
public domain. The game arrangement is original code and is not based on a
copyrighted recording.
