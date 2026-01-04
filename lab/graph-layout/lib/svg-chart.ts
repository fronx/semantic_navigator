/**
 * Simple SVG chart generator for experiment visualization.
 */

export interface DataSeries {
  label: string;
  data: { x: number; y: number }[];
  color: string;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  showLegend?: boolean;
}

export function lineChart(series: DataSeries[], options: ChartOptions = {}): string {
  const {
    width = 800,
    height = 400,
    title,
    xLabel,
    yLabel,
    showLegend = true,
  } = options;

  const margin = { top: 40, right: 120, bottom: 50, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // Calculate data bounds
  const allPoints = series.flatMap(s => s.data);
  const xMin = options.xMin ?? Math.min(...allPoints.map(p => p.x));
  const xMax = options.xMax ?? Math.max(...allPoints.map(p => p.x));
  const yMin = options.yMin ?? Math.min(...allPoints.map(p => p.y));
  const yMax = options.yMax ?? Math.max(...allPoints.map(p => p.y));

  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  // Scale functions
  const scaleX = (x: number) => margin.left + ((x - xMin) / xRange) * plotWidth;
  const scaleY = (y: number) => margin.top + plotHeight - ((y - yMin) / yRange) * plotHeight;

  // Generate grid lines
  const xTicks = 5;
  const yTicks = 5;
  const gridLines: string[] = [];

  for (let i = 0; i <= xTicks; i++) {
    const x = scaleX(xMin + (xRange * i) / xTicks);
    gridLines.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotHeight}" stroke="#e0e0e0" stroke-width="1"/>`);
    gridLines.push(`<text x="${x}" y="${margin.top + plotHeight + 20}" text-anchor="middle" font-size="12" fill="#666">${(xMin + (xRange * i) / xTicks).toFixed(0)}</text>`);
  }

  for (let i = 0; i <= yTicks; i++) {
    const y = scaleY(yMin + (yRange * i) / yTicks);
    gridLines.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`);
    gridLines.push(`<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#666">${(yMin + (yRange * i) / yTicks).toFixed(0)}</text>`);
  }

  // Generate data lines
  const dataLines = series.map(s => {
    if (s.data.length === 0) return '';
    const pathData = s.data
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.x)} ${scaleY(p.y)}`)
      .join(' ');
    return `<path d="${pathData}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
  });

  // Generate legend
  const legend = showLegend ? series.map((s, i) => `
    <rect x="${width - margin.right + 10}" y="${margin.top + i * 25}" width="20" height="3" fill="${s.color}"/>
    <text x="${width - margin.right + 35}" y="${margin.top + i * 25 + 5}" font-size="12" fill="#333">${s.label}</text>
  `).join('') : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="white"/>

  <!-- Title -->
  ${title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${title}</text>` : ''}

  <!-- Grid -->
  ${gridLines.join('\n  ')}

  <!-- Axes -->
  <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#333" stroke-width="2"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#333" stroke-width="2"/>

  <!-- Axis labels -->
  ${xLabel ? `<text x="${margin.left + plotWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="14" fill="#333">${xLabel}</text>` : ''}
  ${yLabel ? `<text x="20" y="${margin.top + plotHeight / 2}" text-anchor="middle" font-size="14" fill="#333" transform="rotate(-90, 20, ${margin.top + plotHeight / 2})">${yLabel}</text>` : ''}

  <!-- Data -->
  ${dataLines.join('\n  ')}

  <!-- Legend -->
  ${legend}
</svg>`;
}

export function barChart(
  data: { label: string; value: number; color?: string }[],
  options: ChartOptions = {}
): string {
  const {
    width = 600,
    height = 400,
    title,
    yLabel,
  } = options;

  const margin = { top: 40, right: 20, bottom: 80, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const yMin = options.yMin ?? 0;
  const yMax = options.yMax ?? Math.max(...data.map(d => d.value)) * 1.1;
  const yRange = yMax - yMin || 1;

  const barWidth = plotWidth / data.length * 0.8;
  const barGap = plotWidth / data.length * 0.2;

  const scaleY = (y: number) => margin.top + plotHeight - ((y - yMin) / yRange) * plotHeight;

  // Y-axis ticks
  const yTicks = 5;
  const gridLines: string[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const y = scaleY(yMin + (yRange * i) / yTicks);
    gridLines.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`);
    gridLines.push(`<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#666">${(yMin + (yRange * i) / yTicks).toFixed(2)}</text>`);
  }

  // Bars
  const bars = data.map((d, i) => {
    const x = margin.left + i * (barWidth + barGap) + barGap / 2;
    const barHeight = ((d.value - yMin) / yRange) * plotHeight;
    const y = margin.top + plotHeight - barHeight;
    const color = d.color || '#4a90d9';
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}"/>
      <text x="${x + barWidth / 2}" y="${margin.top + plotHeight + 15}" text-anchor="middle" font-size="11" fill="#333" transform="rotate(45, ${x + barWidth / 2}, ${margin.top + plotHeight + 15})">${d.label}</text>
    `;
  }).join('');

  // Reference line at y=1.0 if in range
  const refLine = yMin < 1 && yMax > 1
    ? `<line x1="${margin.left}" y1="${scaleY(1)}" x2="${margin.left + plotWidth}" y2="${scaleY(1)}" stroke="#e74c3c" stroke-width="2" stroke-dasharray="5,5"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="white"/>

  <!-- Title -->
  ${title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${title}</text>` : ''}

  <!-- Grid -->
  ${gridLines.join('\n  ')}

  <!-- Reference line -->
  ${refLine}

  <!-- Axes -->
  <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#333" stroke-width="2"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#333" stroke-width="2"/>

  <!-- Y-axis label -->
  ${yLabel ? `<text x="20" y="${margin.top + plotHeight / 2}" text-anchor="middle" font-size="14" fill="#333" transform="rotate(-90, 20, ${margin.top + plotHeight / 2})">${yLabel}</text>` : ''}

  <!-- Bars -->
  ${bars}
</svg>`;
}
