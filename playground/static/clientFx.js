import { clientLinkPoints } from "./renderer.js";

const MAX_DOTS = 24;
const pool = [];

export class ClientFx {
  constructor(layer) {
    this.layer = layer;
    this.rate = 0;
    this.active = false;
    this.intensity = 0;
    this.from = null;
    this.to = null;
    this.accum = 0;
    this.onSpawn = null;
  }

  setRoute(from, to) {
    this.from = from;
    this.to = to;
  }

  setActive(rate, active) {
    this.rate = rate;
    this.active = active;
    if (!active) this.accum = 0;
  }

  setIntensity(intensity) {
    this.intensity = Math.max(0, Math.min(1, intensity));
    if (this.intensity <= 0) this.accum = 0;
  }

  clear() {
    this.accum = 0;
    while (this.layer.firstChild) {
      this.layer.removeChild(this.layer.firstChild);
    }
  }

  _spawnRate() {
    if (!this.active || this.intensity <= 0) return 0;
    const effective = this.rate * this.intensity;
    return Math.max(0.75, Math.min(6, effective / 150));
  }

  tick(dt) {
    if (!this.active || !this.from || !this.to || this.intensity <= 0) return;

    const perSec = this._spawnRate();
    this.accum += perSec * dt;
    while (this.accum >= 1 && this.layer.childElementCount < MAX_DOTS) {
      this.accum -= 1;
      this._spawn();
      this.onSpawn?.();
    }
  }

  _spawn() {
    let dot = pool.pop();
    if (!dot) {
      dot = document.createElement("div");
      dot.className = "req-dot";
      dot.addEventListener("animationend", () => {
        dot.classList.remove("flying");
        if (dot.parentNode) dot.parentNode.removeChild(dot);
        pool.push(dot);
      });
    }

    const dx = this.to.x - this.from.x;
    const dy = this.to.y - this.from.y;
    const jitter = (Math.random() - 0.5) * 4;
    dot.style.left = `${this.from.x + jitter}px`;
    dot.style.top = `${this.from.y + jitter * 0.3}px`;
    dot.style.setProperty("--dx", `${dx}px`);
    dot.style.setProperty("--dy", `${dy}px`);
    const travel = Math.hypot(dx, dy);
    const dur = Math.min(950, 520 + travel * 0.55 + Math.random() * 180);
    dot.style.setProperty("--dur", `${dur}ms`);
    dot.classList.toggle("put", Math.random() > 0.2);
    dot.classList.remove("flying");
    this.layer.appendChild(dot);
    void dot.offsetWidth;
    dot.classList.add("flying");
  }
}

export function canvasPoint(p, bounds, rect) {
  if (!p || !bounds?.width || !rect?.width) return null;
  return {
    x: (p.x / bounds.width) * rect.width,
    y: (p.y / bounds.height) * rect.height,
  };
}

export function clientRoute(pos, leaderId, bounds, rect) {
  const client = pos.client;
  const leader = pos[leaderId] || pos._leaderSlot;
  if (!client || !leader) return { from: null, to: null };
  const pts = clientLinkPoints(client, leader);
  return {
    from: canvasPoint(pts.from, bounds, rect),
    to: canvasPoint(pts.to, bounds, rect),
  };
}
