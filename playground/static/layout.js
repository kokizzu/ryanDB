export function leaderSlotPosition(bounds = { width: 1000, height: 420 }) {
  const w = bounds.width;
  const h = bounds.height;
  const compact = w < 520;
  const clientX = compact ? Math.max(44, w * 0.11) : Math.max(56, w * 0.06);
  return {
    x: clientX + (compact ? Math.min(112, w * 0.2) : Math.min(210, w * 0.2)),
    y: h * 0.5,
  };
}

// Approximate on-screen footprint of a node card at scale 1 (see .node-card CSS).
const CARD = 172;
const MARGIN_X = 24;
const MARGIN_Y = 22;
const GAP_X = 22;
const GAP_Y = 16;
const MAX_COLS = 3;
const MIN_SCALE = 0.42;

export function computeLayout(nodes, bounds = { width: 1000, height: 420 }, clusterStarted = true) {
  const pos = {};
  const w = bounds.width;
  const h = bounds.height;
  const cy = h * 0.5;
  const compact = w < 520;
  const marginX = compact ? 14 : MARGIN_X;
  const marginY = compact ? 16 : MARGIN_Y;
  const gapX = compact ? 10 : GAP_X;
  const gapY = compact ? 10 : GAP_Y;
  const maxColsLimit = compact ? 2 : MAX_COLS;
  const minScale = compact ? 0.45 : MIN_SCALE;

  // A node is "down" (shown in the offline row) only once the cluster has been
  // started; before that every node is idle and belongs in the topology. The
  // status API may omit `running` for a crashed node, so treat anything that
  // isn't explicitly running as down.
  const isDown = (node) => clusterStarted && node.running !== true;
  const running = nodes.filter((n) => !isDown(n));

  const clientX = compact ? Math.max(44, w * 0.11) : Math.max(56, w * 0.06);
  pos.client = { x: clientX, y: cy, role: "client", scale: compact ? 0.82 : 0.9 };

  const slot = leaderSlotPosition(bounds);

  const leaderNode = running.find(
    (node) => node.state === 2 || node.stateName === "leader"
  );
  const followers = running
    .filter((node) => node !== leaderNode)
    .sort((a, b) => a.id.localeCompare(b.id));

  const offline = nodes.filter(isDown);

  // Vertical region available for followers. Reserve a band at the bottom for
  // crashed nodes so the arc never collides with the offline row.
  const reserveBottom = offline.length ? (compact ? 104 : 130) : (!clusterStarted && compact ? 66 : 0);
  const regionTop = marginY;
  const regionBottom = h - marginY - reserveBottom;
  const regionH = Math.max(140, regionBottom - regionTop);
  const cyF = (regionTop + regionBottom) / 2;

  // Horizontal region: everything to the right of the leader slot.
  const leaderHalf = (CARD * 1.02) / 2;
  const regionLeft = compact ? slot.x + CARD * 0.28 + 16 : slot.x + leaderHalf * 0.6 + 40;
  const regionRight = w - marginX;
  const availW = Math.max(CARD * minScale, regionRight - regionLeft);

  const fc = Math.max(followers.length, 1);

  // Pick the column count (1..MAX_COLS) that lets the cards be as large as
  // possible without overlapping, using both width and height of the canvas.
  let cols = 1;
  let scale = 0;
  const maxCols = Math.min(maxColsLimit, fc);
  for (let c = 1; c <= maxCols; c++) {
    const rows = Math.ceil(fc / c);
    const sV = (regionH - (rows - 1) * gapY) / (rows * CARD);
    const sH = (availW - (c - 1) * gapX) / (c * CARD);
    const s = Math.min(1.0, sV, sH);
    if (s > scale + 1e-3) {
      scale = s;
      cols = c;
    }
  }
  scale = Math.max(minScale, scale);

  const rows = Math.ceil(fc / cols);
  const cardW = CARD * scale;
  const cardH = CARD * scale;
  const stepX = cardW + gapX;
  const stepY = cardH + gapY;

  const blockW = cols * cardW + (cols - 1) * gapX;
  let blockLeft = (regionLeft + regionRight) / 2 - blockW / 2;
  const minBlockLeft = compact ? Math.max(marginX, regionLeft) : regionLeft;
  const maxBlockLeft = regionRight - blockW;
  blockLeft = maxBlockLeft < minBlockLeft
    ? Math.max(marginX, maxBlockLeft)
    : Math.max(minBlockLeft, Math.min(blockLeft, maxBlockLeft));

  // Column-major fill so columns stay balanced and adjacent rows never overlap.
  followers.forEach((node, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const countInCol = Math.min(rows, fc - col * rows);
    const colH = (countInCol - 1) * stepY;
    const colTop = cyF - colH / 2;
    pos[node.id] = {
      x: blockLeft + cardW / 2 + col * stepX,
      y: countInCol <= 1 ? cyF : colTop + row * stepY,
      role: "follower",
      scale,
      slotIndex: i,
    };
  });

  const leaderScale = scale * 1.02;
  pos._leaderSlot = { ...slot, scale: leaderScale };

  if (leaderNode) {
    pos[leaderNode.id] = {
      ...slot,
      role: "leader",
      scale: leaderScale,
    };
  }

  offline.forEach((node, i) => {
    const ow = CARD * scale * 0.9;
    const gap = ow + 28;
    const totalW = Math.max(0, offline.length - 1) * gap;
    pos[node.id] = {
      x: (regionLeft + regionRight) / 2 - totalW / 2 + i * gap,
      y: h - marginY - ow / 2,
      role: "offline",
      scale: scale * 0.9,
    };
  });

  return pos;
}

export function quorumNeeded(nodeCount) {
  return Math.floor(nodeCount / 2) + 1;
}
