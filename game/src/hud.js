// DUSTLINE — hud.js
// The heads-up display: cash, wanted stars, speed, dust charges, mission
// banner, messages, minimap, start / pause / busted / dead screens.
// All DOM + a 2D canvas minimap. No framework.

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {};
    const ids = ['cash', 'stars', 'speed', 'dust', 'objective', 'message', 'hint',
      'menu', 'menu-title', 'menu-sub', 'menu-btn', 'pause', 'end', 'end-title',
      'end-sub', 'end-btn', 'storm-veil', 'vignette', 'toast'];
    for (const id of ids) {
      // Overlays live outside #hud, so query the whole document.
      this.el[id] = document.querySelector('#' + id);
    }
    this.minimap = document.querySelector('#minimap');
    this.mm = this.minimap ? this.minimap.getContext('2d') : null;
    this.onMenuClick = null;
    this.onEndClick = null;
    if (this.el['menu-btn']) {
      this.el['menu-btn'].addEventListener('click', () => this.onMenuClick && this.onMenuClick());
    }
    if (this.el['end-btn']) {
      this.el['end-btn'].addEventListener('click', () => this.onEndClick && this.onEndClick());
    }
    this._lastStars = -1;
    this._lastCash = -1;
    this._lastObjective = '';
    this._lastMessage = '';
    this._toastTimer = 0;
  }

  showMenu(title, sub, btn) {
    this.el['menu'].style.display = 'flex';
    this.el['menu-title'].textContent = title;
    this.el['menu-sub'].textContent = sub;
    this.el['menu-btn'].textContent = btn;
  }
  hideMenu() { this.el['menu'].style.display = 'none'; }
  showPause(show) { this.el['pause'].style.display = show ? 'flex' : 'none'; }
  showEnd(title, sub, btn) {
    this.el['end'].style.display = 'flex';
    this.el['end-title'].textContent = title;
    this.el['end-sub'].textContent = sub;
    this.el['end-btn'].textContent = btn;
  }
  hideEnd() { this.el['end'].style.display = 'none'; }

  toast(text, seconds = 3) {
    this.el['toast'].textContent = text;
    this.el['toast'].style.opacity = '1';
    this._toastTimer = seconds;
  }

  // Per-frame update. state: { cash, wanted, speedKmh, dust, objective, message,
  // messageTimer, inCar, health, stormAlpha, time }
  update(s, dt) {
    if (s.cash !== this._lastCash) {
      this.el['cash'].textContent = '$' + s.cash.toLocaleString('en-US');
      this._lastCash = s.cash;
    }
    if (s.wanted !== this._lastStars) {
      this.el['stars'].textContent = '★'.repeat(s.wanted) + '☆'.repeat(5 - s.wanted);
      this.el['stars'].style.color = s.wanted > 0 ? '#ff5340' : '#cfc4ae';
      this._lastStars = s.wanted;
    }
    this.el['speed'].textContent = s.inCar ? Math.round(s.speedKmh) + ' km/h' : '';
    this.el['dust'].textContent = s.inCar ? ('DUST ×' + s.dust) : 'ON FOOT — E: STEAL CAR';
    if (s.objective !== this._lastObjective) {
      this.el['objective'].textContent = s.objective;
      this._lastObjective = s.objective;
    }
    if (s.message !== this._lastMessage) {
      this.el['message'].textContent = s.message;
      this.el['message'].style.opacity = s.message ? '1' : '0';
      this._lastMessage = s.message;
    }
    if (s.messageTimer <= 0) this.el['message'].style.opacity = '0';
    // Storm veil: orange haze closes in when the storm is near.
    this.el['storm-veil'].style.opacity = String(Math.min(0.55, s.stormAlpha || 0));
    // Low-health vignette.
    const hurt = s.health < 40 ? (1 - s.health / 40) * 0.6 : 0;
    this.el['vignette'].style.opacity = String(hurt);
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.el['toast'].style.opacity = '0';
    }
  }

  // Minimap: streets, landmarks, storm circle, mission marker, cars, player.
  drawMinimap(layout, view) {
    if (!this.mm) return;
    const g = this.mm;
    const S = 200;
    const toMap = (x, z) => [((x + 380) / 760) * S, ((z + 380) / 760) * S];
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(20, 14, 10, 0.82)';
    g.fillRect(0, 0, S, S);
    // Desert.
    g.fillStyle = '#a97e46';
    g.fillRect(0, 0, S, S);
    // Streets.
    g.fillStyle = '#3a3633';
    for (const s of layout.streets) {
      const [x0, z0] = toMap(s.x0, s.z0);
      const [x1, z1] = toMap(s.x1, s.z1);
      g.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.max(2, Math.abs(x1 - x0)), Math.max(2, Math.abs(z1 - z0)));
    }
    // Airstrip.
    g.fillStyle = '#8d8272';
    const [ax, az] = toMap(300, -140);
    g.fillRect(ax, az, 16, 74);
    // Landmarks.
    g.fillStyle = '#e8b64c';
    for (const key of Object.keys(layout.landmarks)) {
      const lm = layout.landmarks[key];
      const [x, z] = toMap(lm.x, lm.z);
      g.fillRect(x - 2, z - 2, 4, 4);
    }
    // Sandstorm circle.
    if (view.storm && view.storm.active) {
      const [x, z] = toMap(view.storm.x, view.storm.z);
      const r = (view.storm.r / 760) * S;
      g.strokeStyle = 'rgba(230, 170, 90, 0.9)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, z, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(230, 170, 90, 0.18)';
      g.fill();
    }
    // Mission marker (pulsing).
    if (view.marker) {
      const [x, z] = toMap(view.marker.x, view.marker.z);
      const pulse = 5 + Math.sin(view.time * 5) * 2;
      g.fillStyle = '#ffe14d';
      g.beginPath();
      g.arc(x, z, pulse, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#201408';
      g.font = 'bold 10px sans-serif';
      g.textAlign = 'center';
      g.fillText('!', x, z + 3.5);
    }
    // Traffic (grey) and police (blue/red).
    for (const c of view.traffic || []) {
      const [x, z] = toMap(c.x, c.z);
      g.fillStyle = '#c9c2b4';
      g.fillRect(x - 1.5, z - 1.5, 3, 3);
    }
    for (const c of view.police || []) {
      const [x, z] = toMap(c.x, c.z);
      g.fillStyle = '#5a8dff';
      g.beginPath();
      g.arc(x, z, 3, 0, Math.PI * 2);
      g.fill();
    }
    // Player arrow.
    const [px, pz] = toMap(view.playerX, view.playerZ);
    g.save();
    g.translate(px, pz);
    g.rotate(-view.playerHeading);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
    // North marker.
    g.fillStyle = '#e8e4da';
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'left';
    g.fillText('N', 6, 14);
  }
}
