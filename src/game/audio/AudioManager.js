/**
 * 声音管理器。
 *
 * - BGM：只播放用户在设置里选择的本地音乐（HTMLAudioElement），
 *   不再默认播放内置合成音乐；没有选择音乐时保持安静。
 * - 音效：Web Audio 实时合成。使用轻柔的噪声扫频、低频闷响和短促气声，
 *   避免刺耳的蜂鸣声。
 *
 * 浏览器自动播放策略要求先有用户手势，因此 unlock() 会在第一次交互时调用。
 */
export class AudioManager {
  constructor(settings) {
    this.settings = { ...settings };
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.sfxGain = null;
    this.sfxFilter = null;
    this.reverb = null;
    this.reverbGain = null;
    this.noiseBuffer = null;
    this.unlocked = false;

    this.customAudio = null;
    this.bgmUrl = null;
    this.bgmFailed = false;
  }

  /** 第一次用户手势后初始化 AudioContext。 */
  unlock() {
    if (this.unlocked) {
      if (this.ctx?.state === 'suspended') {
        this.ctx.resume().then(() => this.startBgm()).catch(() => {});
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      this.ctx = new AudioContextClass();

      // 压缩器让叠加音效不会突然爆音
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;
      this.compressor.connect(this.ctx.destination);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(this.compressor);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.settings.sfxVolume;

      // 稍微收一下高频，再叠一点短混响，去掉干瘪的电子味
      this.sfxFilter = this.ctx.createBiquadFilter();
      this.sfxFilter.type = 'lowpass';
      this.sfxFilter.frequency.value = 7800;
      this.sfxFilter.Q.value = 0.35;

      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.createReverbImpulse();
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.16;

      this.sfxGain.connect(this.sfxFilter);
      this.sfxFilter.connect(this.masterGain);
      this.sfxFilter.connect(this.reverb);
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.masterGain);

      this.noiseBuffer = this.createNoiseBuffer();
      this.unlocked = true;

      const resumePromise =
        this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
      resumePromise
        .then(() => {
          if (this.settings.bgm) this.startBgm();
        })
        .catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  applySettings(settings) {
    this.settings = { ...settings };
    if (this.ctx) {
      this.sfxGain.gain.setTargetAtTime(
        this.settings.sfxVolume,
        this.ctx.currentTime,
        0.03
      );
    }
    if (this.customAudio) {
      this.customAudio.volume = Math.min(1, this.settings.bgmVolume * 0.9);
    }

    if (this.settings.bgm) {
      this.startBgm();
    } else {
      this.stopBgm();
    }
  }

  /**
   * 设置/替换 BGM 音源。传入 Object URL。
   * 音乐文件由 MusicLibrary + IndexedDB 管理，AudioManager 只负责播放。
   */
  setBgmTrack(url) {
    if (url === this.bgmUrl && this.customAudio) return;
    this.stopBgm();
    this.bgmUrl = url;
    this.bgmFailed = false;

    if (!url) {
      this.customAudio = null;
      return;
    }

    try {
      this.customAudio = new Audio(url);
      this.customAudio.loop = true;
      this.customAudio.preload = 'auto';
      this.customAudio.volume = Math.min(1, this.settings.bgmVolume * 0.9);
      this.customAudio.addEventListener('error', () => {
        this.bgmFailed = true;
        this.stopBgm();
      });

      if (this.settings.bgm) this.startBgm();
    } catch {
      this.customAudio = null;
      this.bgmFailed = true;
    }
  }

  startBgm() {
    if (!this.settings.bgm || !this.customAudio || this.bgmFailed) return;
    this.customAudio.volume = Math.min(1, this.settings.bgmVolume * 0.9);
    this.customAudio.play().catch(() => {
      // 自动播放被拦截：下一次用户手势后 applySettings/unlock 会再试
    });
  }

  stopBgm() {
    if (this.customAudio) this.customAudio.pause();
  }

  clearBgmTrack() {
    this.stopBgm();
    this.customAudio = null;
    this.bgmUrl = null;
  }

  playClick() {
    if (!this.canPlaySfx()) return;
    const now = this.ctx.currentTime;
    const pitch = 0.96 + Math.random() * 0.08;

    // 更接近手指摩擦/木质轻触的短气声，不再用可辨认的音高
    this.noiseSweep({
      startFrequency: 1100 * pitch,
      endFrequency: 360,
      duration: 0.055,
      level: 0.021,
      q: 0.85,
      when: now
    });
    this.tone({
      frequency: 112,
      endFrequency: 82,
      duration: 0.05,
      type: 'sine',
      level: 0.011,
      when: now
    });
  }

  playClear() {
    if (!this.canPlaySfx()) return;
    const now = this.ctx.currentTime;

    // 空气感的上扬“呼”声，取代原来的双音泡泡
    this.noiseSweep({
      startFrequency: 900,
      endFrequency: 260,
      duration: 0.2,
      level: 0.02,
      q: 1.15,
      when: now
    });
    this.tone({
      frequency: 210,
      endFrequency: 138,
      duration: 0.18,
      type: 'sine',
      level: 0.014,
      when: now
    });
  }

  playThud() {
    if (!this.canPlaySfx()) return;
    const now = this.ctx.currentTime;

    // 低频闷响，加上一小段很暗的噪声，避免刺耳
    this.tone({
      frequency: 105,
      endFrequency: 42,
      duration: 0.24,
      type: 'sine',
      level: 0.11,
      when: now
    });
    this.tone({
      frequency: 68,
      endFrequency: 34,
      duration: 0.2,
      type: 'triangle',
      level: 0.075,
      when: now
    });
    this.noiseSweep({
      startFrequency: 260,
      endFrequency: 90,
      duration: 0.16,
      level: 0.035,
      q: 0.7,
      when: now
    });
  }

  playKey() {
    if (!this.canPlaySfx()) return;
    const now = this.ctx.currentTime;

    // 空气闪烁 + 两个柔和泛音，不再播上行音阶
    this.noiseSweep({
      startFrequency: 600,
      endFrequency: 2700,
      duration: 0.22,
      level: 0.014,
      q: 1.7,
      when: now
    });
    this.tone({
      frequency: 880,
      duration: 0.42,
      type: 'sine',
      level: 0.011,
      when: now
    });
    this.tone({
      frequency: 1320,
      duration: 0.3,
      type: 'sine',
      level: 0.006,
      when: now + 0.018
    });
  }

  playHint() {
    if (!this.canPlaySfx()) return;
    const now = this.ctx.currentTime;
    this.noiseSweep({
      startFrequency: 760,
      endFrequency: 360,
      duration: 0.075,
      level: 0.012,
      q: 1,
      when: now
    });
    this.tone({
      frequency: 523,
      endFrequency: 470,
      duration: 0.13,
      type: 'sine',
      level: 0.009,
      when: now
    });
  }

  playWin() {
    if (!this.canPlaySfx()) return;
    const now = this.ctx.currentTime;
    // 柔和的和弦铺底 + 气声，而不是四个音依次叮咚
    this.noiseSweep({
      startFrequency: 700,
      endFrequency: 1500,
      duration: 0.45,
      level: 0.014,
      q: 1.2,
      when: now
    });
    [392, 523.25, 659.25].forEach((frequency) => {
      this.tone({
        frequency,
        duration: 0.75,
        type: 'sine',
        level: 0.013,
        when: now
      });
    });
  }

  canPlaySfx() {
    return Boolean(
      this.unlocked &&
        this.settings.sfx &&
        this.ctx &&
        this.sfxGain &&
        this.ctx.state !== 'suspended'
    );
  }

  tone({ frequency, endFrequency = frequency, duration = 0.1, type = 'sine', level = 0.04, when }) {
    if (!this.ctx || !this.sfxGain) return;
    const start = when ?? this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      start + duration
    );

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(this.sfxGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  noiseSweep({
    startFrequency,
    endFrequency,
    duration,
    level,
    q = 1,
    when
  }) {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const start = when ?? this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(40, startFrequency), start);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, endFrequency),
      start + duration
    );

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  createReverbImpulse() {
    const length = Math.floor(this.ctx.sampleRate * 0.38);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const decay = Math.pow(1 - index / length, 3.2);
      data[index] = (Math.random() * 2 - 1) * decay;
    }
    return buffer;
  }

  createNoiseBuffer() {
    const length = Math.floor(this.ctx.sampleRate * 0.3);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  dispose() {
    this.stopBgm();
    this.customAudio = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
