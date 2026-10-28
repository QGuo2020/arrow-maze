import { CONFIG } from '../../config.js';

/**
 * 静态背景渲染器。
 * 背景包含渐变、霓虹光晕、点阵网格和暗角，只会在 resize / 切换主题时重绘一次，
 * 然后缓存为离屏 Canvas，避免每帧重复创建渐变。
 */
export class BackgroundRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.palette = CONFIG.themes.dark;
  }

  resize(width, height, dpr, palette = this.palette) {
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    this.width = width;
    this.height = height;
    this.palette = palette;
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;

    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    this.drawBaseGradient(ctx, width, height, palette);
    this.drawAmbientGlow(ctx, width, height, palette);
    this.drawDotGrid(ctx, width, height, palette);
    this.drawOrbit(ctx, width, height, palette);
    this.drawVignette(ctx, width, height, palette);
  }

  draw(ctx) {
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    ctx.drawImage(this.canvas, 0, 0, this.width, this.height);
  }

  drawBaseGradient(ctx, width, height, palette) {
    const gradient = ctx.createLinearGradient(0, 0, width * 0.85, height);
    gradient.addColorStop(0, palette.backgroundTop);
    gradient.addColorStop(0.48, palette.backgroundMid);
    gradient.addColorStop(1, palette.backgroundBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  drawAmbientGlow(ctx, width, height, palette) {
    const cyanGlow = ctx.createRadialGradient(
      width * 0.22,
      height * 0.28,
      0,
      width * 0.22,
      height * 0.28,
      Math.max(width, height) * 0.5
    );
    cyanGlow.addColorStop(0, palette.ambientA);
    cyanGlow.addColorStop(0.45, palette.ambientA);
    cyanGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cyanGlow;
    ctx.fillRect(0, 0, width, height);

    const violetGlow = ctx.createRadialGradient(
      width * 0.8,
      height * 0.7,
      0,
      width * 0.8,
      height * 0.7,
      Math.max(width, height) * 0.46
    );
    violetGlow.addColorStop(0, palette.ambientB);
    violetGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = violetGlow;
    ctx.fillRect(0, 0, width, height);
  }

  drawDotGrid(ctx, width, height, palette) {
    const spacing = 40;
    const offsetX = (width / 2) % spacing;
    const offsetY = (height / 2) % spacing;

    ctx.fillStyle = palette.dot;
    ctx.beginPath();
    for (let x = offsetX; x < width; x += spacing) {
      for (let y = offsetY; y < height; y += spacing) {
        ctx.moveTo(x + 1.1, y);
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    // 每 5 格一个稍亮的定位点，形成很弱的空间层次
    ctx.fillStyle = palette.dotStrong;
    ctx.beginPath();
    for (let x = offsetX; x < width; x += spacing * 5) {
      for (let y = offsetY; y < height; y += spacing * 5) {
        ctx.moveTo(x + 1.7, y);
        ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  drawOrbit(ctx, width, height, palette) {
    const centerX = width / 2;
    const centerY = height / 2;
    const shortSide = Math.min(width, height);

    ctx.save();
    ctx.strokeStyle = palette.orbit;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, shortSide * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 四向定位刻线
    ctx.strokeStyle = palette.tick;
    const tickGap = shortSide * 0.38;
    const tickLength = 7;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const x = centerX + dx * tickGap;
      const y = centerY + dy * tickGap;
      ctx.beginPath();
      ctx.moveTo(x - dy * tickLength, y - dx * tickLength);
      ctx.lineTo(x + dy * tickLength, y + dx * tickLength);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawVignette(ctx, width, height, palette) {
    const radius = Math.hypot(width, height) * 0.6;
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      radius * 0.35,
      width / 2,
      height / 2,
      radius
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.72, palette.vignetteMid);
    vignette.addColorStop(1, palette.vignette);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
}
