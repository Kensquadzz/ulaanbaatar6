// Touch-first input: floating joystick on the left part of the screen, camera drag everywhere else,
// on-screen Jump / Run buttons. Keyboard + mouse are supported for desktop testing.
export class Input {
  moveX = 0; moveY = 0; run = false;
  private jumpQueued = false;
  private lookDX = 0; lookDY = 0;
  private stickId = -1; private stickX = 0; private stickY = 0;
  private lookId = -1; private lastX = 0; private lastY = 0;
  private keys = new Set<string>();
  private keyRun = false;
  enabled = false;

  constructor(layer: HTMLElement, private stickEl: HTMLElement, knobEl: HTMLElement,
              jumpBtn: HTMLElement, private runBtn: HTMLElement) {
    const R = 56;
    layer.addEventListener('pointerdown', (ev) => {
      if (!this.enabled) return;
      ev.preventDefault();
      const touch = ev.pointerType !== 'mouse';
      if (touch && this.stickId === -1 && ev.clientX < window.innerWidth * 0.42) {
        this.stickId = ev.pointerId; this.stickX = ev.clientX; this.stickY = ev.clientY;
        stickEl.style.left = ev.clientX + 'px'; stickEl.style.top = ev.clientY + 'px';
        stickEl.classList.add('on'); knobEl.style.transform = 'translate(-50%,-50%)';
      } else if (this.lookId === -1) {
        this.lookId = ev.pointerId; this.lastX = ev.clientX; this.lastY = ev.clientY;
      }
      try { layer.setPointerCapture(ev.pointerId); } catch { /* not supported */ }
    });
    layer.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === this.stickId) {
        let dx = ev.clientX - this.stickX, dy = ev.clientY - this.stickY;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx *= R / l; dy *= R / l; }
        this.moveX = dx / R; this.moveY = -dy / R;
        knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (ev.pointerId === this.lookId) {
        this.lookDX += ev.clientX - this.lastX; this.lookDY += ev.clientY - this.lastY;
        this.lastX = ev.clientX; this.lastY = ev.clientY;
      }
    });
    const end = (ev: PointerEvent) => {
      if (ev.pointerId === this.stickId) { this.stickId = -1; this.moveX = this.moveY = 0; stickEl.classList.remove('on'); }
      if (ev.pointerId === this.lookId) this.lookId = -1;
    };
    layer.addEventListener('pointerup', end); layer.addEventListener('pointercancel', end);
    layer.addEventListener('lostpointercapture', end);

    const press = (el: HTMLElement, fn: () => void) =>
      el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (this.enabled) fn(); });
    press(jumpBtn, () => { this.jumpQueued = true; });
    press(runBtn, () => { this.run = !this.run; runBtn.classList.toggle('active', this.run); });

    window.addEventListener('keydown', (ev) => {
      if (!this.enabled) return;
      this.keys.add(ev.code);
      if (ev.code === 'Space') { this.jumpQueued = true; ev.preventDefault(); }
    });
    window.addEventListener('keyup', (ev) => this.keys.delete(ev.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.reset(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    // Safari: stop pinch-zoom, double-tap zoom, long-press menus and rubber-band scrolling in the game
    for (const t of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu']) {
      document.addEventListener(t, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions);
    }
    document.addEventListener('touchmove', (e) => {
      if (!(e.target as HTMLElement).closest?.('.scroll')) e.preventDefault();
    }, { passive: false });
  }

  private reset() {
    this.stickId = this.lookId = -1; this.moveX = this.moveY = 0;
    this.stickEl.classList.remove('on');
  }

  /** Returns and clears what happened since the last frame. */
  frame() {
    let x = this.moveX, y = this.moveY;
    const k = this.keys;
    if (this.stickId === -1) {
      x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    }
    this.keyRun = k.has('ShiftLeft') || k.has('ShiftRight');
    const out = { x, y, run: this.run || this.keyRun, jump: this.jumpQueued, lookDX: this.lookDX, lookDY: this.lookDY };
    this.jumpQueued = false; this.lookDX = this.lookDY = 0;
    return out;
  }
  stopRun() { this.run = false; this.runBtn.classList.remove('active'); }
}
