/**
 * 《D 大调卡农》的极简交互配乐。
 *
 * 方案 A：背景持续演奏一个缓慢的卡农和弦/旋律循环；玩家每次点击时，
 * 从当前和弦里取一个高音作为“音乐盒”音符，而不是改变主旋律。
 *
 * 卡农作曲家帕赫贝尔已逝世三百多年，作品属于公版；这里只使用和弦进行
 * 和一条简化旋律，不包含任何受版权保护的录音。
 */

const BPM = 62;
const BAR_BEATS = 4;

const CHORDS = [
  { bass: 38, notes: [50, 54, 57, 62] }, // D
  { bass: 45, notes: [45, 49, 52, 57] }, // A
  { bass: 47, notes: [47, 50, 54, 59] }, // Bm
  { bass: 42, notes: [42, 45, 49, 54] }, // F#m
  { bass: 43, notes: [43, 47, 50, 55] }, // G
  { bass: 38, notes: [50, 54, 57, 62] }, // D
  { bass: 43, notes: [43, 47, 50, 55] }, // G
  { bass: 45, notes: [45, 49, 52, 57] }  // A
];

// 每小节两个旋律音，沿用卡农的级进/下行轮廓，做简化处理。
const MELODY = [
  [78, 76], // D: F#5 E5
  [74, 73], // A: D5 C#5
  [71, 73], // Bm: B4 C#5
  [74, 76], // F#m: D5 E5
  [78, 81], // G: F#5 A5
  [78, 76], // D: F#5 E5
  [74, 71], // G: D5 B4
  [73, 76]  // A: C#5 E5
];

export class CanonMusic {
  constructor({ getContext, playNote }) {
    this.getContext = getContext;
    this.playNote = playNote;
    this.timer = 0;
    this.active = false;
    this.startTime = 0;
    this.nextBarTime = 0;
    this.barIndex = 0;
    this.clickIndex = 0;
    this.barDuration = (BAR_BEATS * 60) / BPM;
  }

  get name() {
    return 'D 大调卡农';
  }

  start() {
    const ctx = this.getContext();
    if (!ctx) return;
    this.stop();
    this.active = true;
    this.startTime = ctx.currentTime + 0.15;
    this.nextBarTime = this.startTime;
    this.barIndex = 0;
    this.clickIndex = 0;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 70);
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  schedule() {
    if (!this.active) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const horizon = ctx.currentTime + 0.75;

    while (this.nextBarTime < horizon) {
      this.scheduleBar(this.nextBarTime, this.barIndex);
      this.nextBarTime += this.barDuration;
      this.barIndex = (this.barIndex + 1) % CHORDS.length;
    }
  }

  scheduleBar(time, bar) {
    const chord = CHORDS[bar];

    // 低音
    this.playNote(chord.bass, time, this.barDuration * 0.92, 0.2);

    // 和弦分解，音色保持很轻
    chord.notes.forEach((note, index) => {
      this.playNote(
        note,
        time + 0.04 + index * 0.42,
        this.barDuration * 0.78,
        0.048
      );
    });

    // 两拍一条的简化主旋律
    const melody = MELODY[bar];
    if (melody) {
      this.playNote(melody[0], time + 0.12, this.barDuration * 0.7, 0.13);
      this.playNote(
        melody[1],
        time + this.barDuration * 0.52,
        this.barDuration * 0.55,
        0.1
      );
    }
  }

  /** 玩家点击：只取当前和弦内的音，保证不会出现不协和音。 */
  click() {
    const ctx = this.getContext();
    if (!ctx) return;
    if (!this.active) this.start();

    const now = this.getContext().currentTime;
    const elapsed = Math.max(0, now - this.startTime);
    const bar = Math.floor(elapsed / this.barDuration) % CHORDS.length;
    const chord = CHORDS[bar];
    const note = chord.notes[this.clickIndex % chord.notes.length] + 12;

    this.clickIndex += 1;
    this.playNote(note, now + 0.005, 0.72, 0.19);
  }

  /** 关键突破：在当前和弦上方加一个很轻的高音装饰。 */
  keyAccent() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bar = Math.floor(
      Math.max(0, now - this.startTime) / this.barDuration
    ) % CHORDS.length;
    const chord = CHORDS[bar];

    chord.notes.slice(0, 3).forEach((note, index) => {
      this.playNote(note + 24, now + 0.01 + index * 0.06, 0.8, 0.085);
    });
  }
}
