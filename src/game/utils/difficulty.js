/**
 * 限时规则。
 *
 * 关卡越高、箭头越多，给出的时间越长；但时间仍然是有限制的，
 * 不能无限拖关。基础 120 秒，每升一关 +15 秒，每条箭头再补 0.2 秒。
 */
export function calculateTimeLimit(levelNumber, lineCount) {
  const level = Math.max(1, Math.floor(Number(levelNumber) || 1));
  const lines = Math.max(1, Math.floor(Number(lineCount) || 1));
  return Math.round(120 + (level - 1) * 15 + lines * 0.2);
}

/**
 * 关卡难度曲线：前期每两关少一条安全线，最终最多保留 3 条。
 * 安全线越少，玩家越需要先拆依赖链，而不是无脑点。
 */
export function getFreeLineTarget(levelNumber) {
  const level = Math.max(1, Math.floor(Number(levelNumber) || 1));
  return Math.max(3, 8 - Math.ceil((level - 1) / 2));
}

/** 后期线条更长、拐弯更多，保证难度继续增加。 */
export function getSegmentBoost(levelNumber) {
  const level = Math.max(1, Math.floor(Number(levelNumber) || 1));
  return Math.min(4, Math.floor((level - 1) / 2));
}

/** 把秒数格式化为 02:20 这样的倒计时文本。 */
export function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}
