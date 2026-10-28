/**
 * 纯几何工具，不依赖 DOM，方便单独做单元测试。
 * 线段是“折线 + 线宽”，因此输入命中检测使用点到每一条子线段的最短距离。
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 点到线段的最短距离的平方，避免开销较大的开方。 */
export function pointSegmentDistanceSq(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;

  let t = 0;
  if (lengthSq > 0) {
    t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq;
    t = clamp(t, 0, 1);
  }

  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  const dx = point.x - closestX;
  const dy = point.y - closestY;
  return dx * dx + dy * dy;
}

/** 点到整条折线的最短距离。折线至少包含两个点。 */
export function distanceToPolyline(point, points) {
  if (!Array.isArray(points) || points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y);
  }

  let minDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const distanceSq = pointSegmentDistanceSq(point, points[index], points[index + 1]);
    if (distanceSq < minDistanceSq) minDistanceSq = distanceSq;
  }
  return Math.sqrt(minDistanceSq);
}

/** 轴对齐包围盒，后续碰撞粗筛和镜头 auto-fit 都会用到。 */
export function getPolylineBounds(points, padding = 0) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * 根据箭头方向和折线末端，计算箭头三角形的三个顶点。
 * 绘制和点击命中共用这一份几何，避免视觉箭头与可点击区域对不上。
 */
export function getArrowGeometry(points, direction, length = 19, width = 11) {
  const end = points[points.length - 1];
  const dirLength = Math.hypot(direction.x, direction.y) || 1;
  const dirX = direction.x / dirLength;
  const dirY = direction.y / dirLength;
  const perpX = -dirY;
  const perpY = dirX;

  return {
    baseX: end.x,
    baseY: end.y,
    tip: {
      x: end.x + dirX * length,
      y: end.y + dirY * length
    },
    baseA: {
      x: end.x + perpX * width,
      y: end.y + perpY * width
    },
    baseB: {
      x: end.x - perpX * width,
      y: end.y - perpY * width
    },
    direction: { x: dirX, y: dirY }
  };
}

/** 三角形包含测试，用于让箭头区域也可被点中。 */
export function pointInTriangle(point, a, b, c) {
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);

  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function sign(point, a, b) {
  return (point.x - b.x) * (a.y - b.y) - (a.x - b.x) * (point.y - b.y);
}

/** 二维叉积，用于线段相交和凸多边形判定。 */
export function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function orientation(a, b, c) {
  return cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
}

function pointOnSegment(point, a, b, epsilon = 1e-7) {
  if (Math.abs(orientation(a, b, point)) > epsilon) return false;
  return (
    point.x >= Math.min(a.x, b.x) - epsilon &&
    point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon &&
    point.y <= Math.max(a.y, b.y) + epsilon
  );
}

/** 两条线段是否相交（包含端点接触与共线重叠）。 */
export function segmentsIntersect(a1, a2, b1, b2, epsilon = 1e-7) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (Math.abs(o1) <= epsilon && pointOnSegment(b1, a1, a2, epsilon)) return true;
  if (Math.abs(o2) <= epsilon && pointOnSegment(b2, a1, a2, epsilon)) return true;
  if (Math.abs(o3) <= epsilon && pointOnSegment(a1, b1, b2, epsilon)) return true;
  if (Math.abs(o4) <= epsilon && pointOnSegment(a2, b1, b2, epsilon)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * 两条线段之间的最短距离平方。
 * 这是细线碰撞的基础：先判断相交，再比较四个端点到对侧线段的最短距离。
 */
export function segmentDistanceSq(a1, a2, b1, b2) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;

  return Math.min(
    pointSegmentDistanceSq(a1, b1, b2),
    pointSegmentDistanceSq(a2, b1, b2),
    pointSegmentDistanceSq(b1, a1, a2),
    pointSegmentDistanceSq(b2, a1, a2)
  );
}

/** 射线法判断点是否在任意多边形内部。 */
export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * 线段到凸多边形的最近距离平方。
 * 用于“运动线段扫过的四边形”与静态线段的精确碰撞，避免采样导致的穿模。
 */
