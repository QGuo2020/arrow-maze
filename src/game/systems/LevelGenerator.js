import { CONFIG } from '../../config.js';
import { CollisionSystem } from './CollisionSystem.js';
import { getPolylineBounds } from '../utils/geometry.js';
import {
  getFreeLineTarget,
  getKeyDependencyThreshold,
  getKeyStartTarget,
  getSegmentBoost
} from '../utils/difficulty.js';

const DIRECTION_NAMES = ['right', 'down', 'left', 'up'];
const DIRECTION_STEPS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 }
];

const MAX_LINES = 220;
const SHAPE_ATTEMPTS = 6000;
const MAX_CONSECUTIVE_FAILURES = 420;
const FREE_TOPUP_ATTEMPTS = 2500;

/**
 * 空间感知的“长蛇铺墙”生成器。
 *
 * 关键变化：不再随机抛一个短折线、失败了就换一个，而是从空格出发，
 * 在空格里持续生长一条长折线，直到达到目标段数或真的走不动。
 *
 * 1. 线条从 6~12 段起步，优先把长墙铺开；
 * 2. 生长时只看空格/空边，绕着已有线条走，因此能填满大片区域；
 * 3. 每条线生成后，分别尝试两个端点的箭头方向；
 * 4. 把“谁挡住谁”加入依赖图，保持无环；最多 8 条无阻挡的安全线；
 * 5. 空间被填满后，自动退化为填补小孔的短线。
 */
export function generateLevel(levelNumber, options = {}) {
  const level = Math.max(1, Math.floor(levelNumber));
  const attempts = options.attempts ?? 4;
  const targetFree = options.targetFree ?? getFreeLineTarget(level);
  const segmentBoost = options.segmentBoost ?? getSegmentBoost(level);
  const keyTarget = options.keyTarget ?? getKeyStartTarget(level);
  const keyThreshold =
    options.keyThreshold ?? getKeyDependencyThreshold(level);
  const collision = new CollisionSystem();
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = generateOnce(level, attempt, targetFree, segmentBoost);
    const quality = analyzeLevelQuality(
      result.lines,
      collision,
      keyThreshold
    );
    const freeGap = Math.abs(quality.freeCount - targetFree);
    const keyGap = Math.abs(quality.keyStartCount - keyTarget);
    // 优先匹配安全点/关键点预算，再选择线条更多的布局。
    // 这样高关卡不是单纯“线更多”，而是安全入口和关键突破更少。
    const score =
      result.lines.length * 0.5 - freeGap * 1000 - keyGap * 120;
    if (score > bestScore) {
      best = {
        ...result,
        freeCount: quality.freeCount,
        keyStartCount: quality.keyStartCount,
        keyThreshold
      };
      bestScore = score;
    }
  }

  if (!best || best.lines.length === 0) {
    throw new Error(`第 ${level} 关生成失败，请检查关卡生成器。`);
  }

  return {
    level,
    seed: best.seed,
    board: best.board,
    lines: best.lines,
    solution: best.solution,
    freeCount: best.freeCount,
    keyStartCount: best.keyStartCount,
    keyThreshold: best.keyThreshold
  };
}

export function createBoard() {
  const { cols, rows, cell } = CONFIG.board;
  const width = cols * cell;
  const height = rows * cell;
  return {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: height,
    width,
    height,
    centerX: width / 2,
    centerY: height / 2,
    cols,
    rows,
    cell
  };
}

