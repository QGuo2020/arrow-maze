import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distanceToPolyline,
  getArrowGeometry,
  getPolylineBounds,
  pointInTriangle,
  pointSegmentDistanceSq,
  rayCapsuleFirstHit,
  segmentDistanceToPolygonSq,
  segmentsIntersect
} from '../src/game/utils/geometry.js';
import { ArrowLine } from '../src/game/entities/ArrowLine.js';
import { CollisionSystem } from '../src/game/systems/CollisionSystem.js';
import { createBoard, generateLevel, isTooCoiled } from '../src/game/systems/LevelGenerator.js';
import { Easing, Tween } from '../src/game/utils/Tween.js';
import { Camera2D } from '../src/game/Camera2D.js';
import {
  calculateTimeLimit,
  formatTime,
  getFreeLineTarget,
  getKeyDependencyThreshold,
  getKeyStartTarget,
  getSegmentBoost,
  getShortLineRatio,
  getShortLineTarget
} from '../src/game/utils/difficulty.js';

const EPSILON = 1e-6;

test('点到线段的最短距离：垂足在线段内', () => {
  const distanceSq = pointSegmentDistanceSq(
    { x: 5, y: 10 },
    { x: 0, y: 0 },
    { x: 10, y: 0 }
  );
  assert.ok(Math.abs(distanceSq - 100) < EPSILON);
});

test('点到线段的最短距离：垂足落在端点外时取端点距离', () => {
  const distanceSq = pointSegmentDistanceSq(
    { x: 20, y: 0 },
    { x: 0, y: 0 },
    { x: 10, y: 0 }
  );
  assert.equal(distanceSq, 100);
});

test('折线距离能正确判定拐角附近的点', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ];

  assert.ok(Math.abs(distanceToPolyline({ x: 104, y: 44 }, points) - 4) < EPSILON);
  assert.ok(distanceToPolyline({ x: 50, y: 50 }, points) > 49);
});

test('轴对齐包围盒包含 padding 且中心正确', () => {
  const bounds = getPolylineBounds(
    [
      { x: -20, y: 10 },
      { x: 30, y: -30 }
    ],
    5
  );

  assert.deepEqual(
    {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      centerX: bounds.centerX,
      centerY: bounds.centerY
    },
    { minX: -25, minY: -35, maxX: 35, maxY: 15, centerX: 5, centerY: -10 }
  );
});

test('箭头三角形命中测试与方向几何一致', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 }
  ];
  const arrow = getArrowGeometry(points, { x: 1, y: 0 }, 20, 10);

  assert.equal(arrow.tip.x, 120);
  assert.equal(arrow.tip.y, 0);
  assert.ok(pointInTriangle({ x: 110, y: 0 }, arrow.tip, arrow.baseA, arrow.baseB));
  assert.ok(!pointInTriangle({ x: 80, y: 30 }, arrow.tip, arrow.baseA, arrow.baseB));
});

test('线段相交与共线重叠都能被检测', () => {
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: -5 },
      { x: 5, y: 5 }
    ),
    true
  );
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 8, y: 0 }
    ),
    true
  );
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 11, y: -1 },
      { x: 11, y: 1 }
    ),
    false
  );
});

test('线段到凸四边形的距离计算正确', () => {
  const quad = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];

  // 在四边形内部
  assert.equal(
    segmentDistanceToPolygonSq({ x: 2, y: 2 }, { x: 4, y: 4 }, quad),
    0
  );

  // 与四边形右侧相距 3
  const distanceSq = segmentDistanceToPolygonSq(
    { x: 13, y: -5 },
    { x: 13, y: 15 },
    quad
  );
  assert.ok(Math.abs(distanceSq - 9) < EPSILON);
});

test('蛇形采样：L 形线段会从尾巴开始逐节沿轨道抽出', () => {
  const line = new ArrowLine({
    id: 'snake',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 }
    ],
    direction: 'right',
    width: 7
  });

  const points = line.getPointsAt(50);
  assert.deepEqual(
    points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })),
    [
      { x: 0, y: 50 },
      { x: 50, y: 100 },
      { x: 150, y: 100 }
    ]
  );

  // 头部前进超过身体长度后，整条线已经沿射线拉直
  const straight = line.getPointsAt(200);
  assert.equal(straight[0].x, 100);
  assert.equal(straight[1].x, 200);
  assert.equal(straight[2].x, 300);
  assert.equal(straight[0].y, 100);
  assert.equal(straight[2].y, 100);
});

