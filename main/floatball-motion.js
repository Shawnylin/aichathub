// Cursor and window coordinates are Electron DIP coordinates throughout.
function facingForPosition(position, area, size = 120) {
  const dx = (area.x + area.width / 2 - position.x - size / 2) / (area.width / 2);
  const dy = (area.y + area.height / 2 - position.y - size / 2) / (area.height / 2);
  return { yaw: Math.max(-16, Math.min(16, dx * 16)), pitch: Math.max(-10, Math.min(10, -dy * 10)) };
}
function clampToAreas(position, areas, size = 120, gap = 12) {
  const cx = position.x + size / 2, cy = position.y + size / 2;
  const distance = a => Math.max(a.x - cx, 0, cx - a.x - a.width) ** 2 + Math.max(a.y - cy, 0, cy - a.y - a.height) ** 2;
  const area = areas.reduce((best, a) => distance(a) < distance(best) ? a : best);
  const clamp = (v, start, length) => Math.round(Math.max(start + gap, Math.min(v, Math.max(start + gap, start + length - size - gap))));
  return { x: clamp(position.x, area.x, area.width), y: clamp(position.y, area.y, area.height) };
}
class NativeFloatballDrag {
  constructor({ getCursor, getAreas, move, changed = () => {}, every = setInterval, cancel = clearInterval }) {
    Object.assign(this, { getCursor, getAreas, move, changed, every, cancel });
    this.timer = null;
  }
  start(position, pointer) {
    this.stop(); this.origin = position; this.pointer = pointer; this.areas = this.getAreas(); this.last = position;
    // Poll at 8ms: Windows timer granularity and native window movement add
    // latency. A 16ms timer can otherwise produce only ~30–40 updates/sec.
    // Stationary samples never issue a native window move.
    this.tick(); this.timer = this.every(() => this.tick(), 8);
  }
  tick() {
    const p = this.getCursor();
    const next = clampToAreas({ x: this.origin.x + p.x - this.pointer.x, y: this.origin.y + p.y - this.pointer.y }, this.areas);
    if (next.x === this.last.x && next.y === this.last.y) return;
    this.last = next; this.move(next); this.changed(next);
  }
  stop() { if (this.timer !== null) this.cancel(this.timer); this.timer = null; }
}
module.exports = { facingForPosition, clampToAreas, NativeFloatballDrag };