function generateOnce(level, attempt, targetFree, segmentBoost) {
  const seed = hashSeed(level, attempt);
  const rng = mulberry32(seed);
  const board = createBoard();
  const collision = new CollisionSystem();
  const lines = [];
  const graph = new Map();
  const occupiedVertices = new Set();
  const occupiedEdges = new Set();
  let freeCount = 0;
  let consecutiveFailures = 0;

  function wouldCreateCycle(blockedBy, blocks) {
    if (blockedBy.length === 0 || blocks.length === 0) return false;
    const targets = new Set(blockedBy);
    const visited = new Set(blocks);
    const queue = [...blocks];

    for (const start of blocks) {
      if (targets.has(start)) return true;
    }

    while (queue.length > 0) {
      const current = queue.shift();
      const outgoing = graph.get(current);
      if (!outgoing) continue;
      for (const next of outgoing) {
        if (targets.has(next)) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }

  function analyze(line) {
    // 箭头射线不能穿过自己的身体，否则蛇形出发时会看起来像自撞
    if (collision.hitsOwnBody(line)) return null;
    // 拒绝盘成小螺旋/死结的线，这种线视觉上像“关死了”
    if (isTooCoiled(line)) return null;

    const blockedBy = [];
    const blocks = [];
    for (const other of lines) {
      if (collision.findRayBlock(line, [other], 3600)) blockedBy.push(other);
      if (collision.findRayBlock(other, [line], 3600)) blocks.push(other);
    }
    if (wouldCreateCycle(blockedBy, blocks)) return null;

    let freeDelta = blockedBy.length === 0 ? 1 : 0;
    for (const blocked of blocks) {
      if (!blocked.hasBlocker) freeDelta -= 1;
    }
    if (freeCount + freeDelta > targetFree) return null;
    return { blockedBy, blocks, freeDelta };
  }

  function commit(line, analysis, shape) {
    line.hasBlocker = analysis.blockedBy.length > 0;
    graph.set(line, new Set(analysis.blocks));
    for (const blocker of analysis.blockedBy) {
      if (!graph.has(blocker)) graph.set(blocker, new Set());
      graph.get(blocker).add(line);
    }
    for (const blocked of analysis.blocks) {
      blocked.hasBlocker = true;
    }

    freeCount += analysis.freeDelta;
    lines.push(line);
    for (const key of shape.vertexKeys) occupiedVertices.add(key);
    for (const key of shape.edgeKeys) occupiedEdges.add(key);
  }

  for (
    let attemptIndex = 0;
    attemptIndex < SHAPE_ATTEMPTS && lines.length < MAX_LINES;
    attemptIndex += 1
  ) {
    const shape = growShape(rng, occupiedVertices, occupiedEdges, segmentBoost);
    if (!shape) {
      consecutiveFailures += 1;
      if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) break;
      continue;
    }

    let accepted = false;
    const forward = makeLineFromPoints(shape.points, lines.length);
    const forwardAnalysis = analyze(forward);
    if (forwardAnalysis) {
      commit(forward, forwardAnalysis, shape);
      accepted = true;
    } else {
      // 另一端作为箭头，射线方向相反；很多线只有其中一个方向可解
      const reversed = makeLineFromPoints(
        [...shape.points].reverse(),
        lines.length
      );
      const reversedAnalysis = analyze(reversed);
      if (reversedAnalysis) {
        commit(reversed, reversedAnalysis, shape);
        accepted = true;
      }
    }

    consecutiveFailures = accepted ? 0 : consecutiveFailures + 1;
    if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) break;
  }

  // 收尾补安全线：把开局选择补到目标数量，避免同关随机波动过大
  for (
    let topup = 0;
    topup < FREE_TOPUP_ATTEMPTS && freeCount < targetFree;
    topup += 1
  ) {
    const shape = growShape(rng, occupiedVertices, occupiedEdges, segmentBoost);
    if (!shape) continue;

    const forward = makeLineFromPoints(shape.points, lines.length);
    const forwardAnalysis = analyze(forward);
    if (forwardAnalysis && forwardAnalysis.freeDelta > 0) {
      commit(forward, forwardAnalysis, shape);
      continue;
    }

    const reversed = makeLineFromPoints(
      [...shape.points].reverse(),
      lines.length
    );
    const reversedAnalysis = analyze(reversed);
    if (reversedAnalysis && reversedAnalysis.freeDelta > 0) {
      commit(reversed, reversedAnalysis, shape);
    }
  }

  const order = topologicalOrder(lines, graph);
  if (order.length !== lines.length) {
    throw new Error('关卡依赖图出现环，生成器逻辑需要检查。');
  }

  return {
    seed,
    board,
    lines,
    solution: order.map((line) => line.id),
    freeCount
  };
}

/**
 * 从随机空格出发，在未占用的格点上生长一条长折线。
 * 每一步会在“直行/左转/右转”和 1~5 格长度里选择综合评分最高的走法。
 */