test('蛇形出屏距离 = 头部到边缘距离 + 身体总长度', () => {
  const line = new ArrowLine({
    id: 'snake-exit',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 }
    ],
    direction: 'right',
    width: 7
  });

  const board = { minX: 0, minY: 0, maxX: 400, maxY: 600 };
  assert.equal(line.bodyLength, 200);
  assert.equal(line.getHeadEdgeDistance(board, 50), 350);
  assert.equal(line.getExitDistance(board, 50), 550);
});

test('射线到胶囊体的首次接触距离精确', () => {
  const origin = { x: 0, y: 0 };
  const direction = { x: 1, y: 0 };

  assert.equal(
    rayCapsuleFirstHit(
      origin,
      direction,
      { x: 100, y: -10 },
      { x: 100, y: 10 },
      5
    ),
    95
  );

  // 从端点圆帽外侧擦过
  const capHit = rayCapsuleFirstHit(
    origin,
    direction,
    { x: 100, y: 8 },
    { x: 100, y: 20 },
    10
  );
  assert.ok(Math.abs(capHit - (100 - Math.sqrt(100 - 64))) < 1e-6);

  // 射线与胶囊没有交点
  assert.equal(
    rayCapsuleFirstHit(
      origin,
      direction,
      { x: 100, y: 30 },
      { x: 100, y: 50 },
      5
    ),
    Number.POSITIVE_INFINITY
  );
});

test('ArrowLine 能精确命中折线与箭头，而不是只依赖包围盒', () => {
  const line = new ArrowLine({
    id: 'test',
    points: [
      { x: -50, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 }
    ],
    direction: 'up',
    width: 6,
    hitTolerance: 10
  });

  assert.equal(line.containsPoint({ x: -25, y: 52 }, 5), true);
  assert.equal(line.containsPoint({ x: 12, y: 25 }, 5), false);
  // 末端朝上，箭头尖在 (0, 0 - 19)
  assert.equal(line.containsPoint({ x: 0, y: -14 }, 5), true);
});

test('右向线段的退出距离由最左侧点决定，确保整条线完全出屏', () => {
  const line = new ArrowLine({
    id: 'exit',
    points: [
      { x: -100, y: 0 },
      { x: 100, y: 0 }
    ],
    direction: 'right'
  });

  const board = { minX: 0, minY: 0, maxX: 400, maxY: 600 };
  const distance = line.getExitDistance(board, 50);
  assert.equal(distance, 550); // 400 + 50 - (-100)
});

test('滑出 Tween 完成后状态为 cleared 且回调只触发一次', () => {
  const line = new ArrowLine({
    id: 'slide',
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 }
    ],
    direction: 'right'
  });

  let completed = 0;
  line.startSlide(200, {
    duration: 100,
    onComplete: () => {
      completed += 1;
    }
  });

  line.update(0.05);
  assert.equal(line.state, 'sliding');
  assert.ok(line.offset > 0);

  line.update(0.05);
  line.update(0.05);
  assert.equal(line.state, 'cleared');
  assert.equal(line.cleared, true);
  assert.equal(line.offset, 200);
  assert.equal(completed, 1);
  assert.equal(line.containsPoint({ x: 0, y: 0 }, 1000), false);
});

test('Tween 在 duration 为 0 时也能安全完成一次', () => {
  const values = [];
  let completed = 0;
  const tween = new Tween({
    from: 0,
    to: 10,
    duration: 0,
    easing: Easing.easeInOutCubic,
    onUpdate: (value) => values.push(value),
    onComplete: () => {
      completed += 1;
    }
  });

  tween.update(16);
  tween.update(16);
  assert.deepEqual(values, [10]);
  assert.equal(completed, 1);
  assert.equal(tween.finished, true);
});

