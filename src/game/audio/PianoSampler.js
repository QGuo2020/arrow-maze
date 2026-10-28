/**
 * 本地钢琴采样播放器。
 *
 * 采样来自 Salamander Grand Piano V3（Alexander Holm，CC BY 3.0），
 * 详见 assets/audio/piano/ATTRIBUTION.md。
 *
 * 只抽取 A/C/D#/F# 四组采样，中间音用 playbackRate 做轻微变调；
 * 最大变调不超过 1.5 个半音，保留真实钢琴的起音和尾音。
 */
const SAMPLE_ROOT = new URL(
  '../../../assets/audio/piano/',
  import.meta.url
);

const SAMPLE_FILES = [
  ['A1v1.png', 33],
  ['C2v1.png', 36],
  ['D#2v1.png', 39],
  ['F#2v1.png', 42],
  ['A2v1.png', 45],
  ['C3v1.png', 48],
  ['D#3v1.png', 51],
  ['F#3v1.png', 54],
  ['A3v1.png', 57],
  ['C4v1.png', 60],
  ['D#4v1.png', 63],
  ['F#4v1.png', 66],
  ['A4v1.png', 69],
  ['C5v1.png', 72],
  ['D#5v1.png', 75],
  ['F#5v1.png', 78],
  ['A5v1.png', 81]
];

export class PianoSampler {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.destination = destination;
    this.buffers = [];
    this.ready = false;
    this.loading = null;
  }

  load() {
    if (this.ready) return Promise.resolve(true);
    if (this.loading) return this.loading;

    const jobs = SAMPLE_FILES.map(async ([filename, midi]) => {
      try {
        const url = new URL(
          encodeURIComponent(filename),
          SAMPLE_ROOT
        );
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) return null;
        const data = await response.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(data);
        return { midi, buffer };
      } catch {
        return null;
      }
    });

    this.loading = Promise.all(jobs)
      .then((samples) => {
        this.buffers = samples.filter(Boolean);
        this.ready = this.buffers.length > 0;
        return this.ready;
      })
      .catch(() => false);

    return this.loading;
  }

  nearest(midi) {
    let best = this.buffers[0];
    let bestDistance = Infinity;
    for (const sample of this.buffers) {
      const distance = Math.abs(sample.midi - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = sample;
      }
    }
    return best;
  }

  play(midi, when, duration = 2, velocity = 0.1) {
    if (!this.ready || !this.ctx || !this.destination) return;
    const sample = this.nearest(midi);
    if (!sample) return;

    const source = this.ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = Math.pow(2, (midi - sample.midi) / 12);

    const gain = this.ctx.createGain();
    const start = Math.max(this.ctx.currentTime, when ?? 0);
    const end = start + duration;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, velocity), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    source.connect(gain);
    gain.connect(this.destination);
    source.start(start);
    source.stop(end + 0.04);
  }
}