function growShape(rng, occupiedVertices, occupiedEdges, segmentBoost = 0) {
  const { cols, rows, gridMargin } = CONFIG.board;
  const minC = gridMargin;
  const maxC = cols - gridMargin;
  const minR = gridMargin;
  const maxR = rows - gridMargin;

  let start = null;
  for (let tryIndex = 0; tryIndex < 36; tryIndex += 1) {
    const c = randomInt(rng, minC, maxC);
    const r = randomInt(rng, minR, maxR);
    if (!occupiedVertices.has(vertexKey(c, r))) {
      start = { c, r };
      break;
    }
  }
  if (!start) return null;

  const targetSegments =
    weightedChoice(rng, [
      [6, 0.10],
      [7, 0.14],
      [8, 0.18],
      [9, 0.18],
      [10, 0.16],
      [11, 0.12],
      [12, 0.12]
    ]) + segmentBoost;

  let { c, r } = start;
  let direction = randomInt(rng, 0, 3);
  const points = [{ c, r }];
  const vertexKeys = new Set([vertexKey(c, r)]);
  const edgeKeys = new Set();
  let segments = 0;

  for (let segment = 0; segment < targetSegments; segment += 1) {
    const directions =
      segment === 0
        ? [0, 1, 2, 3]
        : [direction, (direction + 1) % 4, (direction + 3) % 4];

    const options = [];
    for (const candidateDirection of directions) {
      const step = DIRECTION_STEPS[candidateDirection];
      for (const length of [5, 4, 3, 2, 1]) {
        const end = previewSegment(
          c,
          r,
          step,
          length,
          minC,
          maxC,
          minR,
          maxR,
          occupiedVertices,
          occupiedEdges,
          vertexKeys,
          edgeKeys
        );
        if (!end) continue;

        let open = 0;
        for (const nextDirection of DIRECTION_STEPS) {
          const nextC = end.c + nextDirection.x;
          const nextR = end.r + nextDirection.y;
          if (nextC < minC || nextC > maxC || nextR < minR || nextR > maxR) {
            continue;
          }
          const key = vertexKey(nextC, nextR);
          if (!occupiedVertices.has(key) && !vertexKeys.has(key)) open += 1;
        }

        options.push({
          direction: candidateDirection,
          length,
          end,
          score: length * 0.9 + open * 1.15 + rng() * 1.4
        });
      }
    }

    if (options.length === 0) break;

    options.sort((left, right) => right.score - left.score);
    const chosen = options[0];
    const step = DIRECTION_STEPS[chosen.direction];

    let nextC = c;
    let nextR = r;
    for (let unit = 0; unit < chosen.length; unit += 1) {
      const stepC = nextC + step.x;
      const stepR = nextR + step.y;
      edgeKeys.add(edgeKey(nextC, nextR, stepC, stepR));
      nextC = stepC;
      nextR = stepR;
      vertexKeys.add(vertexKey(nextC, nextR));
    }

    c = nextC;
    r = nextR;
    direction = chosen.direction;
    points.push({ c, r });
    segments += 1;
  }

  if (segments < 2) return null;
  return { points, vertexKeys, edgeKeys };
}

/** 只检查一段是否可用，不写入占用。 */
function previewSegment(
  startC,
  startR,
  step,
  length,
  minC,
  maxC,
  minR,
  maxR,
  occupiedVertices,
  occupiedEdges,
  localVertices,
  localEdges
) {
  let c = startC;
  let r = startR;
  for (let unit = 0; unit < length; unit += 1) {
    const nextC = c + step.x;
    const nextR = r + step.y;
    if (nextC < minC || nextC > maxC || nextR < minR || nextR > maxR) {
      return null;
    }

    const edge = edgeKey(c, r, nextC, nextR);
    if (occupiedEdges.has(edge) || localEdges.has(edge)) return null;

    const vertex = vertexKey(nextC, nextR);
    if (occupiedVertices.has(vertex) || localVertices.has(vertex)) return null;

    c = nextC;
    r = nextR;
  }
  return { c, r };
}