test('扫掠碰撞能精确求出接触距离，并且不会把旁边平行的线误判为阻挡', () => {
  const collision = new CollisionSystem();
  const moving = {
    id: 'moving',
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 }
    ],
    axis: { x: 1, y: 0 },
    direction: 'right',
    width: 7
  };
  const blocker = {
    id: 'blocker',
    points: [
      { x: 150, y: -50 },
      { x: 150, y: 50 }
    ],
    axis: { x: 0, y: 1 },
    direction: 'down',
    width: 7
  };
  const farAway = {
    id: 'far',
    points: [
      { x: 150, y: 200 },
      { x: 150, y: 300 }
    ],
    axis: { x: 0, y: 1 },
    direction: 'down',
    width: 7
  };

  const hit = collision.findBlockingOffset(moving, [blocker], 300);
  assert.ok(hit);
  // 阈值 = 3.5 + 3.5 + 0.8 = 7.8；接触时线段末端到竖线的距离为 7.8
  assert.ok(Math.abs(hit.distance - (150 - 50 - 7.8)) < 0.5);

  const noHit = collision.findBlockingOffset(moving, [farAway], 300);
  assert.equal(noHit, null);
});

test('蛇形移动只检查头部射线：身体一侧的障碍不会误判为阻挡', () => {
  const collision = new CollisionSystem();
  const moving = new ArrowLine({
    id: 'snake-ray',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 }
    ],
    direction: 'right',
    width: 7
  });
  const sideBlocker = {
    id: 'side',
    points: [
      { x: 50, y: 40 },
      { x: 50, y: 60 }
    ],
    axis: { x: 0, y: 1 },
    direction: 'down',
    width: 7
  };

  // 旧的整体刚体扫掠会认为它挡在身体侧面
  const rigidHit = collision.findBlockingOffset(moving, [sideBlocker], 400);
  assert.ok(rigidHit);

  // 蛇形运动只沿头部射线前进，侧面的线不会被撞到
  const rayHit = collision.findRayBlock(moving, [sideBlocker], 400);
  assert.equal(rayHit, null);
});

test('关卡生成器默认生成密集、四方向且可解的关卡', () => {
  const data = generateLevel(1);
  const directions = new Set(data.lines.map((line) => line.direction));

  assert.ok(data.lines.length >= 60, `expected dense level, got ${data.lines.length}`);
  assert.equal(data.solution.length, data.lines.length);
  assert.equal(directions.size, 4);
  assert.equal(data.board.width, 840);
  assert.equal(data.board.height, 1296);

  // 初始可安全点击的箭头应该很少，否则关卡太简单
  const collision = new CollisionSystem();
  let freeCount = 0;
  for (const line of data.lines) {
    const others = data.lines.filter((candidate) => candidate !== line);
    if (!collision.findRayBlock(line, others, 2200)) freeCount += 1;
  }
  assert.ok(freeCount <= 25, `too many free lines: ${freeCount}`);
  assert.ok(freeCount >= 1, 'level needs at least one safe line');
  assert.equal(data.freeCount, freeCount);
  assert.ok(
    data.keyStartCount >= 0 && data.keyStartCount <= data.freeCount,
    'key starts must be a subset of free lines'
  );
  assert.equal(data.keyThreshold, getKeyDependencyThreshold(1));
  assert.ok(data.shortLineCount > 0, 'level should contain short lines');
  for (let index = 0; index < data.lines.length; index += 1) {
    const line = data.lines[index];
    const others = data.lines.filter((_, otherIndex) => otherIndex !== index);
    const startHit = collision.hasCollisionWithin(
      line,
      others,
      0,
      0
    );
    assert.equal(startHit, null, `${line.id} 与其他线在初始状态接触`);
    assert.equal(
      collision.hitsOwnBody(line),
      false,
      `${line.id} 的箭头射线穿过了自己的身体`
    );
    assert.equal(isTooCoiled(line), false, `${line.id} 是紧凑螺旋线`);
  }

  // 按 solution 顺序模拟（游戏内是蛇形射线规则）
  const remaining = new Map(data.lines.map((line) => [line.id, line]));
  for (const id of data.solution) {
    const line = remaining.get(id);
    assert.ok(line, `solution 引用了不存在的线段 ${id}`);
    const others = [...remaining.values()].filter((candidate) => candidate.id !== id);
    const blocker = collision.findRayBlock(line, others, 3200);
    assert.equal(blocker, null, `${id} 在 solution 步骤中仍被 ${blocker?.line?.id} 阻挡`);
    remaining.delete(id);
  }
  assert.equal(remaining.size, 0);
});

