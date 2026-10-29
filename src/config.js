/**
 * 全局可调参数。
 * 颜色、棋盘尺寸、动画时长、碰撞容差、默认设置等集中在这里。
 */
export const CONFIG = Object.freeze({
  /**
   * Canvas 主题调色板。
   * DOM 的明暗主题在 styles.css 里通过 [data-theme] 控制；
   * 这里专门负责 Canvas 背景、棋盘、线段和箭头。
   */
  themes: {
    dark: {
      backgroundTop: '#07101d',
      backgroundMid: '#050a14',
      backgroundBottom: '#03060d',
      ambientA: 'rgba(43, 183, 170, 0.09)',
      ambientB: 'rgba(86, 74, 191, 0.07)',
      dot: 'rgba(133, 177, 223, 0.11)',
      dotStrong: 'rgba(153, 209, 255, 0.16)',
      orbit: 'rgba(123, 191, 226, 0.065)',
      tick: 'rgba(123, 191, 226, 0.1)',
      vignette: 'rgba(0, 0, 0, 0.58)',
      vignetteMid: 'rgba(0, 0, 0, 0.12)',
      boardFill: 'rgba(7, 14, 27, 0.72)',
      boardBorder: 'rgba(140, 183, 220, 0.14)',
      boardTopGlow: 'rgba(126, 208, 236, 0.035)',
      boardShadow: 'rgba(58, 146, 180, 0.14)',
      gridMinor: 'rgba(139, 189, 224, 0.055)',
      gridMajor: 'rgba(139, 189, 224, 0.1)',
      corner: 'rgba(133, 198, 228, 0.3)',
      lineIdle: '#c9d6e8',
      lineArrow: '#dce7f7',
      lineHalo: 'rgba(122, 190, 222, 0.045)',
      baseGlow: 'rgba(104, 202, 226, 0.32)',
      arrowShadow: 'rgba(180, 225, 245, 0.25)',
      accent: '#5df2d0',
      hint: '#ffd166',
      danger: '#ff5d78',
      core: '#f0fffc',
      metaTheme: '#050912'
    },
    light: {
      backgroundTop: '#eef4fb',
      backgroundMid: '#e7eef7',
      backgroundBottom: '#dce6f2',
      ambientA: 'rgba(67, 184, 169, 0.1)',
      ambientB: 'rgba(126, 141, 218, 0.09)',
      dot: 'rgba(70, 100, 135, 0.16)',
      dotStrong: 'rgba(50, 80, 115, 0.22)',
      orbit: 'rgba(70, 100, 135, 0.09)',
      tick: 'rgba(70, 100, 135, 0.15)',
      vignette: 'rgba(121, 143, 168, 0.24)',
      vignetteMid: 'rgba(121, 143, 168, 0.06)',
      boardFill: 'rgba(255, 255, 255, 0.76)',
      boardBorder: 'rgba(60, 89, 120, 0.2)',
      boardTopGlow: 'rgba(255, 255, 255, 0.4)',
      boardShadow: 'rgba(65, 92, 120, 0.12)',
      gridMinor: 'rgba(70, 100, 135, 0.08)',
      gridMajor: 'rgba(70, 100, 135, 0.14)',
      corner: 'rgba(70, 100, 135, 0.35)',
      lineIdle: '#52647a',
      lineArrow: '#3f5168',
      lineHalo: 'rgba(80, 110, 140, 0.07)',
      baseGlow: 'rgba(80, 110, 140, 0.2)',
      arrowShadow: 'rgba(80, 110, 140, 0.18)',
      accent: '#0b8f78',
      hint: '#b7791f',
      danger: '#d92b47',
      core: '#f7fffc',
      metaTheme: '#eaf0f8'
    }
  },

  board: {
    // 棋盘的逻辑尺寸：35 × 54 格，每格 24 世界像素
    cols: 35,
    rows: 54,
    cell: 24,
    // 线段端点离棋盘边缘至少保留 1 格
    gridMargin: 1,
    // 整条线飞出棋盘边缘后再额外移动的距离
    exitMargin: 52,
    padding: 12
  },

  line: {
    defaultWidth: 7,
    arrowLength: 12.5,
    arrowWidth: 7.5,
    hitToleranceMouse: 13,
    hitToleranceTouch: 22
  },

  collision: {
    // 两根线中心的距离小于两根线半宽之和 + padding 即视为接触
    padding: 0.8
  },

  animation: {
    // 蛇形抽离的速度：慢一点更容易看清折角逐节被拉直
    slideOutSpeed: 1150,
    slideOutMinMs: 420,
    slideOutMaxMs: 900,
    blockedApproachMs: 170,
    bounceMs: 360,
    hintFlashMs: 3200,
    reducedMotionMs: 180
  },

  camera: {
    minZoom: 0.72,
    maxZoom: 3.2,
    wheelStep: 0.0016,
    fitInset: { top: 8, right: 18, bottom: 8, left: 18 },
    panOverscroll: 26
  },

  defaults: {
    lives: 3,
    hints: 3,
    timeLimitMinutes: 6,
    // 不再默认播放内置合成音乐；由玩家在设置里选择本地音乐
    bgm: true,
    bgmVolume: 0.4,
    musicTrackId: null,
    sfx: true,
    sfxVolume: 0.45,
    guides: false,
    theme: 'dark'
  },

  maxStepValue: 99,

  /** 渲染帧间隔上限，避免切回标签页时出现“瞬移”。 */
  maxDeltaSeconds: 0.05
});

export const DIRECTIONS = Object.freeze({
  right: Object.freeze({ x: 1, y: 0 }),
  left: Object.freeze({ x: -1, y: 0 }),
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 })
});

export const STORAGE_KEYS = Object.freeze({
  settings: 'arrowMaze.settings.v1',
  level: 'arrowMaze.level.v1',
  tutorial: 'arrowMaze.tutorial.v1',
  clears: 'arrowMaze.clears.v1'
});