function makeLineFromPoints(gridPoints, index) {
  const { cell } = CONFIG.board;
  const points = gridPoints.map((point) => ({
    x: point.c * cell,
    y: point.r * cell
  }));
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  const axis = directionBetween(previous, last);

  return {
    id: `L${String(index + 1).padStart(3, '0')}`,
    points,
    direction: axis.name,
    axis: { x: axis.x, y: axis.y },
    width: CONFIG.line.defaultWidth,
    cleared: false,
    __bounds: getPolylineBounds(points)
  };
}

function directionBetween(from, to) {
  if (to.x > from.x) return { name: 'right', x: 1, y: 0 };
  if (to.x < from.x) return { name: 'left', x: -1, y: 0 };
  if (to.y > from.y) return { name: 'down', x: 0, y: 1 };
  return { name: 'up', x: 0, y: -1 };
}

/**
 * 识别盘成小螺旋/死结的线。
 *
 * 这类线即使逻辑上可解，箭头也会埋在自身线圈里，玩家看起来会像
 * “自己把自己关死了”。过滤掉紧凑、拐弯多、路径/包围盒比例高的形状。
 */
export function isTooCoiled(line) {
  const points = line.points;
  if (!points || points.length < 5) return false;

  let pathLength = 0;
  let turns = 0;
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    pathLength += Math.hypot(current.x - previous.x, current.y - previous.y);

    if (index >= 2) {
      const before = points[index - 2];
      const ax = previous.x - before.x;
      const ay = previous.y - before.y;
      const bx = current.x - previous.x;
      const by = current.y - previous.y;
      if (Math.abs(ax * bx + ay * by) < 1e-6) turns += 1;
    }
  }

  const bounds = getPolylineBounds(points);
  const compactness =
    pathLength / Math.max(1, bounds.width + bounds.height);
  const cell = CONFIG.board.cell;
  const small =
    bounds.width <= cell * 5.5 && bounds.height <= cell * 5.5;

  if (turns >= 5 && compactness >= 2.35 && small) return true;
  if (turns >= 4 && compactness >= 2.1 && small) return true;
  return false;
}

/**
 * 计算开局安全点和关键点数量。
 *
 * 关键点：一条开局可点的线，直接挡住至少 `keyThreshold` 条其他线的路径。
 * 它是依赖图里的高影响力节点，而不是预先标出来的答案。
 */
function analyzeLevelQuality(lines, collision, keyThreshold) {
  const blockersByLine = new Map();
  for (const line of lines) {
    blockersByLine.set(
      line,
      collision.findRayBlockers(line, lines, 3600)
    );
  }

  let freeCount = 0;
  let keyStartCount = 0;

  for (const line of lines) {
    if (blockersByLine.get(line).length > 0) continue;
    freeCount += 1;

    let dependents = 0;
    for (const other of lines) {
      if (other === line || other.cleared) continue;
      if (blockersByLine.get(other).includes(line)) dependents += 1;
    }

    if (dependents >= keyThreshold) keyStartCount += 1;
  }

  return { freeCount, keyStartCount };
}

function topologicalOrder(lines, graph) {
  const indegree = new Map(lines.map((line) => [line, 0]));
  for (const outgoing of graph.values()) {
    for (const target of outgoing) {
      indegree.set(target, (indegree.get(target) || 0) + 1);
    }
  }

  const queue = lines.filter((line) => indegree.get(line) === 0);
  const order = [];
  while (queue.length > 0) {
    const line = queue.shift();
    order.push(line);
    const outgoing = graph.get(line);
    if (!outgoing) continue;
    for (const target of outgoing) {
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  return order;
}

function vertexKey(c, r) {
  return `${c},${r}`;
}

function edgeKey(c1, r1, c2, r2) {
  if (r1 === r2) return `H${Math.min(c1, c2)},${r1}`;
  return `V${c1},${Math.min(r1, r2)}`;
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function weightedChoice(rng, entries) {
  const roll = rng();
  let accumulated = 0;
  for (const [value, weight] of entries) {
    accumulated += weight;
    if (roll <= accumulated) return value;
  }
  return entries[entries.length - 1][0];
}

/** 字符串哈希，保证同一关的种子稳定。 */
function hashSeed(level, attempt) {
  let hash = 2166136261;
  const text = `arrow-maze-grow:${level}:${attempt}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 轻量、可复现的伪随机数生成器。 */
export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
