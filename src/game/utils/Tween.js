/**
 * 极简 Tween 实现。
 * 不引入第三方补间库，后续的碰撞回弹、镜头缩放也可以复用。
 */
export const Easing = Object.freeze({
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
});

export class Tween {
  /**
   * @param {object} options
   * @param {number} options.from 起始值
   * @param {number} options.to 目标值
   * @param {number} options.duration 时长（毫秒）
   * @param {(t: number) => number} [options.easing]
   * @param {(value: number, progress: number) => void} [options.onUpdate]
   * @param {() => void} [options.onComplete]
   */
  constructor({ from = 0, to = 1, duration = 300, easing = Easing.linear, onUpdate, onComplete }) {
    this.from = from;
    this.to = to;
    this.duration = Math.max(0, duration);
    this.easing = easing;
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.elapsed = 0;
    this.value = from;
    this.progress = 0;
    this.finished = false;
  }

  update(deltaMs) {
    if (this.finished) return;
    this.elapsed = Math.min(this.duration, this.elapsed + deltaMs);
    this.progress = this.duration === 0 ? 1 : this.elapsed / this.duration;

    const eased = this.easing(this.progress);
    this.value = this.from + (this.to - this.from) * eased;
    this.onUpdate?.(this.value, this.progress);

    if (this.progress >= 1) {
      this.finished = true;
      this.value = this.to;
      this.onComplete?.();
    }
  }
}
