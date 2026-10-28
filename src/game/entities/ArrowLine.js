import { CONFIG } from '../../config.js';
import {
  distanceToPolyline,
  getArrowGeometry,
  getPolylineBounds,
  pointInTriangle
} from '../utils/geometry.js';
import { Easing, Tween } from '../utils/Tween.js';

/**
 * 一条带方向的折线，也是本项目的核心数据对象。
 *
 * 数据字段：
 * - points：折线的起点、所有拐点、终点，世界坐标
 * - direction：'right' | 'left' | 'up' | 'down'
 * - cleared：是否已经成功飞离棋盘
 * - offset：沿 direction 整体平移的距离
 * - state：idle | sliding | hitting | bouncing | cleared
 */
export class ArrowLine {
  constructor({
    id,
    points,
    direction = 'right',
    axis,
    width = CONFIG.line.defaultWidth,
    hitTolerance = CONFIG.line.hitToleranceMouse
  }) {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error('ArrowLine 至少需要两个点才能构成折线。');
    }

    this.id = id;
    this.points = points.map((point) => ({ x: point.x, y: point.y }));
    this.direction = direction;
    this.axis = axis || getAxis(direction);
    this.width = width;
    this.hitTolerance = hitTolerance;

    this.offset = 0;
    this.state = 'idle';
    this.cleared = false;
    this.hovered = false;
    this.pressed = false;
    this.hinted = false;
    this.highlight = 0;
    this.impactFlash = 0;
    this.blockedFlash = 0;
    this.slideTween = null;

    this.__bounds = getPolylineBounds(this.points);

