import { CONFIG, STORAGE_KEYS } from '../config.js';
import { Camera2D } from './Camera2D.js';
import { ArrowLine } from './entities/ArrowLine.js';
import { AudioManager } from './audio/AudioManager.js';
import { MusicLibrary } from './audio/MusicLibrary.js';
import { BackgroundRenderer } from './render/BackgroundRenderer.js';
import { BoardRenderer } from './render/BoardRenderer.js';
import { LineRenderer } from './render/LineRenderer.js';
import { CollisionSystem } from './systems/CollisionSystem.js';
import { generateLevel } from './systems/LevelGenerator.js';
import { clamp } from './utils/geometry.js';
import {
  calculateTimeLimit,
  formatTime,
  getKeyDependencyThreshold
} from './utils/difficulty.js';

const HEART_PATH =
  'M12 21s-7.5-4.6-9.7-9.1C.7 8.5 2.4 5 5.8 4.4 8 4 10 5.2 12 7.2c2-2 4-3.2 6.2-2.8 3.4.6 5.1 4.1 3.5 7.5C19.5 16.4 12 21 12 21Z';

const TAP_THRESHOLD_PX = 7;

/**
 * 游戏主类：关卡、输入、摄像机、碰撞、生命、提示、设置、音效与渲染循环。
 */
