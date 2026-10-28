import { CONFIG } from '../../config.js';
import {
  getPolylineBounds,
  getSweptQuad,
  rayCapsuleFirstHit,
  segmentDistanceSq,
  segmentDistanceToPolygonSq,
  translatePoints
} from '../utils/geometry.js';

/**
 * 细折线碰撞系统，提供两套互补的算法：
 *
 * 1. 游戏内的蛇形碰撞 findRayBlock()：
 *    箭头带头沿方向游出，身体只沿“原折线 + 头部射线”跟随，
 *    所以最先进入新空间的只有箭头尖。用一条带线宽的胶囊射线求首次接触，
 *    和动画中的头部位置严格一致，也不会穿模。
 *
 * 2. 关卡生成用的保守扫掠 getPathBlockers()：
 *    把整条折线沿方向扫过的区域拆成平行四边形，求静态线与扫掠四边形的距离。
 *    它比蛇形运动更严格，生成器用它验证出来的解在蛇形规则下一定成立。
 *
 * 线段不是数学零宽度线，而是带线宽的胶囊体。两根线中心距小于两半径之和
 * （再额外加一点 padding）即判定接触。
 */
export class CollisionSystem {
  constructor({ padding = CONFIG.collision.padding } = {}) {
    this.padding = padding;
  }

  /** 两根线发生接触所需的最小中心线距离。 */
  contactDistance(lineA, lineB) {
    return (lineA.width + lineB.width) / 2 + this.padding;
  }

  /**
   * 保守的整条线扫掠版本，保留用于回归测试和需要“整块平移”语义的场景。
   * 游戏内蛇形运动请使用 findRayBlock()。
   * @returns {{distance:number,line:object}|null} 无阻挡时返回 null（可以飞出）
   */
  findBlockingOffset(moving, others, maxDistance) {
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) return null;
    if (!others || others.length === 0) return null;

    const firstBlock = this.hasCollisionWithin(moving, others, 0, maxDistance);
    if (!firstBlock) return null;

    // 初始位置已经接触（正常生成器不会出现），直接返回 0
    const atStart = this.hasCollisionWithin(moving, others, 0, 0);
    if (atStart) return { distance: 0, line: atStart };

    let low = 0;
    let high = maxDistance;
    let blocker = firstBlock;

    // 二分查找第一次接触的位置；精度远高于屏幕像素
    for (let iteration = 0; iteration < 17; iteration += 1) {
      const mid = (low + high) / 2;
      const hit = this.hasCollisionWithin(moving, others, 0, mid);
      if (hit) {
        high = mid;
        blocker = hit;
      } else {
        low = mid;
      }
    }