    // 蛇形运动预计算：每个顶点到尾巴的弧长，以及身体总长度
    this.cumulativeLengths = [0];
    for (let index = 1; index < this.points.length; index += 1) {
      const previous = this.points[index - 1];
      const current = this.points[index];
      this.cumulativeLengths.push(
        this.cumulativeLengths[index - 1] +
          Math.hypot(current.x - previous.x, current.y - previous.y)
      );
    }
    this.bodyLength = this.cumulativeLengths[this.cumulativeLengths.length - 1];
    this.headPoint = this.points[this.points.length - 1];
  }

  get isIdle() {
    return this.state === 'idle';
  }

  get isMoving() {
    return this.state === 'sliding' || this.state === 'hitting' || this.state === 'bouncing';
  }

  /**
   * 蛇形运动的关键：
   *
   * 把“原始折线 + 箭头前方射线”看成一条轨道。箭头的头部沿轨道向前走，
   * 身体上的每个顶点始终落后头部固定弧长，于是尾巴会沿着原折线依次滑出，
   * 折角被逐节拉直 —— 看起来就像一条蛇顺滑地游出去，而不是整块刚体平移。
   *
   * offset 在这里表示“头部已经沿轨道前进的距离”。
   */
  getPoints() {
    return this.getPointsAt(this.offset);
  }

  /** 返回指定头部位移下的蛇身折线，用于残影和渲染。 */
  getPointsAt(offset) {
    // 弹簧回弹时会短暂出现负位移：整体轻微后坐，视觉上更自然
    if (offset < 0) {
      const { x: axisX, y: axisY } = this.axis;
      return this.points.map((point) => ({
        x: point.x + axisX * offset,
        y: point.y + axisY * offset
      }));
    }

    if (offset <= 1e-7) {
      return this.points.map((point) => ({ x: point.x, y: point.y }));
    }

    return this.cumulativeLengths.map((arcLength) =>
      this.sampleTrack(offset + arcLength)
    );
  }

  /**
   * 在“原始折线 → 头部射线”组成的轨道上取弧长为 arcLength 的位置。
   */
  sampleTrack(arcLength) {
    if (arcLength <= 0) return { x: this.points[0].x, y: this.points[0].y };

    if (arcLength <= this.bodyLength) {
      for (let index = 1; index < this.points.length; index += 1) {
        const segmentStart = this.cumulativeLengths[index - 1];
        const segmentEnd = this.cumulativeLengths[index];
        if (arcLength <= segmentEnd) {
          const segmentLength = segmentEnd - segmentStart;
          if (segmentLength <= 1e-9) {
            return {
              x: this.points[index].x,
              y: this.points[index].y
            };
          }
          const t = (arcLength - segmentStart) / segmentLength;
          const a = this.points[index - 1];
          const b = this.points[index];
          return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
          };
        }
      }
    }

    const extra = arcLength - this.bodyLength;
    return {
      x: this.headPoint.x + this.axis.x * extra,
      y: this.headPoint.y + this.axis.y * extra
    };
  }

  /** 箭头中心（原始折线终点）到棋盘边缘的直线距离。 */
  getHeadEdgeDistance(board, margin = CONFIG.board.exitMargin) {
    const head = this.headPoint;
    if (this.axis.x > 0) return Math.max(0, board.maxX + margin - head.x);
    if (this.axis.x < 0) return Math.max(0, head.x - (board.minX - margin));
    if (this.axis.y > 0) return Math.max(0, board.maxY + margin - head.y);
    return Math.max(0, head.y - (board.minY - margin));
  }

  getArrow() {
    return getArrowGeometry(
      this.getPoints(),
      this.axis,
      CONFIG.line.arrowLength,
      CONFIG.line.arrowWidth
    );
  }

  getBounds(padding = 0) {
    return getPolylineBounds(this.getPoints(), padding + this.width / 2);
  }

  getSourceBounds() {
    return this.__bounds;
  }

  /**
   * 蛇形完全出屏所需头部位移：
   * 先把整条身体“抽”到头部位置，再让尾巴越过棋盘边缘。
   */
  getExitDistance(board, margin = CONFIG.board.exitMargin) {
    return this.getHeadEdgeDistance(board, margin) + this.bodyLength;
  }

  /** 点到线段可见区域的最短距离（箭头内部计为 0）。 */
  getHitDistance(point) {
    if (this.state === 'cleared') return Number.POSITIVE_INFINITY;

    const points = this.getPoints();
    let distance = distanceToPolyline(point, points) - this.width / 2;
    const arrow = this.getArrow();

    if (pointInTriangle(point, arrow.tip, arrow.baseA, arrow.baseB)) {
      return 0;
    }

    distance = Math.min(
      distance,
      Math.hypot(point.x - arrow.tip.x, point.y - arrow.tip.y)
    );
    return Math.max(0, distance);
  }

  /** 点击命中：折线本体或箭头三角形内部。 */
  containsPoint(point, tolerance) {
    if (this.state === 'cleared') return false;
    const baseTolerance = tolerance ?? this.hitTolerance;
    return this.getHitDistance(point) <= baseTolerance;
  }

  setHovered(value) {
    this.hovered = Boolean(value);
  }

  setPressed(value) {
    this.pressed = Boolean(value);
  }

  setHinted(value) {
    this.hinted = Boolean(value);
  }

  /**
   * 成功路径：沿箭头方向加速滑出棋盘。
   * @returns {boolean} 是否成功启动
   */
  startSlide(distance, { duration = 500, onComplete } = {}) {
    if (!this.isIdle) return false;

    this.state = 'sliding';
    this.pressed = false;
    this.hovered = false;
    this.hinted = false;
    this.slideTween = new Tween({
      from: 0,
      to: distance,
      duration,
      easing: Easing.easeInOutCubic,
      onUpdate: (value) => {
        this.offset = value;
      },
      onComplete: () => {
        this.offset = distance;
        this.state = 'cleared';
        this.cleared = true;
        onComplete?.();
      }
    });
    return true;
  }

  /**
   * 碰撞路径：先滑到接触点，触发撞击回调，再弹簧式弹回原位。
   */
  hitBlock(contactDistance, { approachDuration = 150, bounceDuration = 340, onImpact, onComplete } = {}) {
    if (!this.isIdle) return false;

    this.state = 'hitting';
    this.pressed = false;
    this.hovered = false;
    this.hinted = false;

    const contact = Math.max(0, contactDistance);
    this.slideTween = new Tween({
      from: 0,
      to: contact,
      duration: approachDuration,
      easing: Easing.easeOutCubic,
      onUpdate: (value) => {
        this.offset = value;
      },
      onComplete: () => {
        this.offset = contact;
        this.impactFlash = 1;
        onImpact?.();

        this.state = 'bouncing';
        this.slideTween = new Tween({
          from: contact,
          to: 0,
          duration: bounceDuration,
          easing: Easing.easeOutBack,
          onUpdate: (value) => {
            this.offset = value;
          },
          onComplete: () => {
            this.offset = 0;
            this.state = 'idle';
            onComplete?.();
          }
        });
      }
    });
    return true;
  }

  /**
   * @param {number} deltaSeconds 主循环传入，使用秒保证不同刷新率下手感一致
   */
  update(deltaSeconds) {
    if (this.slideTween) {
      this.slideTween.update(deltaSeconds * 1000);
    }

    const target = this.state === 'sliding' || this.state === 'hitting' || this.state === 'bouncing'
      ? 1
      : this.pressed
        ? 1
        : this.hinted
          ? 1
          : this.hovered
            ? 0.78
            : 0;

    const smoothing = 1 - Math.exp(-14 * deltaSeconds);
    this.highlight += (target - this.highlight) * smoothing;

    if (this.impactFlash > 0) {
      this.impactFlash = Math.max(0, this.impactFlash - deltaSeconds * 1.45);
    }
    if (this.blockedFlash > 0) {
      this.blockedFlash = Math.max(0, this.blockedFlash - deltaSeconds * 1.15);
    }
  }
}

function getAxis(direction) {
  if (direction === 'left') return { x: -1, y: 0 };
  if (direction === 'up') return { x: 0, y: -1 };
  if (direction === 'down') return { x: 0, y: 1 };
  return { x: 1, y: 0 };
}