export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('当前浏览器不支持 Canvas 2D。');

    this.ui = ui;
    this.settings = loadSettings();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.audio = new AudioManager(this.settings);
    this.musicLibrary = new MusicLibrary();
    this.musicTracks = [];
    this.activeMusicTrackId = null;
    this.musicObjectUrl = null;
    this.musicLoading = false;
    this.camera = new Camera2D();
    this.collision = new CollisionSystem();
    this.theme = this.settings.theme === 'light' ? 'light' : 'dark';
    this.palette = CONFIG.themes[this.theme];
    this.backgroundRenderer = new BackgroundRenderer();
    this.boardRenderer = new BoardRenderer();
    this.lineRenderer = new LineRenderer();

    this.view = { width: 1, height: 1, dpr: 1 };
    this.board = null;
    this.levelData = null;
    this.lines = [];
    this.levelNumber = loadLevelNumber();
    this.totalClears = loadClearCount();
    this.totalLines = 0;
    this.remaining = 0;

    this.maxLives = normalizeLives(this.settings.lives);
    this.lives = this.maxLives === -1 ? Infinity : this.maxLives;
    this.hintsRemaining = normalizeHints(this.settings.hints);
    this.guides = Boolean(this.settings.guides);

    this.busy = false;
    this.gameOver = false;
    this.levelComplete = false;
    this.resultMode = 'clear';
    this.pendingResultReopen = false;

    this.running = false;
    this.elapsed = 0;
    this.lastFrameTime = 0;
    this.rafId = 0;
    this.resizeRafId = 0;
    this.toastTimer = 0;
    this.hintTimer = 0;
    this.resultTimer = 0;
    this.timeLimit = 0;
    this.timeRemaining = 0;
    this.lastTimerSecond = null;
    this.timerLow = false;
    this.timerStarted = false;
    this.timedOut = false;
    this.keyThreshold = 2;
    this.keyStartCount = 0;
    this.safeStartCount = 0;
    this.shortStartCount = 0;

    this.activePointers = new Map();
    this.gesture = null;
    this.pinch = null;
    this.hoveredLine = null;
    this.pressedLine = null;
    this.hintLine = null;

    // 统一保存事件引用，destroy() 时可完整解绑
    this.handleFrame = this.handleFrame.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleFirstGesture = this.handleFirstGesture.bind(this);

    this.handleSettingsBtn = this.handleSettingsBtn.bind(this);
    this.handleSettingsCloseBtn = this.handleSettingsCloseBtn.bind(this);
    this.handleSettingsDone = this.handleSettingsDone.bind(this);
    this.handleSettingsClosed = this.handleSettingsClosed.bind(this);
    this.handleSettingsChanged = this.handleSettingsChanged.bind(this);
    this.handleVolumeInput = this.handleVolumeInput.bind(this);
    this.handleStepButton = this.handleStepButton.bind(this);
    this.handleResetProgress = this.handleResetProgress.bind(this);
    this.handleHint = this.handleHint.bind(this);
    this.handleGuideToggle = this.handleGuideToggle.bind(this);
    this.handleMusicToggle = this.handleMusicToggle.bind(this);
    this.handlePickMusic = this.handlePickMusic.bind(this);
    this.handlePickMusicFolder = this.handlePickMusicFolder.bind(this);
    this.handleMusicFiles = this.handleMusicFiles.bind(this);
    this.handleMusicSelect = this.handleMusicSelect.bind(this);
    this.handleRemoveMusic = this.handleRemoveMusic.bind(this);
    this.handleThemeChoice = this.handleThemeChoice.bind(this);
    this.handleRestart = this.handleRestart.bind(this);
    this.handleZoomInput = this.handleZoomInput.bind(this);
    this.handleZoomOut = this.handleZoomOut.bind(this);
    this.handleZoomIn = this.handleZoomIn.bind(this);
    this.handleResultPrimary = this.handleResultPrimary.bind(this);
    this.handleResultSecondary = this.handleResultSecondary.bind(this);
    this.handleResultCancel = this.handleResultCancel.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
  }

  get modalOpen() {
    return Boolean(this.ui.settingsDialog?.open || this.ui.resultDialog?.open);
  }

  start() {
    if (this.running) return;
    this.applyTheme(this.theme, { persist: false });
    this.bindEvents();
    this.resize();
    this.loadLevel(this.levelNumber, { announce: true });
    this.applyAudioSettings();
    this.initMusicLibrary();
    this.running = true;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.handleFrame);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    cancelAnimationFrame(this.resizeRafId);
    clearTimeout(this.toastTimer);
    clearTimeout(this.hintTimer);
    clearTimeout(this.resultTimer);

    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('pointerdown', this.handleFirstGesture, true);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', preventDefault);

    this.ui.settingsBtn?.removeEventListener('click', this.handleSettingsBtn);
    this.ui.settingsCloseBtn?.removeEventListener('click', this.handleSettingsCloseBtn);
    this.ui.settingsDoneBtn?.removeEventListener('click', this.handleSettingsDone);
    this.ui.settingsDialog?.removeEventListener('close', this.handleSettingsClosed);
    this.ui.livesInput?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.hintsInput?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.timeLimitInput?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.bgmToggle?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.sfxToggle?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.guidesToggle?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.bgmVolume?.removeEventListener('input', this.handleVolumeInput);
    this.ui.sfxVolume?.removeEventListener('input', this.handleVolumeInput);
    this.ui.bgmVolume?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.sfxVolume?.removeEventListener('change', this.handleSettingsChanged);
    this.ui.pickMusicBtn?.removeEventListener('click', this.handlePickMusic);
    this.ui.pickMusicFolderBtn?.removeEventListener('click', this.handlePickMusicFolder);
    this.ui.musicFileInput?.removeEventListener('change', this.handleMusicFiles);
    this.ui.musicFolderInput?.removeEventListener('change', this.handleMusicFiles);
    this.ui.musicTrackSelect?.removeEventListener('change', this.handleMusicSelect);
    this.ui.removeMusicBtn?.removeEventListener('click', this.handleRemoveMusic);
    this.ui.resetProgressBtn?.removeEventListener('click', this.handleResetProgress);
    this.ui.hintBtn?.removeEventListener('click', this.handleHint);
    this.ui.guideBtn?.removeEventListener('click', this.handleGuideToggle);
    this.ui.guideEyeBtn?.removeEventListener('click', this.handleGuideToggle);
    this.ui.musicBtn?.removeEventListener('click', this.handleMusicToggle);
    this.ui.musicToolBtn?.removeEventListener('click', this.handleMusicToggle);
    this.ui.restartBtn?.removeEventListener('click', this.handleRestart);
    this.ui.zoomSlider?.removeEventListener('input', this.handleZoomInput);
    this.ui.zoomOutBtn?.removeEventListener('click', this.handleZoomOut);
    this.ui.zoomInBtn?.removeEventListener('click', this.handleZoomIn);
    this.ui.resultPrimaryBtn?.removeEventListener('click', this.handleResultPrimary);
    this.ui.resultSecondaryBtn?.removeEventListener('click', this.handleResultSecondary);
    this.ui.resultDialog?.removeEventListener('cancel', this.handleResultCancel);

    this.stepButtons = this.ui.settingsDialog?.querySelectorAll('[data-step-target]') || [];
    for (const button of this.stepButtons) {
      button.removeEventListener('click', this.handleStepButton);
    }

    this.themeButtons = document.querySelectorAll('[data-theme-choice]');
    for (const button of this.themeButtons) {
      button.removeEventListener('click', this.handleThemeChoice);
    }

    if (this.musicObjectUrl) {
      URL.revokeObjectURL(this.musicObjectUrl);
      this.musicObjectUrl = null;
    }
    this.audio.dispose();
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', preventDefault);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('resize', this.handleResize, { passive: true });
    document.addEventListener('pointerdown', this.handleFirstGesture, {
      capture: true,
      passive: true
    });
    document.addEventListener('visibilitychange', this.handleVisibility);

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.canvas);
    }

    this.ui.settingsBtn?.addEventListener('click', this.handleSettingsBtn);
    this.ui.settingsCloseBtn?.addEventListener('click', this.handleSettingsCloseBtn);
    this.ui.settingsDoneBtn?.addEventListener('click', this.handleSettingsDone);
    this.ui.settingsDialog?.addEventListener('close', this.handleSettingsClosed);
    this.ui.livesInput?.addEventListener('change', this.handleSettingsChanged);
    this.ui.hintsInput?.addEventListener('change', this.handleSettingsChanged);
    this.ui.timeLimitInput?.addEventListener('change', this.handleSettingsChanged);
    this.ui.bgmToggle?.addEventListener('change', this.handleSettingsChanged);
    this.ui.sfxToggle?.addEventListener('change', this.handleSettingsChanged);
    this.ui.guidesToggle?.addEventListener('change', this.handleSettingsChanged);
    this.ui.bgmVolume?.addEventListener('input', this.handleVolumeInput);
    this.ui.sfxVolume?.addEventListener('input', this.handleVolumeInput);
    this.ui.bgmVolume?.addEventListener('change', this.handleSettingsChanged);
    this.ui.sfxVolume?.addEventListener('change', this.handleSettingsChanged);
    this.ui.pickMusicBtn?.addEventListener('click', this.handlePickMusic);
    this.ui.pickMusicFolderBtn?.addEventListener('click', this.handlePickMusicFolder);
    this.ui.musicFileInput?.addEventListener('change', this.handleMusicFiles);
    this.ui.musicFolderInput?.addEventListener('change', this.handleMusicFiles);
    this.ui.musicTrackSelect?.addEventListener('change', this.handleMusicSelect);
    this.ui.removeMusicBtn?.addEventListener('click', this.handleRemoveMusic);
    this.ui.resetProgressBtn?.addEventListener('click', this.handleResetProgress);
    this.ui.hintBtn?.addEventListener('click', this.handleHint);
    this.ui.guideBtn?.addEventListener('click', this.handleGuideToggle);
    this.ui.guideEyeBtn?.addEventListener('click', this.handleGuideToggle);
    this.ui.musicBtn?.addEventListener('click', this.handleMusicToggle);
    this.ui.musicToolBtn?.addEventListener('click', this.handleMusicToggle);
    this.ui.restartBtn?.addEventListener('click', this.handleRestart);
    this.ui.zoomSlider?.addEventListener('input', this.handleZoomInput);
    this.ui.zoomOutBtn?.addEventListener('click', this.handleZoomOut);
    this.ui.zoomInBtn?.addEventListener('click', this.handleZoomIn);
    this.ui.resultPrimaryBtn?.addEventListener('click', this.handleResultPrimary);
    this.ui.resultSecondaryBtn?.addEventListener('click', this.handleResultSecondary);
    this.ui.resultDialog?.addEventListener('cancel', this.handleResultCancel);

    this.stepButtons = this.ui.settingsDialog?.querySelectorAll('[data-step-target]') || [];
    for (const button of this.stepButtons) {
      button.addEventListener('click', this.handleStepButton);
    }

    this.themeButtons = document.querySelectorAll('[data-theme-choice]');
    for (const button of this.themeButtons) {
      button.addEventListener('click', this.handleThemeChoice);
    }
    this.syncThemeButtons();
  }

  /* ------------------------------------------------------------------ */
  /* 关卡                                                                 */
  /* ------------------------------------------------------------------ */

  loadLevel(levelNumber, { announce = true } = {}) {
    clearTimeout(this.hintTimer);
    clearTimeout(this.resultTimer);
    this.hintTimer = 0;
    this.resultTimer = 0;

    const data = generateLevel(levelNumber);
    this.levelData = data;
    this.levelNumber = data.level;
    this.board = data.board;
    this.totalLines = data.lines.length;
    this.remaining = data.lines.length;
    this.timeLimit = calculateTimeLimit(
      this.levelNumber,
      this.totalLines,
      this.settings.timeLimitMinutes
    );
    this.timeRemaining = this.timeLimit;
    this.timerStarted = false;
    this.timedOut = false;
    this.lastTimerSecond = null;
    this.timerLow = false;
    this.updateTimerDisplay(true);
    this.lines = data.lines.map(
      (line) =>
        new ArrowLine({
          id: line.id,
          points: line.points,
          direction: line.direction,
          axis: line.axis,
          width: line.width
        })
    );

    this.keyThreshold =
      data.keyThreshold ?? getKeyDependencyThreshold(this.levelNumber);
    this.buildDependencyMap();
    this.safeStartCount = this.lines.filter(
      (line) => line.blockers.length === 0
    ).length;
    this.keyStartCount = this.lines.filter(
      (line) =>
        line.blockers.length === 0 &&
        this.countDependents(line) >= this.keyThreshold
    ).length;
    this.shortStartCount = this.lines.filter(
      (line) => line.points.length <= 5
    ).length;

    this.maxLives = normalizeLives(this.settings.lives);
    this.lives = this.maxLives === -1 ? Infinity : this.maxLives;
    this.hintsRemaining = normalizeHints(this.settings.hints);
    this.guides = Boolean(this.settings.guides);

    this.busy = false;
    this.gameOver = false;
    this.levelComplete = false;
    this.timerStarted = false;
    this.timedOut = false;
    this.pendingResultReopen = false;
    this.pressedLine = null;
    this.hoveredLine = null;
    this.hintLine = null;
    this.activePointers.clear();
    this.gesture = null;
    this.pinch = null;

    this.closeResult();
    this.camera.setBoard(this.board);
    this.saveProgress(this.levelNumber);
    this.audio.setLevelTrack(this.levelNumber);
    this.updateHUD();
    this.syncZoomUI();
    this.setCanvasCursor('grab');

    this.ui.liveStatus.textContent = `第 ${this.levelNumber} 关，共 ${this.totalLines} 条箭头，安全点 ${this.safeStartCount}，关键点 ${this.keyStartCount}，短线 ${this.shortStartCount}，生命 ${this.describeLives()}`;

    if (announce) {
      if (!readTutorialFlag()) {
        writeTutorialFlag();
        this.showToast('点击箭头清除 · 拖动平移 · 双指缩放', '', 3000);
      } else {
        this.showToast(
          `第 ${this.levelNumber} 关 · 安全点 ${this.safeStartCount} · 关键点 ${this.keyStartCount} · 短线 ${this.shortStartCount}`,
          '',
          1800
        );
      }
    }
  }

  buildDependencyMap() {
    for (const line of this.lines) {
      line.blockers = this.collision.findRayBlockers(line, this.lines, 3600);
    }
  }

  /**
   * 这条线直接挡住了多少条其他线的路径。
   * 数值越高，清掉它带来的依赖影响越大。
   */
  countDependents(line) {
    let count = 0;
    for (const other of this.lines) {
      if (other === line || other.cleared) continue;
      if (other.blockers?.includes(line)) count += 1;
    }
    return count;
  }

  showKeyBurst(line, unlockCount) {
    const layer = this.ui.keyBurstLayer;
    if (!layer) return;

    const tip = line.points[line.points.length - 1];
    const screen = this.camera.worldToScreen(tip);
    const rect = this.canvas.getBoundingClientRect();
    const x = clamp(rect.left + screen.x, 70, window.innerWidth - 70);
    const y = clamp(rect.top + screen.y, 90, window.innerHeight - 80);

    const element = document.createElement('div');
    element.className = `key-burst${unlockCount >= 5 ? ' is-mega' : ''}`;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;

    const icon = document.createElement('span');
    icon.className = 'key-burst-icon';
    icon.textContent = '✦';

    const count = document.createElement('span');
    count.className = 'key-burst-count';
    count.textContent = `+${unlockCount}`;

    element.title = `关键突破：影响 ${unlockCount} 条`;
    element.append(icon, count);
    layer.append(element);

    const remove = () => element.remove();
    if (this.reducedMotion) {
      // 减少动态偏好下不做放大/上浮，但仍保留清晰的文字反馈
      element.style.animation = 'none';
      element.style.opacity = '1';
      element.style.transform = 'translate(-50%, -50%) scale(1)';
      window.setTimeout(remove, 950);
    } else {
      element.addEventListener('animationend', remove, { once: true });
      window.setTimeout(remove, 1300);
    }
  }

  restartLevel() {
    this.loadLevel(this.levelNumber, { announce: false });
    this.showToast('本关已重新开始', '', 1300);
  }

  nextLevel() {
    this.loadLevel(this.levelNumber + 1, { announce: true });
  }

  /* ------------------------------------------------------------------ */
  /* 限时                                                                 */
  /* ------------------------------------------------------------------ */

  updateTimerDisplay(force = false) {
    if (!this.ui.timerValue) return;
    const seconds = Math.max(0, Math.ceil(this.timeRemaining));
    const isLow = seconds > 0 && seconds <= 20;
    if (this.ui.timerLabel) {
      this.ui.timerLabel.classList.toggle('is-low', isLow);
    }

    if (!force && seconds === this.lastTimerSecond) return;
    this.lastTimerSecond = seconds;
    this.timerLow = isLow;
    this.ui.timerValue.textContent = formatTime(seconds);
    if (this.ui.timerLabel) {
      this.ui.timerLabel.setAttribute(
        'aria-label',
        this.timerStarted
          ? `剩余时间 ${formatTime(seconds)}`
          : `剩余时间 ${formatTime(seconds)}，点击画面开始计时`
      );
    }
  }

  startTimer() {
    if (
      this.timerStarted ||
      this.timedOut ||
      this.gameOver ||
      this.levelComplete
    ) {
      return;
    }
    this.timerStarted = true;
    this.lastTimerSecond = null;
    this.updateTimerDisplay(true);
  }

  tickTimer(deltaSeconds) {
    if (
      !this.timerStarted ||
      this.timedOut ||
      this.gameOver ||
      this.levelComplete ||
      this.modalOpen ||
      document.hidden
    ) {
      return;
    }

    this.timeRemaining = Math.max(0, this.timeRemaining - deltaSeconds);
    this.updateTimerDisplay();

    if (this.timeRemaining <= 0) {
      this.handleTimeUp();
    }
  }

  handleTimeUp() {
    if (this.timedOut || this.gameOver || this.levelComplete) return;

    this.timedOut = true;
    this.busy = false;
    this.clearHint();
    this.cancelPendingPress();
    this.hoveredLine?.setHovered(false);
    this.hoveredLine = null;
    this.pressedLine?.setPressed(false);
    this.pressedLine = null;
    this.setCanvasCursor('grab');
    this.updateTimerDisplay(true);
    this.updateHUD();
    this.ui.liveStatus.textContent = '时间到';
    this.showToast('时间到', 'is-danger', 1400);

    clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => this.showResult('timeout'), 320);
  }

  saveProgress(level) {
    try {
      localStorage.setItem(STORAGE_KEYS.level, String(level));
    } catch {
      // 隐私模式下 localStorage 可能不可用，忽略即可
    }
  }

  /* ------------------------------------------------------------------ */
  /* 输入：点击 / 拖动 / 双指缩放                                          */
  /* ------------------------------------------------------------------ */

  handleFirstGesture() {
    this.audio.unlock();
    this.audio.applySettings(this.settings);
  }

  handlePointerDown(event) {
    if (this.modalOpen) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this.activePointers.size >= 2) return;

    event.preventDefault();
    this.startTimer();
    this.audio.unlock();
    this.canvas.focus({ preventScroll: true });

    const point = this.getScreenPoint(event);
    this.activePointers.set(event.pointerId, point);

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // 忽略不支持指针捕获的合成事件
    }

    if (this.activePointers.size === 2) {
      this.cancelPendingPress();
      this.gesture = null;
      this.startPinch();
      return;
    }

    const line = this.findLineAt(point, event.pointerType);
    this.gesture = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      line,
      moved: false
    };

    if (line) {
      line.setPressed(true);
      this.pressedLine = line;
      this.setCanvasCursor('pointer');
    } else {
      this.setCanvasCursor('grab');
    }
  }

  handlePointerMove(event) {
    const point = this.getScreenPoint(event);

    if (this.activePointers.has(event.pointerId)) {
      this.activePointers.set(event.pointerId, point);
    }

    if (this.pinch) {
      this.updatePinch();
      return;
    }

    if (this.gesture && this.gesture.pointerId === event.pointerId) {
      const gesture = this.gesture;
      const movedDistance = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);

      if (!gesture.moved && movedDistance > TAP_THRESHOLD_PX) {
        gesture.moved = true;
        this.cancelPendingPress();
        this.setCanvasCursor('grabbing');
      }

      if (gesture.moved) {
        this.camera.panBy(point.x - gesture.lastX, point.y - gesture.lastY);
        this.syncZoomUI();
      }

      gesture.lastX = point.x;
      gesture.lastY = point.y;
      return;
    }

    if (this.activePointers.size === 0 && event.pointerType !== 'touch') {
      this.updateHover(point);
    }
  }

  handlePointerUp(event) {
    const point = this.getScreenPoint(event);

    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // 指针可能已被释放
    }

    if (this.pinch) {
      this.activePointers.delete(event.pointerId);
      if (this.activePointers.size < 2) {
        this.pinch = null;
        if (this.activePointers.size === 1) {
          this.beginPanWithRemainingPointer();
        }
      }
      return;
    }

    const gesture = this.gesture;
    this.activePointers.delete(event.pointerId);

    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.gesture = null;

    const isTap =
      !gesture.moved &&
      gesture.line &&
      gesture.line.isIdle &&
      Math.hypot(point.x - gesture.startX, point.y - gesture.startY) <= TAP_THRESHOLD_PX;

    this.cancelPendingPress();

    if (isTap) {
      this.triggerLine(gesture.line);
    } else if (event.pointerType !== 'touch') {
      this.updateHover(point);
    } else {
      this.setCanvasCursor('grab');
    }
  }

  handlePointerCancel(event) {
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // 忽略
    }

    this.activePointers.delete(event.pointerId);
    this.cancelPendingPress();

    if (this.pinch && this.activePointers.size < 2) {
      this.pinch = null;
      if (this.activePointers.size === 1) this.beginPanWithRemainingPointer();
    } else if (this.activePointers.size === 0) {
      this.gesture = null;
      this.pinch = null;
    }
  }

  handlePointerLeave(event) {
    if (this.activePointers.size > 0) return;
    if (event.pointerType === 'touch') return;
    this.hoveredLine?.setHovered(false);
    this.hoveredLine = null;
    this.setCanvasCursor('grab');
  }

  cancelPendingPress() {
    if (this.pressedLine) {
      this.pressedLine.setPressed(false);
      this.pressedLine = null;
    }
  }

  beginPanWithRemainingPointer() {
    const [pointerId, point] = this.activePointers.entries().next().value || [];
    if (pointerId === undefined) {
      this.gesture = null;
      return;
    }
    this.gesture = {
      pointerId,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      line: null,
      moved: true
    };
  }

  startPinch() {
    const points = [...this.activePointers.values()];
    if (points.length < 2) return;

    const midpoint = midpointOf(points[0], points[1]);
    const distance = Math.max(1, distanceBetween(points[0], points[1]));
    const worldAnchor = this.camera.screenToWorld(midpoint);

    this.pinch = {
      startDistance: distance,
      startFactor: this.camera.zoomFactor,
      worldAnchor
    };
    this.cancelPendingPress();
    this.hoveredLine?.setHovered(false);
    this.hoveredLine = null;
    this.setCanvasCursor('grabbing');
  }

  updatePinch() {
    if (!this.pinch) return;
    const points = [...this.activePointers.values()];
    if (points.length < 2) return;

    const midpoint = midpointOf(points[0], points[1]);
    const distance = Math.max(1, distanceBetween(points[0], points[1]));
    const factor =
      this.pinch.startFactor * (distance / Math.max(1, this.pinch.startDistance));

    this.camera.setZoomAroundWorld(factor, this.pinch.worldAnchor, midpoint);
    this.syncZoomUI();
  }

  handleWheel(event) {
    if (this.modalOpen) return;
    event.preventDefault();
    const point = this.getScreenPoint(event);
    const factor = Math.exp(-event.deltaY * CONFIG.camera.wheelStep);
    this.camera.zoomBy(factor, point);
    this.syncZoomUI();
  }

  /** 屏幕坐标 → 世界坐标，优先返回距离最近的空闲线段。 */
  findLineAt(point, pointerType) {
    if (this.busy || this.levelComplete || this.gameOver) return null;

    const world = this.camera.screenToWorld(point);
    const screenTolerance =
      pointerType === 'touch'
        ? CONFIG.line.hitToleranceTouch
        : CONFIG.line.hitToleranceMouse;
    const worldTolerance = screenTolerance / this.camera.scale;

    let bestLine = null;
    let bestDistance = Infinity;

    for (const line of this.lines) {
      if (!line.isIdle) continue;
      const distance = line.getHitDistance(world);
      if (distance <= worldTolerance && distance < bestDistance) {
        bestDistance = distance;
        bestLine = line;
      }
    }
    return bestLine;
  }

  updateHover(point) {
    if (this.modalOpen) return;
    const line = this.findLineAt(point, 'mouse');
    if (this.hoveredLine && this.hoveredLine !== line) {
      this.hoveredLine.setHovered(false);
    }
    if (line) line.setHovered(true);
    this.hoveredLine = line;
    this.setCanvasCursor(line ? 'pointer' : 'grab');
  }

  getScreenPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  setCanvasCursor(cursor) {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  /* ------------------------------------------------------------------ */
  /* 清除 / 碰撞                                                          */
  /* ------------------------------------------------------------------ */

  triggerLine(line) {
    if (!line || !line.isIdle || this.busy || this.modalOpen) return;
    if (this.levelComplete || this.gameOver || this.timedOut) return;

    this.audio.unlock();
    this.audio.applySettings(this.settings);
    this.audio.playClick();

    this.clearHint();
    this.cancelPendingPress();
    this.hoveredLine?.setHovered(false);
    this.hoveredLine = null;
    this.busy = true;
    this.setCanvasCursor('grab');
    this.updateHUD();

    const maxDistance = line.getExitDistance(this.board);
    const others = this.lines.filter((candidate) => candidate !== line && !candidate.cleared);
    const blocking = this.collision.findRayBlock(line, others, maxDistance);

    this.ui.liveStatus.textContent = blocking
      ? '线段的路径被挡住了'
      : `清除 ${line.id}`;

    if (!blocking) {
      line.keyImpact = this.countDependents(line);
      const rawDuration = clamp(
        (maxDistance / CONFIG.animation.slideOutSpeed) * 1000,
        CONFIG.animation.slideOutMinMs,
        CONFIG.animation.slideOutMaxMs
      );
      const duration = this.reducedMotion
        ? Math.min(rawDuration, CONFIG.animation.reducedMotionMs)
        : rawDuration;

      line.startSlide(maxDistance, {
        duration,
        onComplete: () => this.handleLineCleared(line)
      });
      return;
    }

    const approachDuration = this.reducedMotion
      ? 60
      : CONFIG.animation.blockedApproachMs;
    const bounceDuration = this.reducedMotion
      ? 160
      : CONFIG.animation.bounceMs;

    line.hitBlock(blocking.distance, {
      approachDuration,
      bounceDuration,
      onImpact: () => this.handleImpact(line, blocking.line),
      onComplete: () => this.handleBounceDone(line)
    });
  }

  handleLineCleared(line) {
    if (!line || line.cleared !== true) return;
    if (this.timedOut || this.gameOver) return;

    const keyImpact = line.keyImpact ?? 0;
    const isKeyClear = keyImpact >= this.keyThreshold;
    if (isKeyClear) {
      this.showKeyBurst(line, keyImpact);
      this.audio.playKey();
      this.ui.liveStatus.textContent = `关键突破，影响 ${keyImpact} 条`;
    }

    this.remaining = Math.max(0, this.remaining - 1);
    this.busy = false;
    this.audio.playClear();
    this.updateHUD();
    if (!isKeyClear) {
      this.ui.liveStatus.textContent = `清除成功，剩余 ${this.remaining} 条`;
    }

    if (this.remaining === 0 && !this.levelComplete) {
      this.levelComplete = true;
      this.totalClears += 1;
      saveClearCount(this.totalClears);
      this.renderClearCount();
      this.audio.playWin();
      this.updateHUD();
      clearTimeout(this.resultTimer);
      this.resultTimer = window.setTimeout(() => this.showResult('clear'), 520);
    }
  }

  renderClearCount() {
    if (this.ui.clearCount) {
      this.ui.clearCount.textContent = `${this.totalClears} 次`;
    }
  }

  handleImpact(line, blocker = null) {
    this.flashDamage();
    this.audio.playThud();
    this.vibrate();
    if (blocker) blocker.blockedFlash = 1;

    if (this.maxLives !== -1) {
      this.lives = Math.max(0, this.lives - 1);
      if (this.lives === 0) this.gameOver = true;
    }

    this.updateHUD();
    this.ui.liveStatus.textContent =
      this.maxLives === -1 ? '撞到了其他线段，无限生命' : '撞到了其他线段，生命 -1';

    this.showToast(
      this.maxLives === -1 ? '撞到了其他线段' : '撞到了其他线段 · 生命 -1',
      'is-danger',
      1200
    );
  }

  handleBounceDone() {
    this.busy = false;
    this.updateHUD();

    if (this.gameOver) {
      clearTimeout(this.resultTimer);
      this.resultTimer = window.setTimeout(() => this.showResult('gameover'), 280);
    }
  }

  flashDamage() {
    const element = this.ui.damageFlash;
    if (!element) return;
    element.classList.remove('is-active');
    // 强制重排以重新触发 CSS 动画
    void element.offsetWidth;
    element.classList.add('is-active');
  }

  vibrate() {
    if (typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([28, 26, 58]);
      } catch {
        // 忽略不支持震动的环境
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 提示                                                                 */
  /* ------------------------------------------------------------------ */

  handleHint() {
    if (this.busy || this.modalOpen || this.levelComplete || this.gameOver) return;
    if (this.hintsRemaining === 0) {
      this.showToast('提示次数已用完，可在设置中调整', 'is-hint', 1800);
      return;
    }

    this.startTimer();
    const line = this.findHintLine();
    if (!line) {
      this.showToast('当前没有可直接清除的线段', 'is-hint', 1600);
      return;
    }

    this.clearHint();
    if (this.hintsRemaining > 0) {
      this.hintsRemaining -= 1;
    }
    this.hintLine = line;
    line.setHinted(true);
    this.ensureLineVisible(line);

    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      if (this.hintLine === line) this.hintLine = null;
      line.setHinted(false);
    }, CONFIG.animation.hintFlashMs);

    this.audio.unlock();
    this.audio.playHint();
    this.updateHUD();
    this.showToast('闪烁的线段可以直接清除', 'is-hint', 1800);
    this.ui.liveStatus.textContent = '提示：闪烁的线段可以安全清除';
  }

  clearHint(line = null) {
    if (line && this.hintLine !== line) return;
    clearTimeout(this.hintTimer);
    this.hintTimer = 0;
    this.hintLine?.setHinted(false);
    this.hintLine = null;
  }

  findHintLine() {
    const active = this.lines.filter((line) => !line.cleared && line.isIdle);
    const free = [];

    for (const line of active) {
      const others = active.filter((candidate) => candidate !== line);
      const blocker = this.collision.findRayBlock(
        line,
        others,
        line.getExitDistance(this.board)
      );
      if (!blocker) free.push(line);
    }

    if (free.length === 0) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  ensureLineVisible(line) {
    if (!line) return;
    const bounds = line.getBounds(8);
    const topLeft = this.camera.worldToScreen({ x: bounds.minX, y: bounds.minY });
    const bottomRight = this.camera.worldToScreen({ x: bounds.maxX, y: bounds.maxY });
    const margin = 38;
    const topSafe = 90;
    const bottomSafe = this.view.height - 110;
    const visible =
      bottomRight.x > margin &&
      topLeft.x < this.view.width - margin &&
      bottomRight.y > topSafe &&
      topLeft.y < bottomSafe;

    if (!visible) {
      this.camera.focusOnWorld({ x: bounds.centerX, y: bounds.centerY });
      this.syncZoomUI();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 设置                                                                 */
  /* ------------------------------------------------------------------ */

  handleSettingsBtn() {
    this.openSettings();
  }

  openSettings() {
    if (this.ui.settingsDialog?.open) return;
    this.syncSettingsForm();
    this.ui.settingsDialog.showModal();
    this.ui.liveStatus.textContent = '设置面板已打开';
  }

  handleSettingsCloseBtn() {
    this.handleSettingsDone();
  }

  handleSettingsDone() {
    this.applySettingsFromInputs();
    this.ui.settingsDialog?.close();
  }

  handleSettingsClosed() {
    this.saveSettings();
    this.ui.liveStatus.textContent = '设置面板已关闭';

    if (this.pendingResultReopen && this.gameOver) {
      this.pendingResultReopen = false;
      requestAnimationFrame(() => {
        if (this.gameOver) this.showResult('gameover');
      });
      return;
    }

    // 如果结算弹窗因为设置打开而被延迟，关闭设置后补上
    if (this.gameOver) {
      requestAnimationFrame(() => {
        if (this.gameOver) this.showResult('gameover');
      });
      return;
    }
    if (this.levelComplete && this.remaining === 0) {
      requestAnimationFrame(() => {
        if (this.levelComplete && this.remaining === 0) this.showResult('clear');
      });
    }
  }

  syncSettingsForm() {
    if (!this.ui.settingsDialog) return;
    this.ui.livesInput.value = String(this.settings.lives);
    this.ui.hintsInput.value = String(this.settings.hints);
    this.ui.timeLimitInput.value = String(this.settings.timeLimitMinutes);
    this.ui.bgmToggle.checked = Boolean(this.settings.bgm);
    this.ui.sfxToggle.checked = Boolean(this.settings.sfx);
    this.ui.guidesToggle.checked = Boolean(this.guides);
    this.ui.bgmVolume.value = String(Math.round(this.settings.bgmVolume * 100));
    this.ui.sfxVolume.value = String(Math.round(this.settings.sfxVolume * 100));
    this.renderClearCount();
    this.ui.bgmVolumeRow?.classList.toggle('is-disabled', !this.settings.bgm);
    this.ui.sfxVolumeRow?.classList.toggle('is-disabled', !this.settings.sfx);
    if (this.ui.musicTrackSelect) {
      this.ui.musicTrackSelect.disabled = this.musicTracks.length === 0;
    }
    if (this.ui.removeMusicBtn) {
      this.ui.removeMusicBtn.disabled = this.musicTracks.length === 0;
    }
    this.syncThemeButtons();
  }

  handleSettingsChanged() {
    this.applySettingsFromInputs();
  }

  handleVolumeInput() {
    this.settings.bgmVolume = clamp(Number(this.ui.bgmVolume.value) / 100, 0, 1);
    this.settings.sfxVolume = clamp(Number(this.ui.sfxVolume.value) / 100, 0, 1);
    this.audio.applySettings(this.settings);
  }

  handleStepButton(event) {
    const button = event.currentTarget;
    const targetId = button.dataset.stepTarget;
    const step = Number(button.dataset.step);
    const input = this.ui.settingsDialog?.querySelector(`#${targetId}`);
    if (!input || !Number.isFinite(step)) return;

    let value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value)) {
      value =
        targetId === 'livesInput'
          ? this.settings.lives
          : targetId === 'timeLimitInput'
            ? this.settings.timeLimitMinutes
            : this.settings.hints;
    }
    let next = value + step;

    if (targetId === 'livesInput') {
      // 生命值跳过 0：1 再减一就是 -1（无限）
      if (next === 0) next = step > 0 ? 1 : -1;
      next = clamp(next, -1, 99);
    } else if (targetId === 'timeLimitInput') {
      next = clamp(next, 1, 30);
    } else {
      next = clamp(next, -1, 99);
    }

    input.value = String(next);
    this.applySettingsFromInputs();
  }

  applySettingsFromInputs() {
    if (!this.ui.settingsDialog) return;

    const lives = normalizeLives(this.ui.livesInput.value);
    const hints = normalizeHints(this.ui.hintsInput.value);
    const timeLimitMinutes = normalizeTimeMinutes(this.ui.timeLimitInput.value);
    const previousSettings = this.settings;
    const livesChanged = lives !== previousSettings.lives;
    const hintsChanged = hints !== previousSettings.hints;
    const timeChanged = timeLimitMinutes !== previousSettings.timeLimitMinutes;

    const wantsBgm = Boolean(this.ui.bgmToggle.checked);

    this.settings = {
      lives,
      hints,
      timeLimitMinutes,
      bgm: wantsBgm,
      bgmVolume: clamp(Number(this.ui.bgmVolume.value) / 100, 0, 1),
      musicTrackId: this.settings.musicTrackId,
      sfx: Boolean(this.ui.sfxToggle.checked),
      sfxVolume: clamp(Number(this.ui.sfxVolume.value) / 100, 0, 1),
      guides: Boolean(this.ui.guidesToggle.checked),
      theme: this.theme
    };

    this.guides = this.settings.guides;

    if (livesChanged) {
      this.maxLives = lives;
      this.lives = lives === -1 ? Infinity : lives;
      if (this.gameOver) {
        this.gameOver = false;
        this.pendingResultReopen = false;
        this.closeResult();
        this.showToast('生命值已更新，继续挑战', '', 1600);
      }
    }

    if (hintsChanged) {
      this.hintsRemaining = hints;
    }

    if (timeChanged && !this.levelComplete && !this.timedOut && !this.gameOver) {
      this.applyTimeLimitChange();
    }

    this.audio.unlock();
    this.audio.applySettings(this.settings);
    this.saveSettings();
    this.syncSettingsForm();
    this.updateHUD();
  }

  applyTimeLimitChange() {
    const newLimit = calculateTimeLimit(
      this.levelNumber,
      this.totalLines,
      this.settings.timeLimitMinutes
    );
    if (!Number.isFinite(newLimit) || newLimit <= 0) return;

    if (!this.timerStarted) {
      this.timeLimit = newLimit;
      this.timeRemaining = newLimit;
      this.lastTimerSecond = null;
      this.updateTimerDisplay(true);
      return;
    }

    const elapsed = Math.max(0, this.timeLimit - this.timeRemaining);
    this.timeLimit = newLimit;
    this.timeRemaining = Math.max(5, newLimit - elapsed);
    this.lastTimerSecond = null;
    this.updateTimerDisplay(true);
    this.showToast(`本关时间已调整为 ${formatTime(newLimit)}`, '', 1500);
  }

  handleResetProgress() {
    const confirmed = window.confirm('确定要重置关卡进度并回到第 1 关吗？');
    if (!confirmed) return;

    this.saveSettings();
    this.ui.settingsDialog?.close();
    this.levelNumber = 1;
    this.loadLevel(1, { announce: true });
    this.showToast('进度已重置到第 1 关', '', 1600);
  }

  applyAudioSettings() {
    this.audio.applySettings(this.settings);
  }

  saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.settings));
    } catch {
      // 忽略存储失败
    }
  }

  handleGuideToggle() {
    this.guides = !this.guides;
    this.settings.guides = this.guides;
    this.saveSettings();
    if (this.ui.guidesToggle) this.ui.guidesToggle.checked = this.guides;
    this.updateHUD();
  }

  handleMusicToggle() {
    this.audio.unlock();
    this.settings.bgm = !this.settings.bgm;
    this.audio.applySettings(this.settings);
    this.saveSettings();
    if (this.ui.bgmToggle) this.ui.bgmToggle.checked = this.settings.bgm;
    if (this.ui.bgmVolumeRow) {
      this.ui.bgmVolumeRow.classList.toggle('is-disabled', !this.settings.bgm);
    }
    this.updateHUD();
    this.showToast(this.settings.bgm ? '背景音乐已开启' : '背景音乐已关闭', '', 1100);
  }

  async initMusicLibrary() {
    await this.musicLibrary.open();
    await this.refreshMusicLibrary({ persist: false });
  }

  async refreshMusicLibrary({ selectId = null, persist = true, play = null } = {}) {
    if (!this.ui.musicTrackSelect) return;

    const tracks = await this.musicLibrary.getAll();
    this.musicTracks = tracks;
    const select = this.ui.musicTrackSelect;
    select.innerHTML = '';

    if (tracks.length === 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '尚未选择音乐';
      select.append(placeholder);
      select.disabled = true;
      if (this.ui.removeMusicBtn) this.ui.removeMusicBtn.disabled = true;
      this.setActiveMusicTrack(null);
      this.settings.musicTrackId = null;

      if (this.ui.musicLibraryHint) {
        this.ui.musicLibraryHint.textContent = this.musicLibrary.persistent
          ? '还没有音乐。选择本地音频后会保存在当前浏览器。'
          : '还没有音乐。当前环境无法持久化，仅本次会话有效。';
      }
    } else {
      for (const track of tracks) {
        const option = document.createElement('option');
        option.value = track.id;
        option.textContent = track.name;
        select.append(option);
      }

      const desiredId = selectId || this.settings.musicTrackId;
      const chosen = tracks.find((track) => track.id === desiredId) || tracks[0];
      select.disabled = false;
      select.value = chosen.id;
      if (this.ui.removeMusicBtn) this.ui.removeMusicBtn.disabled = false;

      this.settings.musicTrackId = chosen.id;
      this.setActiveMusicTrack(chosen, play ?? this.settings.bgm);

      if (this.ui.musicLibraryHint) {
        this.ui.musicLibraryHint.textContent = this.musicLibrary.persistent
          ? `已保存 ${tracks.length} 首音乐 · 可继续添加或切换曲目`
          : `${tracks.length} 首音乐仅本次会话有效（浏览器未开放持久化）`;
      }
    }

    this.syncSettingsForm();
    this.updateHUD();
    if (persist) this.saveSettings();
  }

  setActiveMusicTrack(track, play = false) {
    if (!track) {
      this.activeMusicTrackId = null;
      this.audio.clearBgmTrack();
      if (this.musicObjectUrl) {
        URL.revokeObjectURL(this.musicObjectUrl);
        this.musicObjectUrl = null;
      }
      return;
    }

    if (this.activeMusicTrackId !== track.id) {
      const previousUrl = this.musicObjectUrl;
      const url = URL.createObjectURL(track.blob);
      this.musicObjectUrl = url;
      this.activeMusicTrackId = track.id;
      this.audio.setBgmTrack(url);
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    }

    if (this.ui.musicTrackSelect) {
      this.ui.musicTrackSelect.value = track.id;
    }

    if (play && this.settings.bgm) this.audio.startBgm();
    else this.audio.stopBgm();
  }

  handlePickMusic() {
    if (!this.ui.musicFileInput) return;
    this.audio.unlock();
    this.ui.musicFileInput.value = '';
    this.ui.musicFileInput.click();
  }

  handlePickMusicFolder() {
    if (!this.ui.musicFolderInput) {
      this.handlePickMusic();
      return;
    }
    this.audio.unlock();
    this.ui.musicFolderInput.value = '';
    this.ui.musicFolderInput.click();
  }

  async handleMusicFiles(event) {
    const input = event.target;
    const files = [...(input.files || [])];
    if (input) input.value = '';
    if (files.length === 0) return;

    this.audio.unlock();
    this.showToast('正在导入音乐…', '', 900);

    let result;
    try {
      result = await this.musicLibrary.addFiles(files);
    } catch {
      this.showToast('音乐导入失败，请换一个文件试试', 'is-danger', 1900);
      return;
    }
    const { added, rejected } = result;

    if (added.length === 0) {
      const reason = rejected[0]?.reason;
      this.showToast(
        reason === 'too-large'
          ? '音乐文件超过 30MB'
          : reason === 'too-many'
            ? '音乐库最多保存 20 首'
            : '没有找到可用的音频文件',
        'is-danger',
        1900
      );
      return;
    }

    this.settings.bgm = true;
    await this.refreshMusicLibrary({
      selectId: added[0].id,
      persist: true,
      play: true
    });
    this.audio.unlock();
    this.audio.applySettings(this.settings);
    this.audio.startBgm();
    this.showToast(
      rejected.length > 0
        ? `已添加 ${added.length} 首，${rejected.length} 首未导入`
        : `已添加 ${added.length} 首音乐`,
      '',
      2000
    );
  }

  async handleMusicSelect() {
    const id = this.ui.musicTrackSelect?.value;
    if (!id) return;
    const track = this.musicTracks.find((candidate) => candidate.id === id);
    if (!track) return;

    this.audio.unlock();
    this.settings.musicTrackId = id;
    this.settings.bgm = true;
    this.setActiveMusicTrack(track, true);
    this.audio.applySettings(this.settings);
    this.saveSettings();
    this.syncSettingsForm();
    this.updateHUD();
    this.showToast(`当前音乐：${track.name}`, '', 1300);
  }

  async handleRemoveMusic() {
    const id = this.ui.musicTrackSelect?.value || this.settings.musicTrackId;
    if (!id) return;
    await this.musicLibrary.remove(id);

    if (this.settings.musicTrackId === id) {
      this.settings.musicTrackId = null;
      if (this.musicObjectUrl) {
        URL.revokeObjectURL(this.musicObjectUrl);
        this.musicObjectUrl = null;
      }
      this.activeMusicTrackId = null;
      this.audio.clearBgmTrack();
    }

    await this.refreshMusicLibrary({ persist: true, play: this.settings.bgm });
    this.saveSettings();
    this.showToast('音乐已移除', '', 1300);
  }

  handleRestart() {
    this.restartLevel();
  }

  /* ------------------------------------------------------------------ */
  /* 缩放                                                                 */
  /* ------------------------------------------------------------------ */

  handleZoomInput() {
    this.camera.setZoomPercent(Number(this.ui.zoomSlider.value));
    this.syncZoomUI();
  }

  handleZoomOut() {
    this.camera.setZoomPercent(this.camera.zoomPercent - 14);
    this.syncZoomUI();
  }

  handleZoomIn() {
    this.camera.setZoomPercent(this.camera.zoomPercent + 14);
    this.syncZoomUI();
  }

  syncZoomUI() {
    if (!this.ui.zoomSlider) return;
    const percent = this.camera.zoomPercent;
    const min = Number(this.ui.zoomSlider.min) || 72;
    const max = Number(this.ui.zoomSlider.max) || 320;
    this.ui.zoomSlider.value = String(percent);
    this.ui.zoomSlider.setAttribute('aria-valuetext', `${percent}%`);
    const progress = ((percent - min) / Math.max(1, max - min)) * 100;
    this.ui.zoomSlider.style.setProperty('--zoom-progress', `${clamp(progress, 0, 100)}%`);
    if (this.ui.zoomOutBtn) this.ui.zoomOutBtn.disabled = percent <= min;
    if (this.ui.zoomInBtn) this.ui.zoomInBtn.disabled = percent >= max;
  }

  /* ------------------------------------------------------------------ */
  /* 结果弹窗                                                             */
  /* ------------------------------------------------------------------ */

  showResult(mode) {
    // 防止延迟回调在关卡重置/复活后弹出过期结算
    if (mode === 'clear' && (!this.levelComplete || this.remaining !== 0)) return;
    if (mode === 'gameover' && !this.gameOver) return;
    if (mode === 'timeout' && !this.timedOut) return;
    if (this.modalOpen && !this.ui.resultDialog?.open) return;
    if (this.ui.resultDialog?.open) return;

    this.resultMode = mode;
    const isClear = mode === 'clear';
    const isTimeout = mode === 'timeout';

    if (isClear) {
      this.ui.resultIcon.textContent = '✦';
      this.ui.resultIcon.classList.remove('is-danger');
      this.ui.resultKicker.textContent = 'LEVEL CLEAR';
      this.ui.resultTitle.textContent = '关卡完成';
      this.ui.resultText.textContent = `你清理了第 ${this.levelNumber} 关的全部 ${this.totalLines} 条箭头。${
        this.maxLives === -1 ? '无限生命仍在继续。' : `剩余 ${this.lives} 颗心。`
      } 累计通关 ${this.totalClears} 次。`;
      this.ui.resultPrimaryBtn.textContent = '下一关';
      this.ui.resultSecondaryBtn.textContent = '重玩本关';
    } else if (isTimeout) {
      this.ui.resultIcon.textContent = '⏱';
      this.ui.resultIcon.classList.add('is-danger');
      this.ui.resultKicker.textContent = 'TIME UP';
      this.ui.resultTitle.textContent = '时间到';
      this.ui.resultText.textContent = `第 ${this.levelNumber} 关还剩 ${this.remaining} 条箭头。本关限时 ${formatTime(this.timeLimit)}，再试一次或调整设置。`;
      this.ui.resultPrimaryBtn.textContent = '重试本关';
      this.ui.resultSecondaryBtn.textContent = '调整设置';
    } else {
      this.ui.resultIcon.textContent = '×';
      this.ui.resultIcon.classList.add('is-danger');
      this.ui.resultKicker.textContent = 'GAME OVER';
      this.ui.resultTitle.textContent = '生命耗尽';
      this.ui.resultText.textContent = `第 ${this.levelNumber} 关还剩 ${this.remaining} 条箭头。可以在设置里把生命数量改为 -1 获得无限生命，或重试本关。`;
      this.ui.resultPrimaryBtn.textContent = '重试本关';
      this.ui.resultSecondaryBtn.textContent = '调整设置';
    }

    this.ui.resultDialog.showModal();
    this.ui.liveStatus.textContent = isClear
      ? '关卡完成'
      : isTimeout
        ? '时间到'
        : '游戏结束，生命耗尽';
  }

  closeResult() {
    if (this.ui.resultDialog?.open) this.ui.resultDialog.close();
  }

  handleResultPrimary() {
    const mode = this.resultMode;
    this.closeResult();
    if (mode === 'clear') {
      this.nextLevel();
    } else {
      this.restartLevel();
    }
  }

  handleResultSecondary() {
    const mode = this.resultMode;
    if (mode === 'clear') {
      this.closeResult();
      this.restartLevel();
      return;
    }

    this.closeResult();
    this.pendingResultReopen = true;
    this.openSettings();
  }

  handleResultCancel(event) {
    event.preventDefault();
  }

  /* ------------------------------------------------------------------ */
  /* 键盘与窗口                                                           */
  /* ------------------------------------------------------------------ */

  handleKeyDown(event) {
    if (this.modalOpen) {
      if (event.key === 'Escape' && this.ui.settingsDialog?.open) {
        this.handleSettingsDone();
      }
      return;
    }

    const target = event.target;
    const isTyping =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (isTyping) return;

    this.audio.unlock();

    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      this.restartLevel();
    } else if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      this.handleHint();
    } else if (event.key === 'g' || event.key === 'G') {
      event.preventDefault();
      this.handleGuideToggle();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.handleZoomIn();
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.handleZoomOut();
    } else if (event.key === '0') {
      event.preventDefault();
      this.camera.fit();
      this.syncZoomUI();
    }
  }

  handleVisibility() {
    this.lastFrameTime = performance.now();
  }

  handleResize() {
    if (this.resizeRafId) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = 0;
      this.resize();
    });
  }

  updateChromeInsets() {
    const top = this.ui.hudTop?.getBoundingClientRect().height;
    const bottom = this.ui.hudBottom?.getBoundingClientRect().height;
    if (Number.isFinite(top) && top > 0) {
      document.documentElement.style.setProperty(
        '--chrome-top',
        `${Math.ceil(top)}px`
      );
    }
    if (Number.isFinite(bottom) && bottom > 0) {
      document.documentElement.style.setProperty(
        '--chrome-bottom',
        `${Math.ceil(bottom)}px`
      );
    }
  }

  resize() {
    // 画布只占顶部 HUD 和底部工具栏之间的区域，缩放/平移都不会钻到菜单下面。
    this.updateChromeInsets();
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.view = { width, height, dpr };
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    this.backgroundRenderer.resize(width, height, dpr, this.palette);
    this.camera.resize(width, height, getFitInsets(width, height));
    this.syncZoomUI();
  }

  /* ------------------------------------------------------------------ */
  /* 外观主题                                                             */
  /* ------------------------------------------------------------------ */

  applyTheme(theme, { persist = true } = {}) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    this.theme = normalized;
    this.palette = CONFIG.themes[normalized];
    this.settings.theme = normalized;

    document.documentElement.dataset.theme = normalized;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', this.palette.metaTheme);

    if (this.view.width > 1 && this.view.height > 1) {
      this.backgroundRenderer.resize(
        this.view.width,
        this.view.height,
        this.view.dpr,
        this.palette
      );
    }

    this.syncThemeButtons();
    if (persist) this.saveSettings();
  }

  handleThemeChoice(event) {
    const theme = event.currentTarget.dataset.themeChoice;
    if (!theme) return;
    this.applyTheme(theme);
  }

  syncThemeButtons() {
    for (const button of this.themeButtons || []) {
      const active = button.dataset.themeChoice === this.theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                  */
  /* ------------------------------------------------------------------ */

  updateHUD() {
    if (!this.ui.levelValue) return;

    this.ui.levelValue.textContent = String(this.levelNumber);
    this.ui.remainingLabel.textContent = `剩余 ${this.remaining}`;

    this.renderHearts();
    this.renderHintBadge();
    this.renderClearCount();

    this.ui.hintBtn.disabled =
      this.hintsRemaining === 0 || this.busy || this.levelComplete || this.gameOver;

    const guideActive = this.guides;
    for (const button of [this.ui.guideBtn, this.ui.guideEyeBtn]) {
      if (!button) continue;
      button.classList.toggle('is-active', guideActive);
      button.setAttribute('aria-pressed', String(guideActive));
    }
    if (this.ui.guidesToggle) this.ui.guidesToggle.checked = this.guides;

    const musicActive = Boolean(this.settings.bgm);
    for (const button of [this.ui.musicBtn, this.ui.musicToolBtn]) {
      if (!button) continue;
      button.classList.toggle('is-off', !musicActive);
      button.classList.toggle('is-on', musicActive);
      button.setAttribute('aria-pressed', String(musicActive));
      button.setAttribute(
        'aria-label',
        musicActive ? '关闭背景音乐' : '开启互动乐章或本地音乐'
      );
    }
    if (this.ui.musicToolState) {
      this.ui.musicToolState.textContent = musicActive ? '开' : '关';
    }
  }

  renderHearts() {
    if (!this.ui.hearts) return;
    const max = this.maxLives;

    if (max === -1) {
      this.ui.hearts.innerHTML =
        '<span class="heart-infinite" aria-hidden="true">∞</span><span class="heart-label">无限</span>';
      this.ui.hearts.setAttribute('aria-label', '无限生命');
      return;
    }

    if (max > 6) {
      this.ui.hearts.innerHTML = `${heartSvg(
        this.lives > 0
      )}<span class="heart-label">${this.lives} / ${max}</span>`;
      this.ui.hearts.setAttribute('aria-label', `生命值 ${this.lives} / ${max}`);
      return;
    }

    let markup = '';
    for (let index = 0; index < max; index += 1) {
      markup += heartSvg(index < this.lives);
    }
    this.ui.hearts.innerHTML = markup;
    this.ui.hearts.setAttribute('aria-label', `生命值 ${this.lives} / ${max}`);
  }

  renderHintBadge() {
    if (!this.ui.hintCount) return;
    this.ui.hintCount.textContent = this.hintsRemaining === -1 ? '∞' : String(this.hintsRemaining);
    if (this.ui.hintBtn) {
      this.ui.hintBtn.setAttribute(
        'aria-label',
        this.hintsRemaining === -1 ? '使用提示，无限次数' : `使用提示，剩余 ${this.hintsRemaining} 次`
      );
    }
  }

  describeLives() {
    if (this.maxLives === -1) return '无限';
    return `${this.lives} / ${this.maxLives}`;
  }

  showToast(message, variant = '', duration = 1600) {
    if (!this.ui.toast) return;
    clearTimeout(this.toastTimer);
    this.ui.toast.classList.remove('is-visible', 'is-danger', 'is-hint');
    if (variant) this.ui.toast.classList.add(variant);
    this.ui.toast.textContent = message;
    this.ui.toast.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.ui.toast.classList.remove('is-visible');
    }, duration);
  }

  /* ------------------------------------------------------------------ */
  /* 主循环与渲染                                                          */
  /* ------------------------------------------------------------------ */

  handleFrame(now) {
    if (!this.running) return;

    const deltaSeconds = Math.min(
      (now - this.lastFrameTime) / 1000,
      CONFIG.maxDeltaSeconds
    );
    this.lastFrameTime = now;
    this.elapsed += deltaSeconds;

    for (const line of this.lines) line.update(deltaSeconds);
    this.tickTimer(deltaSeconds);

    this.render();
    this.rafId = requestAnimationFrame(this.handleFrame);
  }

  render() {
    if (!this.board) return;

    const { width, height, dpr } = this.view;
    const ctx = this.ctx;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.backgroundRenderer.draw(ctx);

    ctx.save();

    ctx.translate(this.camera.anchorX, this.camera.anchorY);
    ctx.scale(this.camera.scale, this.camera.scale);
    ctx.translate(-this.camera.x, -this.camera.y);

    const focusLine =
      this.hintLine || this.pressedLine || this.hoveredLine || this.lines.find((line) => line.isMoving) || null;

    this.boardRenderer.draw(ctx, this.board, this.camera, {
      guides: this.guides,
      focusLine,
      palette: this.palette
    });
    this.lineRenderer.draw(ctx, this.lines, this.elapsed, {
      focusLine,
      palette: this.palette
    });

    ctx.restore();
  }
}

