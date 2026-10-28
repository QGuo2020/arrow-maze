import { CONFIG } from '../../config.js';

/**
 * 棋盘底图与辅助线。
 * 棋盘本身是一块有边界的区域，线段飞出边界后才算清除。
 */
export class BoardRenderer {
  draw(ctx, board, camera, { guides = false, focusLine = null, palette = CONFIG.themes.dark } = {}) {
    const padding = CONFIG.board.padding;
    const x = board.minX - padding;
    const y = board.minY - padding;
    const width = board.width + padding * 2;
    const height = board.height + padding * 2;
    const radius = 18;

    ctx.save();

    // 外发光与底色
    ctx.shadowColor = palette.boardShadow;
    ctx.shadowBlur = 34;
    traceRoundedRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = palette.boardFill;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = palette.boardBorder;
    ctx.lineWidth = 1 / camera.scale;
    ctx.stroke();

    // 顶部微光，让棋盘有“玻璃面板”质感
    const topGlow = ctx.createLinearGradient(0, y, 0, y + height * 0.22);
    topGlow.addColorStop(0, palette.boardTopGlow);
    topGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    traceRoundedRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = topGlow;
    ctx.fill();

    if (guides) {
      this.drawGrid(ctx, board, camera, palette);
    }

    this.drawCornerBrackets(ctx, board, camera, palette);

    if (guides && focusLine && focusLine.isIdle) {
      this.drawEscapeRay(ctx, board, focusLine, camera, palette);
    }

    ctx.restore();
  }

  drawGrid(ctx, board, camera, palette) {
    const cell = board.cell;
    const minorWidth = 1 / camera.scale;
    const majorWidth = 1.2 / camera.scale;

    ctx.save();
    traceRoundedRect(ctx, board.minX, board.minY, board.width, board.height, 14);
    ctx.clip();

    ctx.lineWidth = minorWidth;
    ctx.strokeStyle = palette.gridMinor;
    ctx.beginPath();
    for (let c = 1; c < board.cols; c += 1) {
      if (c % 4 === 0) continue;
      const x = c * cell;
      ctx.moveTo(x, board.minY);
      ctx.lineTo(x, board.maxY);
    }
    for (let r = 1; r < board.rows; r += 1) {
      if (r % 4 === 0) continue;
      const y = r * cell;
      ctx.moveTo(board.minX, y);
      ctx.lineTo(board.maxX, y);
    }
    ctx.stroke();

    ctx.lineWidth = majorWidth;
    ctx.strokeStyle = palette.gridMajor;
    ctx.beginPath();
    for (let c = 4; c < board.cols; c += 4) {
      const x = c * cell;
      ctx.moveTo(x, board.minY);
      ctx.lineTo(x, board.maxY);
    }
    for (let r = 4; r < board.rows; r += 4) {
      const y = r * cell;
      ctx.moveTo(board.minX, y);
      ctx.lineTo(board.maxX, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 箭头即将飞出的方向射线，配合辅助线使用。 */
  drawEscapeRay(ctx, board, line, camera, palette) {
    const arrow = line.getArrow();
    const start = arrow.tip;
    const end = getRayEnd(start, line.axis, board, CONFIG.board.exitMargin + 8);

    ctx.save();
    ctx.setLineDash([5 / camera.scale, 7 / camera.scale]);
    ctx.lineWidth = 1.2 / camera.scale;
    ctx.strokeStyle = line.hinted ? palette.hint : palette.accent;
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = line.hinted ? palette.hint : palette.accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 终点小刻度
    const perp = { x: -line.axis.y, y: line.axis.x };
    const tick = 7;
    ctx.beginPath();
    ctx.moveTo(end.x + perp.x * tick, end.y + perp.y * tick);
    ctx.lineTo(end.x - perp.x * tick, end.y - perp.y * tick);
    ctx.stroke();
    ctx.restore();
  }

  drawCornerBrackets(ctx, board, camera, palette) {
    const size = 15;
    const offset = 5;
    const x1 = board.minX - offset;
    const y1 = board.minY - offset;
    const x2 = board.maxX + offset;
    const y2 = board.maxY + offset;
    const lw = 1.4 / camera.scale;

    ctx.save();
    ctx.strokeStyle = palette.corner;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';

    const corners = [
      [x1, y1, 1, 1],
      [x2, y1, -1, 1],
      [x1, y2, 1, -1],
      [x2, y2, -1, -1]
    ];

    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * size);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * size, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function getRayEnd(start, axis, board, margin) {
  if (axis.x > 0) return { x: board.maxX + margin, y: start.y };
  if (axis.x < 0) return { x: board.minX - margin, y: start.y };
  if (axis.y > 0) return { x: start.x, y: board.maxY + margin };
  return { x: start.x, y: board.minY - margin };
}

function traceRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
