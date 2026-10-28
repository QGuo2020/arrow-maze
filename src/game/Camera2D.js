import { CONFIG } from '../config.js';
import { clamp } from './utils/geometry.js';

/**
 * 2D 摄像机。
 *
 * 世界坐标 → 屏幕坐标：
 *   screen = anchor + (world - camera) * scale
 *
 * anchor 是“可用游戏区域”的中心，会把顶部/底部 HUD 的高度让出来。
 * 支持围绕屏幕某一点缩放，双指捏合时可以让手指下的棋盘保持不动。
 */
export class Camera2D {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.anchorX = 0.5;
    this.anchorY = 0.5;
    this.insets = { ...CONFIG.camera.fitInset };

    this.board = null;
    this.scale = 1;
    this.fitScale = 1;
    this.zoomFactor = 1;
    this.x = 0;
    this.y = 0;
  }

  setViewport(width, height, insets = this.insets) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = { ...insets };

    const availableWidth = Math.max(1, this.width - insets.left - insets.right);
    const availableHeight = Math.max(1, this.height - insets.top - insets.bottom);
    this.anchorX = insets.left + availableWidth / 2;
    this.anchorY = insets.top + availableHeight / 2;

    if (this.board) {
      this.updateFitScale();
      this.scale = this.fitScale * this.zoomFactor;
      this.clamp();
    }
  }

  setBoard(board) {
    this.board = board;
    this.updateFitScale();
    this.fit();
  }

  updateFitScale() {
    if (!this.board) return;
    const availableWidth = Math.max(1, this.width - this.insets.left - this.insets.right);
    const availableHeight = Math.max(1, this.height - this.insets.top - this.insets.bottom);
    this.fitScale = Math.min(
      availableWidth / this.board.width,
      availableHeight / this.board.height
    );
    this.fitScale = Math.max(0.001, this.fitScale * 0.985);
  }

  /** 重置为适配整个棋盘，滑块回到 100%。 */
  fit() {
    if (!this.board) return;
    this.zoomFactor = 1;
    this.scale = this.fitScale;
    this.x = this.board.centerX;
    this.y = this.board.centerY;
    this.clamp();
  }

  /** 重新适配视口，但保留玩家当前的缩放比例。 */
  resize(width, height, insets = this.insets) {
    this.setViewport(width, height, insets);
    if (!this.board) return;
    const zoom = clamp(this.zoomFactor, CONFIG.camera.minZoom, CONFIG.camera.maxZoom);
    this.zoomFactor = zoom;
    this.scale = this.fitScale * zoom;
    this.clamp();
  }

  worldToScreen(point) {
    return {
      x: this.anchorX + (point.x - this.x) * this.scale,
      y: this.anchorY + (point.y - this.y) * this.scale
    };
  }

  screenToWorld(point) {
    return {
      x: this.x + (point.x - this.anchorX) / this.scale,
      y: this.y + (point.y - this.anchorY) / this.scale
    };
  }

  /** 按屏幕像素平移地图。 */
  panBy(dxScreen, dyScreen) {
    this.x -= dxScreen / this.scale;
    this.y -= dyScreen / this.scale;
    this.clamp();
  }

  /**
   * 设置相对适配尺寸的缩放倍率。
   * @param {number} factor 1 = 适配棋盘
   * @param {{x:number,y:number}} [focusScreen] 缩放中心（屏幕坐标）
   */
  setZoomFactor(factor, focusScreen = null) {
    if (!this.board) return;

    const nextFactor = clamp(
      Number.isFinite(factor) ? factor : 1,
      CONFIG.camera.minZoom,
      CONFIG.camera.maxZoom
    );
    if (Math.abs(nextFactor - this.zoomFactor) < 0.0001) return;

    const focus = focusScreen || { x: this.anchorX, y: this.anchorY };
    const worldBefore = this.screenToWorld(focus);

    this.zoomFactor = nextFactor;
    this.scale = this.fitScale * nextFactor;

    // 让 focus 屏幕点对应的世界坐标保持不动
    this.x = worldBefore.x - (focus.x - this.anchorX) / this.scale;
    this.y = worldBefore.y - (focus.y - this.anchorY) / this.scale;
    this.clamp();
  }

  zoomBy(multiplier, focusScreen = null) {
    this.setZoomFactor(this.zoomFactor * multiplier, focusScreen);
  }

  /** 将摄像机中心移到指定世界坐标（用于提示时把线段带回视野）。 */
  focusOnWorld(point) {
    if (!this.board) return;
    this.x = point.x;
    this.y = point.y;
    this.clamp();
  }

  /**
   * 双指捏合专用：缩放的同时，让指定的世界点跟随当前两指中点。
   * 这样既能缩放，也能自然支持双指平移。
   */
  setZoomAroundWorld(factor, worldPoint, screenPoint) {
    if (!this.board) return;

    const nextFactor = clamp(
      Number.isFinite(factor) ? factor : 1,
      CONFIG.camera.minZoom,
      CONFIG.camera.maxZoom
    );
    this.zoomFactor = nextFactor;
    this.scale = this.fitScale * nextFactor;
    this.x = worldPoint.x - (screenPoint.x - this.anchorX) / this.scale;
    this.y = worldPoint.y - (screenPoint.y - this.anchorY) / this.scale;
    this.clamp();
  }

  setZoomPercent(percent, focusScreen = null) {
    this.setZoomFactor(percent / 100, focusScreen);
  }

  get zoomPercent() {
    return Math.round(this.zoomFactor * 100);
  }

  /**
   * 限制镜头范围：放大后不能把棋盘拖出屏幕；
   * 棋盘小于视口时自动居中。
   */
  clamp() {
    if (!this.board) return;

    const overscroll = CONFIG.camera.panOverscroll / this.scale;
    const viewHalfLeft = this.anchorX / this.scale;
    const viewHalfRight = (this.width - this.anchorX) / this.scale;
    const viewHalfTop = this.anchorY / this.scale;
    const viewHalfBottom = (this.height - this.anchorY) / this.scale;

    const minX = this.board.minX + viewHalfLeft - overscroll;
    const maxX = this.board.maxX - viewHalfRight + overscroll;
    if (minX <= maxX) {
      this.x = clamp(this.x, minX, maxX);
    } else {
      this.x = this.board.centerX;
    }

    const minY = this.board.minY + viewHalfTop - overscroll;
    const maxY = this.board.maxY - viewHalfBottom + overscroll;
    if (minY <= maxY) {
      this.y = clamp(this.y, minY, maxY);
    } else {
      this.y = this.board.centerY;
    }
  }
}
