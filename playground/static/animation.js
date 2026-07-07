import { SVG_NS, linkPoints, clientLinkPoints } from "./renderer.js";

const FLOW_COLORS = {
  put: "#5e8fb5",
  forward: "#6f9fc0",
  append: "#8089a0",
  commit: "#5a9c6e",
  state_change: "#bf9b54",
};

const FLOW_DURATIONS = {
  put: 420,
  forward: 380,
  append: 520,
  commit: 580,
  state_change: 640,
};

const MAX_FLOWS = 48;

export class AnimationEngine {
  constructor(layer) {
    this.layer = layer;
    this.flows = [];
    this.raf = null;
  }

  spawnFlow(from, to, pos, type, opts = {}) {
    if (opts.fromPoint && opts.toPoint) {
      this._spawnFlowPoints(opts.fromPoint, opts.toPoint, type, opts);
      return;
    }
    const endpoints = resolveEndpoints(from, to, pos);
    if (!endpoints) return;
    this._spawnFlowPoints(endpoints.from, endpoints.to, type, opts);
  }

  _spawnFlowPoints(fp, tp, type, opts = {}) {
    if (this.flows.length >= MAX_FLOWS) {
      const oldest = this.flows.shift();
      oldest?.g?.remove();
    }

    const curve = opts.curve ?? 22;
    const mid = {
      x: (fp.x + tp.x) / 2,
      y: (fp.y + tp.y) / 2 - curve,
    };
    const color = FLOW_COLORS[type] || FLOW_COLORS.put;

    const g = document.createElementNS(SVG_NS, "g");
    g.classList.add("flow-packet");

    const trail = document.createElementNS(SVG_NS, "path");
    trail.setAttribute(
      "d",
      `M ${fp.x} ${fp.y} Q ${mid.x} ${mid.y} ${tp.x} ${tp.y}`
    );
    trail.setAttribute("fill", "none");
    trail.setAttribute("stroke", color);
    trail.setAttribute("stroke-width", "1");
    trail.setAttribute("opacity", type === "append" ? "0" : "0.08");
    g.appendChild(trail);

    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("r", opts.r ?? (type === "append" ? 2 : 2.5));
    dot.setAttribute("fill", color);
    dot.setAttribute("opacity", "0.7");
    g.appendChild(dot);

    this.layer.appendChild(g);

    const duration = opts.duration ?? FLOW_DURATIONS[type] ?? 240;
    this.flows.push({
      g,
      dot,
      fp,
      mid,
      tp,
      start: performance.now(),
      duration,
    });

    this._ensureTick();
  }

  /** Leader → followers replication burst */
  spawnReplication(leaderId, followerIds, pos, opts = {}) {
    const leader = pos[leaderId];
    if (!leader) return;

    const hub = pos.client ? clientLinkPoints(pos.client, leader).to : null;

    for (const fid of followerIds) {
      if (fid === leaderId || !pos[fid]) continue;
      if (hub) {
        const tp = linkPoints(leader, pos[fid]).to;
        this.spawnFlow(leaderId, fid, pos, "append", {
          ...opts,
          fromPoint: hub,
          toPoint: tp,
        });
      } else {
        this.spawnFlow(leaderId, fid, pos, "append", opts);
      }
    }
  }

  tick(now = performance.now()) {
    this.flows = this.flows.filter((f) => {
      const t = Math.min(1, (now - f.start) / f.duration);
      const u = 1 - t;
      const x = u * u * f.fp.x + 2 * u * t * f.mid.x + t * t * f.tp.x;
      const y = u * u * f.fp.y + 2 * u * t * f.mid.y + t * t * f.tp.y;
      f.dot.setAttribute("cx", x);
      f.dot.setAttribute("cy", y);
      f.dot.setAttribute("opacity", String(0.7 * (1 - t * 0.5)));
      if (t >= 1) {
        f.g.remove();
        return false;
      }
      return true;
    });

    if (this.flows.length > 0) {
      this.raf = requestAnimationFrame((t) => this.tick(t));
    } else {
      this.raf = null;
    }
  }

  _ensureTick() {
    if (this.raf == null) {
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }

  /** Immediately remove all in-flight flow packets. */
  clear() {
    for (const f of this.flows) f.g?.remove();
    this.flows = [];
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }
}

function resolveEndpoints(fromId, toId, pos) {
  if (fromId === "client") {
    const client = pos.client;
    const to = pos[toId];
    if (!client || !to) return null;
    return clientLinkPoints(client, to);
  }
  const from = pos[fromId];
  const to = pos[toId];
  if (!from || !to) return null;
  return linkPoints(from, to);
}
