// Trail logic
function updateTrail(){
  const t = state.trail;
  const p = state.player;
  const nowSec = state.nowSec || (performance.now()/1000);
  if (t.points.length) {
    let i=0; while (i < t.points.length && (nowSec - t.points[i][3]) > t.ttl) i++;
    if (i>0) t.points.splice(0, i);
  }
  const last = t.points.length ? t.points[t.points.length-1] : null;
  if (!last || Math.hypot(p.x - last[0], p.z - last[2]) > t.minDist) {
    t.points.push([p.x, p.y + 0.25, p.z, nowSec]);
    if (t.points.length > t.maxPoints) t.points.splice(0, t.points.length - t.maxPoints);
  }
}
