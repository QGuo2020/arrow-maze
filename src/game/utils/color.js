/** 把 #rgb / #rrggbb 颜色转成带透明度的 rgba，Canvas 描边和光晕颜色常用。 */
export function hexToRgba(color, alpha) {
  if (typeof color !== 'string') return `rgba(255,255,255,${alpha})`;
  if (color.startsWith('rgba(') || color.startsWith('rgb(')) return color;

  let hex = color.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (hex.length !== 6) return `rgba(255,255,255,${alpha})`;

  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return `rgba(255,255,255,${alpha})`;

  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
