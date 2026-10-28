import { CONFIG } from '../../config.js';
import { hexToRgba } from '../utils/color.js';

/**
 * 棋盘线段渲染器。
 *
 * 性能关键：普通线段和箭头会合并成两条大路径一次绘制，
 * 只有悬停、提示、正在移动的线才单独细节绘制。
 */
export class LineRenderer {
  draw(ctx, lines, timeSeconds, { focusLine = null, palette = CONFIG.themes.dark } = {}) {
    if (!lines || lines.length === 0) return;

    const baseLines = [];
    const focusLines = [];

    for (const line of lines) {
      if (!line || line.state === 'cleared') continue;
      const isFocus =
        line === focusLine ||
        line.hinted ||
        line.isMoving ||
        line.impactFlash > 0.02 ||
        line.blockedFlash > 0.02 ||
        line.highlight > 0.035;
      if (isFocus) focusLines.push(line);
      else baseLines.push(line);
    }

    this.drawBaseLines(ctx, baseLines, palette);
    for (const line of focusLines) {
      this.drawFocusLine(ctx, line, timeSeconds, palette);
    }
  }

  drawBaseLines(ctx, lines, palette) {
    if (lines.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 低强度外发光，批量绘制
    ctx.beginPath();
    for (const line of lines) this.tracePolyline(ctx, line.getPoints());
    ctx.lineWidth = CONFIG.line.defaultWidth + 3.2;
    ctx.strokeStyle = palette.lineHalo;
    ctx.shadowColor = palette.baseGlow;
    ctx.shadowBlur = 7;
    ctx.stroke();

    // 主线
    ctx.beginPath();
    for (const line of lines) this.tracePolyline(ctx, line.getPoints());
    ctx.lineWidth = CONFIG.line.defaultWidth;
    ctx.strokeStyle = palette.lineIdle;
    ctx.shadowBlur = 2.5;
    ctx.stroke();

    // 箭头批量填充
    ctx.beginPath();
    for (const line of lines) {
      const arrow = line.getArrow();
      ctx.moveTo(arrow.tip.x, arrow.tip.y);
      ctx.lineTo(arrow.baseA.x, arrow.baseA.y);
      ctx.lineTo(arrow.baseB.x, arrow.baseB.y);
      ctx.closePath();
    }
    ctx.fillStyle = palette.lineArrow;
    ctx.shadowColor = palette.arrowShadow;
    ctx.shadowBlur = 3;
    ctx.fill();
    ctx.restore();
  }

  drawFocusLine(ctx, line, timeSeconds, palette) {
    const points = line.getPoints();
    if (points.length < 2) return;

    const hintMode = line.hinted && line.isIdle;
    const accent = hintMode ? palette.hint : palette.accent;
    const impact = line.impactFlash;
    const blocked = line.blockedFlash || 0;
    const dangerFlash = Math.max(impact, blocked);
    const pulse = 0.5 + Math.sin(timeSeconds * 4.2) * 0.5;
    const highlight = Math.max(0.3, line.highlight);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (line.state === 'sliding') {
      this.drawTrail(ctx, line, points, accent);
    }

    // 外发光
    ctx.beginPath();
    this.tracePolyline(ctx, points);
    ctx.lineWidth = CONFIG.line.defaultWidth + 7;
    ctx.strokeStyle = hexToRgba(accent, 0.12 + pulse * 0.08);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18 + pulse * 8;
    ctx.stroke();

    // 彩色主体
    ctx.beginPath();
    this.tracePolyline(ctx, points);
    ctx.lineWidth = CONFIG.line.defaultWidth + 0.4;
    ctx.strokeStyle = accent;
    ctx.shadowBlur = 10;
    ctx.stroke();

    // 亮芯
    ctx.beginPath();
    this.tracePolyline(ctx, points);
    ctx.lineWidth = Math.max(1.4, CONFIG.line.defaultWidth * 0.3);
    ctx.strokeStyle = hexToRgba(palette.core, 0.82);
    ctx.shadowBlur = 0;
    ctx.stroke();

    // 撞击线/被撞线保持一段红色提醒
    if (dangerFlash > 0.01) {
      ctx.beginPath();
      this.tracePolyline(ctx, points);
      ctx.lineWidth = CONFIG.line.defaultWidth + 2;
      ctx.strokeStyle = hexToRgba(palette.danger, dangerFlash * 0.9);
      ctx.shadowColor = palette.danger;
      ctx.shadowBlur = 24 * dangerFlash;
      ctx.stroke();
    }

    // 箭头
    const arrow = line.getArrow();
    ctx.beginPath();
    ctx.moveTo(arrow.tip.x, arrow.tip.y);
    ctx.lineTo(arrow.baseA.x, arrow.baseA.y);
    ctx.lineTo(arrow.baseB.x, arrow.baseB.y);
    ctx.closePath();
    ctx.fillStyle = dangerFlash > 0.1 ? palette.danger : accent;
    ctx.shadowColor = dangerFlash > 0.1 ? palette.danger : accent;
    ctx.shadowBlur = 16 + pulse * 8;
    ctx.fill();

    // 提示/悬停时在箭头周围加呼吸光圈与前进箭头
    if (hintMode || line.hovered || line.pressed) {
      ctx.beginPath();
      ctx.arc(arrow.tip.x, arrow.tip.y, 15 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(accent, hintMode ? 0.22 + pulse * 0.24 : 0.16 + pulse * 0.18);
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 0;
      ctx.stroke();
      this.drawChevrons(ctx, line, arrow, hintMode ? 0.55 : 0.38, timeSeconds, palette);
    }

    // 撞击击中点冲击波（移动线和被撞线都有红色提醒）
    if (dangerFlash > 0.01) {
      const radius = 12 + (1 - dangerFlash) * 30;
      ctx.beginPath();
      ctx.arc(arrow.tip.x, arrow.tip.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(palette.danger, dangerFlash * 0.45);
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.stroke();
    }

    ctx.restore();
  }

  drawTrail(ctx, line, points, accent) {
    const count = 3;
    const spacing = 13;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = count; index >= 1; index -= 1) {
      // 残影也使用“头部位移”采样，才能呈现蛇身逐节抽出的轨迹
      const previousOffset = Math.max(0, line.offset - index * spacing);
      const trailPoints = line.getPointsAt(previousOffset);
      ctx.save();
      ctx.globalAlpha = 0.11 * (1 - index / (count + 1));
      ctx.lineWidth = CONFIG.line.defaultWidth * 0.7;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      this.tracePolyline(ctx, trailPoints);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawChevrons(ctx, line, arrow, alpha, timeSeconds, palette) {
    const direction = arrow.direction;
    const pulse = (timeSeconds * 0.7) % 1;
    ctx.save();
    ctx.strokeStyle = line.hinted ? palette.hint : palette.accent;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 0; index < 2; index += 1) {
      const progress = (pulse + index * 0.5) % 1;
      const distance = 9 + progress * 19;
      const fade = (1 - progress) * alpha;
      const x = arrow.tip.x + direction.x * distance;
      const y = arrow.tip.y + direction.y * distance;
      const size = 4;

      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.moveTo(
        x - direction.x * size + direction.y * size,
        y - direction.y * size - direction.x * size
      );
      ctx.lineTo(x + direction.x * size * 0.6, y + direction.y * size * 0.6);
      ctx.lineTo(
        x - direction.x * size - direction.y * size,
        y - direction.y * size + direction.x * size
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  tracePolyline(ctx, points) {
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
  }
}