export function segmentDistanceToPolygonSq(segmentA, segmentB, polygon) {
  if (polygon.length < 3) return Number.POSITIVE_INFINITY;

  for (let index = 0; index < polygon.length; index += 1) {
    const edgeA = polygon[index];
    const edgeB = polygon[(index + 1) % polygon.length];
    if (segmentsIntersect(segmentA, segmentB, edgeA, edgeB)) return 0;
  }

  if (pointInPolygon(segmentA, polygon)) return 0;

  let minDistanceSq = Number.POSITIVE_INFINITY;

  for (const vertex of polygon) {
    const distanceSq = pointSegmentDistanceSq(vertex, segmentA, segmentB);
    if (distanceSq < minDistanceSq) minDistanceSq = distanceSq;
  }

  for (let index = 0; index < polygon.length; index += 1) {
    const edgeA = polygon[index];
    const edgeB = polygon[(index + 1) % polygon.length];
    const startDistanceSq = pointSegmentDistanceSq(segmentA, edgeA, edgeB);
    const endDistanceSq = pointSegmentDistanceSq(segmentB, edgeA, edgeB);
    if (startDistanceSq < minDistanceSq) minDistanceSq = startDistanceSq;
    if (endDistanceSq < minDistanceSq) minDistanceSq = endDistanceSq;
  }

  return minDistanceSq;
}

/** 将折线上的每个点按方向平移指定距离。 */
export function translatePoints(points, direction, distance) {
  return points.map((point) => ({
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance
  }));
}

/**
 * 射线与“胶囊体”的首次接触距离。
 *
 * 胶囊体 = 一条静态线段向四周膨胀 radius。这里用于蛇形移动：
 * 箭头头部沿方向前进，身体沿轨迹跟随，因此头部射线就是最先接触障碍的部位。
 *
 * @returns {number} 首次接触时的射线参数 t（origin + direction * t），无接触返回 Infinity
 */
export function rayCapsuleFirstHit(origin, direction, segmentA, segmentB, radius, maxDistance = Infinity) {
  if (!Number.isFinite(radius) || radius < 0) return Number.POSITIVE_INFINITY;

  const radiusSq = radius * radius;
  if (pointSegmentDistanceSq(origin, segmentA, segmentB) <= radiusSq) return 0;

  const dx = direction.x;
  const dy = direction.y;
  let best = Number.POSITIVE_INFINITY;

  // 两个圆形端帽
  for (const center of [segmentA, segmentB]) {
    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - radiusSq;
    const discriminant = b * b - 4 * c;
    if (discriminant < 0) continue;

    const root = Math.sqrt(discriminant);
    const t1 = (-b - root) / 2;
    if (t1 >= 0 && t1 < best) best = t1;
  }

  // 端帽之间的矩形条带
  const abx = segmentB.x - segmentA.x;
  const aby = segmentB.y - segmentA.y;
  const length = Math.hypot(abx, aby);

  if (length > 1e-7) {
    const ux = abx / length;
    const uy = aby / length;
    const nx = -uy;
    const ny = ux;
    const relX = origin.x - segmentA.x;
    const relY = origin.y - segmentA.y;

    const s0 = relX * ux + relY * uy;
    const sd = dx * ux + dy * uy;
    const p0 = relX * nx + relY * ny;
    const pd = dx * nx + dy * ny;

    let low = 0;
    let high = maxDistance;

    // 沿线段方向的区间：0 <= s0 + t * sd <= length
    if (Math.abs(sd) < 1e-9) {
      if (s0 < 0 || s0 > length) {
        return Number.isFinite(best) && best <= maxDistance
          ? best
          : Number.POSITIVE_INFINITY;
      }
    } else {
      let t1 = -s0 / sd;
      let t2 = (length - s0) / sd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      low = Math.max(low, t1);
      high = Math.min(high, t2);
    }

    // 垂直方向的区间：|p0 + t * pd| <= radius
    if (Math.abs(pd) < 1e-9) {
      if (Math.abs(p0) > radius) {
        return Number.isFinite(best) && best <= maxDistance
          ? best
          : Number.POSITIVE_INFINITY;
      }
    } else {
      let t1 = (-radius - p0) / pd;
      let t2 = (radius - p0) / pd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      low = Math.max(low, t1);
      high = Math.min(high, t2);
    }

    if (high >= low && high >= 0) {
      const t = Math.max(0, low);
      if (t < best) best = t;
    }
  }

  return best <= maxDistance ? best : Number.POSITIVE_INFINITY;
}

/** 一条线段沿方向平移 distance 后扫过的平行四边形。 */
export function getSweptQuad(a, b, direction, distance) {
  const vx = direction.x * distance;
  const vy = direction.y * distance;
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
    { x: b.x + vx, y: b.y + vy },
    { x: a.x + vx, y: a.y + vy }
  ];
}