/* -------------------------------------------------------------------- */
/* 工具函数                                                              */
/* -------------------------------------------------------------------- */

function heartSvg(filled) {
  return `<svg class="heart${filled ? '' : ' is-empty'}" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 画布本身已经避开了顶部/底部 HUD，所以这里只留一点呼吸边。
 * 不能再把 HUD 的高度重复算进相机 inset，否则棋盘会被压得太小。
 */
function getFitInsets(width) {
  const side = width < 360 ? 8 : width < 520 ? 12 : 18;
  return { top: 8, right: side, bottom: 8, left: side };
}

function midpointOf(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function preventDefault(event) {
  event.preventDefault();
}

function loadSettings() {
  const defaults = { ...CONFIG.defaults };
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}') || {};
  } catch {
    raw = {};
  }

  return {
    lives: normalizeLives(raw.lives ?? defaults.lives),
    hints: normalizeHints(raw.hints ?? defaults.hints),
    timeLimitMinutes: normalizeTimeMinutes(
      raw.timeLimitMinutes ?? defaults.timeLimitMinutes
    ),
    bgm: typeof raw.bgm === 'boolean' ? raw.bgm : defaults.bgm,
    bgmVolume: clamp(Number(raw.bgmVolume ?? defaults.bgmVolume), 0, 1),
    musicTrackId: typeof raw.musicTrackId === 'string' ? raw.musicTrackId : null,
    sfx: typeof raw.sfx === 'boolean' ? raw.sfx : defaults.sfx,
    sfxVolume: clamp(Number(raw.sfxVolume ?? defaults.sfxVolume), 0, 1),
    guides: typeof raw.guides === 'boolean' ? raw.guides : defaults.guides,
    theme: raw.theme === 'light' ? 'light' : 'dark'
  };
}

function loadLevelNumber() {
  try {
    const value = Number.parseInt(localStorage.getItem(STORAGE_KEYS.level) || '1', 10);
    return Number.isFinite(value) && value >= 1 ? value : 1;
  } catch {
    return 1;
  }
}

function normalizeLives(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return CONFIG.defaults.lives;
  if (number === -1) return -1;
  return clamp(number, 1, CONFIG.maxStepValue);
}

function normalizeHints(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return CONFIG.defaults.hints;
  if (number === -1) return -1;
  return clamp(number, 0, CONFIG.maxStepValue);
}

function normalizeTimeMinutes(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return CONFIG.defaults.timeLimitMinutes;
  return clamp(number, 1, 30);
}

function loadClearCount() {
  try {
    const value = Number.parseInt(
      localStorage.getItem(STORAGE_KEYS.clears) || '0',
      10
    );
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveClearCount(value) {
  try {
    localStorage.setItem(STORAGE_KEYS.clears, String(Math.max(0, value)));
  } catch {
    // 隐私模式下 localStorage 可能不可用，当前会话内仍然显示
  }
}

function readTutorialFlag() {
  try {
    return localStorage.getItem(STORAGE_KEYS.tutorial) === '1';
  } catch {
    return true;
  }
}

function writeTutorialFlag() {
  try {
    localStorage.setItem(STORAGE_KEYS.tutorial, '1');
  } catch {
    // 忽略
  }
}
