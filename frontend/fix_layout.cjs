const fs = require('fs');
let code = fs.readFileSync('src/lib/topologyLayout.ts', 'utf-8');

const replacement = `  const padX = 50;
  const padY = 50;

  let requiredW = w;
  let requiredH = h;
  const positions = new Map<string, LayoutedNode>();

  if (!isVertical) {
    // ── Horizontal Layout (Desktop / Laptop) ──────────────────────────
    const colGap = 180;
    const rowGap = 45;
    
    const maxNodesInCol = Math.max(1, ...Array.from(levels.values()).map(arr => arr.length));
    
    requiredW = Math.max(w, padX * 2 + nodeWidth + (numLevels > 1 ? numLevels - 1 : 0) * colGap);
    requiredH = Math.max(h, padY * 2 + maxNodesInCol * nodeHeight + (maxNodesInCol > 1 ? maxNodesInCol - 1 : 0) * rowGap);

    sortedDepths.forEach((d, colIndex) => {
      const colNodes = levels.get(d) ?? [];
      const count = colNodes.length;
      const x = padX + nodeWidth / 2 + colIndex * colGap;

      const totalColH = count * nodeHeight + (count > 1 ? count - 1 : 0) * rowGap;
      const startY = (requiredH - totalColH) / 2 + nodeHeight / 2;

      colNodes.forEach((n, idx) => {
        const y = startY + idx * (nodeHeight + rowGap);
        positions.set(n.id, {
          id: n.id,
          x: round1(x),
          y: round1(y),
          depth: d,
        });
      });
    });
  } else {
    // ── Vertical Layout (Smartphone / Tablet) ─────────────────────────
    const rowGap = 80;
    const colGap = 35;
    
    const maxNodesInRow = Math.max(1, ...Array.from(levels.values()).map(arr => arr.length));
    
    requiredH = Math.max(h, padY * 2 + nodeHeight + (numLevels > 1 ? numLevels - 1 : 0) * rowGap);
    requiredW = Math.max(w, padX * 2 + maxNodesInRow * nodeWidth + (maxNodesInRow > 1 ? maxNodesInRow - 1 : 0) * colGap);

    sortedDepths.forEach((d, rowIndex) => {
      const rowNodes = levels.get(d) ?? [];
      const count = rowNodes.length;
      const y = padY + nodeHeight / 2 + rowIndex * (nodeHeight + rowGap);

      const totalRowW = count * nodeWidth + (count > 1 ? count - 1 : 0) * colGap;
      const startX = (requiredW - totalRowW) / 2 + nodeWidth / 2;

      rowNodes.forEach((n, idx) => {
        const x = startX + idx * (nodeWidth + colGap);
        positions.set(n.id, {
          id: n.id,
          x: round1(x),
          y: round1(y),
          depth: d,
        });
      });
    });
  }`;

code = code.replace(/  const padX = clamp\(w \* 0\.06, 20, 50\);[\s\S]*?    \}\);\n  \}/, replacement);
code = code.replace(/    width: w,\n    height: h,/, '    width: requiredW,\n    height: requiredH,');

fs.writeFileSync('src/lib/topologyLayout.ts', code);