test('不同 seed 的关卡都保留完整可解集合', () => {
  for (const level of [2, 3, 7]) {
    const data = generateLevel(level);
    assert.ok(data.lines.length >= 40, `第 ${level} 关密度不足`);
    assert.equal(
      data.solution.length,
      data.lines.length,
      `第 ${level} 关有线段被可解性过滤丢弃`
    );
  }
});

test('箭头射线穿过自身身体时会被识别为自撞', () => {
  const collision = new CollisionSystem();
  const uTurn = {
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 20, y: 100 },
      { x: 20, y: 20 }
    ],
    axis: { x: 0, y: -1 },
    width: 7
  };
  const clear = {
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ],
    axis: { x: 1, y: 0 },
    width: 7
  };

  assert.equal(collision.hitsOwnBody(uTurn), true);
  assert.equal(collision.hitsOwnBody(clear), false);
});

test('限时默认 6 分钟起，随关卡/线数增加，并支持调整基础时间', () => {
  assert.ok(calculateTimeLimit(2, 100) > calculateTimeLimit(1, 100));
  assert.ok(calculateTimeLimit(7, 100) > calculateTimeLimit(2, 100));
  assert.ok(calculateTimeLimit(1, 120) > calculateTimeLimit(1, 100));
  assert.equal(calculateTimeLimit(1, 100, 6), 380);
  assert.equal(calculateTimeLimit(1, 100, 8), 500);
  assert.equal(formatTime(380), '06:20');
  assert.equal(formatTime(140), '02:20');
  assert.equal(formatTime(59), '00:59');
  assert.equal(formatTime(0), '00:00');
});

test('难度曲线：安全线逐级减少，线条逐级变长，关键点逐级变少', () => {
  assert.equal(getFreeLineTarget(1), 8);
  assert.ok(getFreeLineTarget(3) < getFreeLineTarget(1));
  assert.ok(getFreeLineTarget(7) < getFreeLineTarget(3));
  assert.equal(getFreeLineTarget(30), 3);
  assert.ok(getSegmentBoost(10) > getSegmentBoost(1));
  assert.equal(getSegmentBoost(30), 4);
  assert.equal(getKeyDependencyThreshold(1), 10);
  assert.ok(
    getKeyDependencyThreshold(10) > getKeyDependencyThreshold(1)
  );
  assert.equal(getKeyDependencyThreshold(30), 20);
  assert.ok(getKeyStartTarget(1) > getKeyStartTarget(7));
  assert.equal(getKeyStartTarget(30), 1);
  assert.ok(getShortLineTarget(10) > getShortLineTarget(1));
  assert.equal(getShortLineTarget(30), 85);
  assert.ok(getShortLineRatio(10) > getShortLineRatio(1));
  assert.equal(getShortLineRatio(30), 0.62);
});

test('紧凑螺旋/死结线条会被质检过滤', () => {
  const spiral = {
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 120 },
      { x: 24, y: 120 },
      { x: 24, y: 24 },
      { x: 96, y: 24 },
      { x: 96, y: 72 }
    ]
  };
  assert.equal(isTooCoiled(spiral), true);
});

test('摄像机世界坐标与屏幕坐标可逆，并支持围绕指定点缩放', () => {
  const camera = new Camera2D();
  const board = createBoard();
  camera.setViewport(390, 844);
  camera.setBoard(board);

  const world = { x: 250, y: 400 };
  const screen = camera.worldToScreen(world);
  const roundTrip = camera.screenToWorld(screen);
  assert.ok(Math.abs(roundTrip.x - world.x) < 1e-6);
  assert.ok(Math.abs(roundTrip.y - world.y) < 1e-6);

  const focus = { x: 200, y: 300 };
  const worldAtFocus = camera.screenToWorld(focus);
  camera.setZoomFactor(2, focus);
  const worldAfterZoom = camera.screenToWorld(focus);
  assert.ok(Math.abs(worldAfterZoom.x - worldAtFocus.x) < 1e-5);
  assert.ok(Math.abs(worldAfterZoom.y - worldAtFocus.y) < 1e-5);
  assert.ok(camera.zoomFactor > 1);
});