    return { distance: high, line: blocker };
  }

  /**
   * 蛇形移动专用：只有箭头头部的射线会进入新的空间，
   * 身体只是沿“原始折线 + 头部射线”这条轨道跟随，因此用头部胶囊射线
   * 找第一个阻挡即可。这样碰撞位置和蛇形动画的头部位置严格一致。
   *
   * @returns {{distance:number,line:object}|null}
   */
  findRayBlock(moving, staticLines, maxDistance) {
    if (!moving || !staticLines || staticLines.length === 0) return null;

    const head = moving.points[moving.points.length - 1];
    const direction = moving.axis;
    // 以箭头尖作为最先接触障碍的射线起点；身体沿这条轨迹跟随。
    const origin = {
      x: head.x + direction.x * CONFIG.line.arrowLength,
      y: head.y + direction.y * CONFIG.line.arrowLength
    };
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestLine = null;

    for (const staticLine of staticLines) {
      if (!staticLine || staticLine === moving || staticLine.cleared) continue;

      const radius = this.contactDistance(moving, staticLine);
      const points = staticLine.points;

      for (let index = 0; index < points.length - 1; index += 1) {
        const hitDistance = rayCapsuleFirstHit(
          origin,
          direction,
          points[index],
          points[index + 1],
          radius,
          maxDistance
        );
        if (hitDistance < bestDistance) {
          bestDistance = hitDistance;
          bestLine = staticLine;
        }
      }
    }

    if (!bestLine) return null;
    return { distance: bestDistance, line: bestLine };
  }

  /**
   * 返回所有会挡住 moving 头部射线的线（不关心谁最近）。
   * 用于构建依赖图、判断一条线清掉后能释放多少条线。
   */
  findRayBlockers(moving, staticLines, maxDistance) {
    if (!moving || !staticLines || staticLines.length === 0) return [];

    const head = moving.points[moving.points.length - 1];
    const direction = moving.axis;
    const origin = {
      x: head.x + direction.x * CONFIG.line.arrowLength,
      y: head.y + direction.y * CONFIG.line.arrowLength
    };
    const blockers = [];

    for (const staticLine of staticLines) {
      if (!staticLine || staticLine === moving || staticLine.cleared) continue;
      const radius = this.contactDistance(moving, staticLine);
      const points = staticLine.points;

      for (let index = 0; index < points.length - 1; index += 1) {
        const hitDistance = rayCapsuleFirstHit(
          origin,
          direction,
          points[index],
          points[index + 1],
          radius,
          maxDistance
        );
        if (Number.isFinite(hitDistance)) {
          blockers.push(staticLine);
          break;
        }
      }
    }

    return blockers;
  }

  /**
   * 检查箭头前方的射线是否会撞到自己的尾巴/身体。
   *
   * 生成器必须排除这种线：它虽然不会和其他线相撞，但蛇形出发时
   * 头部会从自己的身体里穿过去，看起来就是“自己撞自己”。
   */
  hitsOwnBody(moving, maxDistance = 4200) {
    if (!moving?.points || moving.points.length < 3) return false;
    const head = moving.points[moving.points.length - 1];
    const direction = moving.axis;
    const origin = {
      x: head.x + direction.x * CONFIG.line.arrowLength,
      y: head.y + direction.y * CONFIG.line.arrowLength
    };
    const radius = moving.width / 2 + this.padding;

    // 排除紧贴箭头的最后一段；其余身体都算自撞
    for (let index = 0; index < moving.points.length - 2; index += 1) {
      const hitDistance = rayCapsuleFirstHit(
        origin,
        direction,
        moving.points[index],
        moving.points[index + 1],
        radius,
        maxDistance
      );
      if (Number.isFinite(hitDistance)) return true;
    }
    return false;
  }

  /**
   * 判断从 startOffset 到 endOffset 的整段扫掠是否与 staticLines 接触。
   * 返回第一条命中的线，没命中返回 null。
   * 关卡生成器的保守可解性校验仍然使用它。
   */
  hasCollisionWithin(moving, staticLines, startOffset, endOffset) {
    const sweep = this.buildSweep(moving, startOffset, endOffset);
    if (!sweep) return null;

    const maxRadius = (moving.width + this.getMaxWidth(staticLines)) / 2 + this.padding;
    const broadMinX = sweep.bounds.minX - maxRadius;
    const broadMaxX = sweep.bounds.maxX + maxRadius;
    const broadMinY = sweep.bounds.minY - maxRadius;
    const broadMaxY = sweep.bounds.maxY + maxRadius;

    for (const staticLine of staticLines) {
      if (!staticLine || staticLine === moving || staticLine.cleared) continue;

      const bounds = this.getBounds(staticLine);
      if (
        bounds.maxX < broadMinX ||
        bounds.minX > broadMaxX ||
        bounds.maxY < broadMinY ||
        bounds.minY > broadMaxY
      ) {
        continue;
      }

      const radius = this.contactDistance(moving, staticLine);
      if (this.lineHitsSweep(staticLine, sweep, radius)) return staticLine;
    }

    return null;
  }

  /**
   * 一次保守扫掠找出所有会阻挡 moving 的线，用于关卡生成器的可解性图。
   */
  getPathBlockers(moving, staticLines, maxDistance) {
    const sweep = this.buildSweep(moving, 0, maxDistance);
    if (!sweep) return [];

    const maxRadius = (moving.width + this.getMaxWidth(staticLines)) / 2 + this.padding;
    const blockers = [];

    for (const staticLine of staticLines) {
      if (!staticLine || staticLine === moving || staticLine.cleared) continue;

      const bounds = this.getBounds(staticLine);
      if (
        bounds.maxX < sweep.bounds.minX - maxRadius ||
        bounds.minX > sweep.bounds.maxX + maxRadius ||
        bounds.maxY < sweep.bounds.minY - maxRadius ||
        bounds.minY > sweep.bounds.maxY + maxRadius
      ) {
        continue;
      }

      const radius = this.contactDistance(moving, staticLine);
      if (this.lineHitsSweep(staticLine, sweep, radius)) blockers.push(staticLine);
    }

    return blockers;
  }

  /**
   * 生成扫掠几何：每条运动子线段对应一个平行四边形。
   * 同时缓存每个四边形的包围盒，供粗筛使用。
   */
  buildSweep(moving, startOffset, endOffset) {
    if (!moving?.points || moving.points.length < 2) return null;

    const distance = endOffset - startOffset;
    const points = translatePoints(moving.points, moving.axis, startOffset);

    if (distance <= 1e-9) {
      return {
        points,
        quads: null,
        quadBounds: null,
        bounds: getPolylineBounds(points),
        distance: 0
      };
    }

    const quads = [];
    const quadBounds = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < points.length - 1; index += 1) {
      const quad = getSweptQuad(points[index], points[index + 1], moving.axis, distance);
      const bounds = getQuadBounds(quad);
      quads.push(quad);
      quadBounds.push(bounds);

      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }

    return {
      points,
      quads,
      quadBounds,
      bounds: { minX, minY, maxX, maxY },
      distance
    };
  }

  /** 静态线是否与移动线的扫掠区域接触。 */
  lineHitsSweep(staticLine, sweep, radius) {
    const radiusSq = radius * radius;
    const staticPoints = staticLine.points;

    if (!sweep.quads) {
      for (let i = 0; i < sweep.points.length - 1; i += 1) {
        const a1 = sweep.points[i];
        const a2 = sweep.points[i + 1];
        for (let j = 0; j < staticPoints.length - 1; j += 1) {
          if (segmentDistanceSq(a1, a2, staticPoints[j], staticPoints[j + 1]) <= radiusSq) {
            return true;
          }
        }
      }
      return false;
    }

    for (let j = 0; j < staticPoints.length - 1; j += 1) {
      const b1 = staticPoints[j];
      const b2 = staticPoints[j + 1];
      const segMinX = Math.min(b1.x, b2.x);
      const segMaxX = Math.max(b1.x, b2.x);
      const segMinY = Math.min(b1.y, b2.y);
      const segMaxY = Math.max(b1.y, b2.y);

      for (let i = 0; i < sweep.quads.length; i += 1) {
        const bounds = sweep.quadBounds[i];
        if (
          segMaxX < bounds.minX - radius ||
          segMinX > bounds.maxX + radius ||
          segMaxY < bounds.minY - radius ||
          segMinY > bounds.maxY + radius
        ) {
          continue;
        }

        if (segmentDistanceToPolygonSq(b1, b2, sweep.quads[i]) <= radiusSq) {
          return true;
        }
      }
    }

    return false;
  }

  getBounds(line) {
    if (!line.__bounds) {
      line.__bounds = getPolylineBounds(line.points);
    }
    return line.__bounds;
  }

  getMaxWidth(lines) {
    let maxWidth = 0;
    for (const line of lines) {
      if (line.width > maxWidth) maxWidth = line.width;
    }
    return maxWidth;
  }
}

function getQuadBounds(quad) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of quad) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}
