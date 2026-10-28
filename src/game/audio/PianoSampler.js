/**
 * 本地钢琴采样播放器。
 *
 * 采样来自 Salamander Grand Piano V3（Alexander Holm，CC BY 3.0），
 * 详见 assets/audio/piano/ATTRIBUTION.md。
 *
 * 17 个音被裁成 4 秒一段并串成一个音频 sprite；只发一个请求，
 * 播放时用 buffer offset 取对应音高，再用 playbackRate 做最多 1.5 个半音变调。
 */
const SPRITE_URL = new URL(
  '../../../assets/audio/piano/piano-sprite.png',
  import.meta.url
);

const SAMPLE_ROOTS = [
  33, // A1
  36, // C2
  39, // D#2
  42, // F#2
  45, // A2
  48, // C3
  51, // D#3
  54, // F#3
  57, // A3
  60, // C4
  63, // D#4
  66, // F#4
  69, // A4
  72, // C5
  75, // D#5
  78, // F#5
  81 // A5
];

const SLICE_SECONDS = 4;

export class PianoSampler {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.destination = destination;
    this.buffer = null;
    this.ready = false;
    this.loading = null;
  }

  load() {
    if (this.ready) return Promise.resolve(true);
    if (this.loading) return this.loading;

    this.loading = fetch(SPRITE_URL, { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) return false;
        return response.arrayBuffer();
      })
      .then((data) => {
        if (!data) return false;
        return this.ctx.decodeAudioData(data);
      })
      .then((buffer) => {
        if (!buffer) return false;
        this.buffer = buffer;
        this.ready = true;
        return true;
      })
      .catch(() => false);

    return this.loading;
  }

  nearestIndex(midi) {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < SAMPLE_ROOTS.length; index += 1) {
      const distance = Math.abs(SAMPLE_ROOTS[index] - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }

  play(midi, when, duration = 2, velocity = 0.1) {
    if (!this.ready || !this.ctx || !this.destination) return;
    const index = this.nearestIndex(midi);
    const root = SAMPLE_ROOTS[index];
    const rate = Math.pow(2, (midi - root) / 12);
    const offset = index * SLICE_SECONDS;
    const sourceDuration = Math.min(SLICE_SECONDS, duration * rate + 0.2);

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = rate;

    const gain = this.ctx.createGain();
    const start = Math.max(this.ctx.currentTime, when ?? 0);
    const end = start + duration;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(
      Math.max(0.0001, velocity),
      start + 0.012
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    source.connect(gain);
    gain.connect(this.destination);
    source.start(start, offset, sourceDuration);
    source.stop(end + 0.04);
  }
}
