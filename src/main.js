import { Game } from './game/Game.js';

const canvas = document.querySelector('#game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('找不到 #game 画布。');
}

const ui = {
  levelValue: document.querySelector('#levelValue'),
  hearts: document.querySelector('#hearts'),
  remainingLabel: document.querySelector('#remainingLabel'),
  timerLabel: document.querySelector('#timerLabel'),
  timerValue: document.querySelector('#timerValue'),
  settingsBtn: document.querySelector('#settingsBtn'),
  guideEyeBtn: document.querySelector('#guideEyeBtn'),
  musicBtn: document.querySelector('#musicBtn'),
  musicToolBtn: document.querySelector('#musicToolBtn'),
  musicToolState: document.querySelector('#musicToolState'),
  restartBtn: document.querySelector('#restartBtn'),
  hintBtn: document.querySelector('#hintBtn'),
  hintCount: document.querySelector('#hintCount'),
  guideBtn: document.querySelector('#guideBtn'),
  zoomSlider: document.querySelector('#zoomSlider'),
  zoomOutBtn: document.querySelector('#zoomOutBtn'),
  zoomInBtn: document.querySelector('#zoomInBtn'),
  toast: document.querySelector('#toast'),
  damageFlash: document.querySelector('#damageFlash'),
  liveStatus: document.querySelector('#liveStatus'),

  settingsDialog: document.querySelector('#settingsDialog'),
  settingsCloseBtn: document.querySelector('#settingsCloseBtn'),
  settingsDoneBtn: document.querySelector('#settingsDoneBtn'),
  livesInput: document.querySelector('#livesInput'),
  hintsInput: document.querySelector('#hintsInput'),
  timeLimitInput: document.querySelector('#timeLimitInput'),
  clearCount: document.querySelector('#clearCount'),
  bgmToggle: document.querySelector('#bgmToggle'),
  bgmVolume: document.querySelector('#bgmVolume'),
  bgmVolumeRow: document.querySelector('#bgmVolumeRow'),
  sfxToggle: document.querySelector('#sfxToggle'),
  sfxVolume: document.querySelector('#sfxVolume'),
  sfxVolumeRow: document.querySelector('#sfxVolumeRow'),
  pickMusicBtn: document.querySelector('#pickMusicBtn'),
  pickMusicFolderBtn: document.querySelector('#pickMusicFolderBtn'),
  musicFileInput: document.querySelector('#musicFileInput'),
  musicFolderInput: document.querySelector('#musicFolderInput'),
  musicTrackSelect: document.querySelector('#musicTrackSelect'),
  removeMusicBtn: document.querySelector('#removeMusicBtn'),
  musicLibraryHint: document.querySelector('#musicLibraryHint'),
  guidesToggle: document.querySelector('#guidesToggle'),
  resetProgressBtn: document.querySelector('#resetProgressBtn'),

  resultDialog: document.querySelector('#resultDialog'),
  resultIcon: document.querySelector('#resultIcon'),
  resultKicker: document.querySelector('#resultKicker'),
  resultTitle: document.querySelector('#resultTitle'),
  resultText: document.querySelector('#resultText'),
  resultPrimaryBtn: document.querySelector('#resultPrimaryBtn'),
  resultSecondaryBtn: document.querySelector('#resultSecondaryBtn')
};

try {
  const game = new Game(canvas, ui);
  game.start();

  // 调试入口；不参与游戏逻辑。
  window.__arrowMaze = game;

  window.addEventListener('beforeunload', () => game.destroy());
} catch (error) {
  console.error(error);
  const message = document.createElement('div');
  message.style.cssText =
    'position:fixed;inset:auto 16px 16px;padding:14px 16px;border:1px solid rgba(255,93,120,.4);border-radius:12px;background:#0b1220;color:#ffd7dd;font:13px/1.5 sans-serif;z-index:99';
  message.textContent = `游戏启动失败：${error instanceof Error ? error.message : String(error)}`;
  document.body.appendChild(message);
}
