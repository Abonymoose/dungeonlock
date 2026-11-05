// Dev helper: fake finger touches for checking the phone controls in a desktop browser.
// In the console:  const P = await import('/test/phone.js'); P.tap(400, 300);
let id = 100;
export function down(x, y) {
  const el = document.elementFromPoint(x, y), t = new Touch({ identifier: ++id, target: el, clientX: x, clientY: y });
  const ok = el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  return { el, id: t.identifier, x, y, ok };
}
export function move(f, x, y) {
  const t = new Touch({ identifier: f.id, target: f.el, clientX: x, clientY: y });
  f.el.dispatchEvent(new TouchEvent('touchmove', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  Object.assign(f, { x, y });
}
// a real browser only sends the click when the touch start wasn't cancelled
export function up(f) {
  const t = new Touch({ identifier: f.id, target: f.el, clientX: f.x, clientY: f.y });
  f.el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
  if (f.ok) f.el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: f.x, clientY: f.y }));
}
export const tap = (x, y) => up(down(x, y));
export function tapEl(sel) {
  const r = document.querySelector(sel).getBoundingClientRect();
  tap(r.x + r.width / 2, r.y + r.height / 2);
}
export const centre = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
