// ==UserScript==
// @name         GeoFS Real-Time Traffic
// @namespace    https://github.com/ajinkya
// @version      1.0.0
// @description  Displays live ATC traffic near you in GeoFS using OpenSky Network
// @author       Ajinkya
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://geo-fs.com/geofs.php*
// @match        https://beta.geo-fs.com/geofs.php*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.adsb.lol
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ──────────────────────────────────────────────────────────────────
  const CFG = {
    rangeNm:      50,      // initial radar range (nautical miles)
    refreshSec:   15,      // API poll interval
    maxAlt:       60000,   // filter out balloons / oddities above this ft
    showOnMap:    true,    // inject 3-D models into GeoFS scene (requires multiplayer hook)
    panelW:       300,
    panelH:       420,
  };

  const NM_TO_DEG = 1 / 60;
  const FT_PER_M  = 3.28084;
  const MS_TO_KT  = 1.94384;
  const R_NM      = 3440.065; // Earth radius in NM

  // ─── State ───────────────────────────────────────────────────────────────────
  let traffic   = [];   // [{callsign, lat, lon, alt, spd, hdg, squawk, dist, brg}, ...]
  let selected  = null;
  let rangeNm   = CFG.rangeNm;
  let myLat     = 0, myLon = 0, myAlt = 0;
  let pollTimer = null;
  let radarCtx  = null;
  let animFrame = null;

  // ─── Math helpers ─────────────────────────────────────────────────────────────
  function haversineNm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
      * Math.sin(dLon / 2) ** 2;
    return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
             - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // ─── GeoFS position reader ─────────────────────────────────────────────────
  function getMyPosition() {
    try {
      const ac = unsafeWindow.geofs.aircraft.instance;
      if (ac && ac.llaLocation) {
        myLat = ac.llaLocation[0];
        myLon = ac.llaLocation[1];
        myAlt = ac.llaLocation[2] * FT_PER_M;
        return true;
      }
    } catch (e) { /* geofs not ready yet */ }
    return false;
  }

  // ─── OpenSky API fetch ─────────────────────────────────────────────────────
  function buildBbox(lat, lon, nm) {
    const deg = nm * NM_TO_DEG * 1.5; // add buffer
    return {
      lamin: lat - deg, lomin: lon - deg,
      lamax: lat + deg, lomax: lon + deg,
    };
  }

  function fetchTraffic() {
    if (!getMyPosition()) return;

    // adsb.lol — community ADS-B Exchange mirror, open CORS, no auth required
    // Endpoint: /v2/lat/{lat}/lon/{lon}/dist/{nm}
    const distNm = Math.min(rangeNm, 250); // API cap
    const url = `https://api.adsb.lol/v2/lat/${myLat.toFixed(4)}/lon/${myLon.toFixed(4)}/dist/${distNm}`;

    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { 'Accept': 'application/json' },
      timeout: 10000,
      onload(res) {
        try {
          if (res.status === 0 || res.status >= 400)
            throw new Error('HTTP ' + res.status);
          const data = JSON.parse(res.responseText);
          processStatesADSB(data.ac || []);
          updateStatusDot('green');
          console.log('[GeoFS-Traffic] Got', (data.ac || []).length, 'aircraft');
        } catch (e) {
          console.warn('[GeoFS-Traffic] parse/status error', e);
          updateStatusDot('red');
        }
      },
      onerror(e)  { console.warn('[GeoFS-Traffic] GM error', e);  updateStatusDot('red'); },
      ontimeout() { console.warn('[GeoFS-Traffic] timeout');       updateStatusDot('orange'); },
    });
  }

  // adsb.lol aircraft object fields:
  // hex, flight, lat, lon, alt_baro(ft), gs(kt), track, baro_rate(fpm), squawk, on_ground
  function processStatesADSB(aircraft) {
    traffic = aircraft
      .filter(a => a.lat != null && a.lon != null && !a.ground) // has pos, airborne
      .map(a => ({
        icao:     a.hex || '??????',
        callsign: (a.flight || a.hex || '??????').trim(),
        lat:      a.lat,
        lon:      a.lon,
        alt:      a.alt_baro || 0,           // already in feet
        spd:      Math.round(a.gs || 0),     // already in knots
        hdg:      Math.round(a.track || 0),
        vspd:     Math.round(a.baro_rate || 0), // already in fpm
        squawk:   a.squawk || '----',
        emerg:    a.squawk === '7500' || a.squawk === '7600' || a.squawk === '7700',
      }))
      .filter(a => a.alt <= CFG.maxAlt)
      .map(a => ({
        ...a,
        dist: haversineNm(myLat, myLon, a.lat, a.lon),
        brg:  bearingDeg(myLat, myLon, a.lat, a.lon),
        altDiff: Math.round((a.alt - myAlt) / 100) * 100,
      }))
      .filter(a => a.dist <= rangeNm)
      .sort((a, b) => a.dist - b.dist);

    renderList();
    drawRadar();
  }

  // ─── Panel DOM ────────────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'geofsTrafficPanel';
    panel.innerHTML = `
      <div id="gtp-header">
        <span id="gtp-title">✈ TRAFFIC</span>
        <span id="gtp-status-dot" class="gtp-dot-green"></span>
        <span id="gtp-count">0 AC</span>
        <button id="gtp-close">✕</button>
      </div>

      <canvas id="gtp-radar" width="300" height="160"></canvas>

      <div id="gtp-col-headers">
        <span>CALLSIGN</span><span>ALT</span><span>SPD</span><span>DIST</span>
      </div>
      <div id="gtp-list"></div>

      <div id="gtp-detail" style="display:none"></div>

      <div id="gtp-footer">
        <span class="gtp-footer-label">Range</span>
        <input type="range" id="gtp-range" min="10" max="200" step="10" value="${rangeNm}">
        <span id="gtp-range-val">${rangeNm} NM</span>
      </div>
    `;

    // ── styles ──
    const style = document.createElement('style');
    style.textContent = `
      #geofsTrafficPanel {
        position: fixed; top: 60px; right: 12px; z-index: 9999;
        width: ${CFG.panelW}px;
        background: rgba(8, 18, 8, 0.93);
        border: 1px solid #2a4a2a;
        border-radius: 8px;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        color: #a0d0a0;
        box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        user-select: none;
        resize: both;
        overflow: auto;
        min-width: 220px; min-height: 200px;
      }
      #gtp-header {
        display: flex; align-items: center; gap: 6px;
        padding: 7px 10px;
        background: rgba(0,0,0,0.4);
        border-bottom: 1px solid #1a3a1a;
        cursor: move;
      }
      #gtp-title { font-weight: bold; font-size: 12px; color: #5DCAA5; flex: 1; }
      #gtp-close { background: none; border: none; color: #a0d0a0; cursor: pointer; font-size: 13px; padding: 0 2px; }
      .gtp-dot-green { display:inline-block; width:7px; height:7px; border-radius:50%; background:#3B6D11; animation: gtpPulse 2s infinite; }
      .gtp-dot-red    { display:inline-block; width:7px; height:7px; border-radius:50%; background:#E24B4A; }
      .gtp-dot-orange { display:inline-block; width:7px; height:7px; border-radius:50%; background:#EF9F27; }
      @keyframes gtpPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      #gtp-radar { display:block; background:#050f05; }
      #gtp-col-headers {
        display: grid; grid-template-columns: 90px 55px 45px 1fr;
        padding: 3px 8px; font-size: 9px; color: #4a7a4a;
        background: rgba(0,0,0,0.3); border-bottom: 1px solid #1a3a1a;
      }
      #gtp-list { max-height: 140px; overflow-y: auto; }
      .gtp-row {
        display: grid; grid-template-columns: 90px 55px 45px 1fr;
        padding: 4px 8px; border-bottom: 1px solid #0f2a0f;
        cursor: pointer; transition: background 0.1s;
      }
      .gtp-row:hover  { background: rgba(93,202,165,0.08); }
      .gtp-row.sel    { background: rgba(93,202,165,0.14); }
      .gtp-callsign   { color: #c0f0c0; font-weight: bold; }
      .gtp-emerg      { color: #E24B4A !important; animation: gtpPulse 1s infinite; }
      .gtp-alt-plus   { color: #5DCAA5; }
      .gtp-alt-minus  { color: #EF9F27; }
      #gtp-detail {
        padding: 7px 10px; border-top: 1px solid #1a3a1a;
        font-size: 10px; color: #a0d0a0; background: rgba(0,0,0,0.25);
      }
      #gtp-detail table { width: 100%; border-collapse: collapse; }
      #gtp-detail td { padding: 2px 0; }
      #gtp-detail .gtp-label { color: #4a7a4a; padding-right: 8px; }
      #gtp-footer {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 10px; border-top: 1px solid #1a3a1a;
        background: rgba(0,0,0,0.3);
      }
      .gtp-footer-label { font-size: 10px; color: #4a7a4a; }
      #gtp-range { flex: 1; accent-color: #5DCAA5; }
      #gtp-range-val { font-size: 10px; min-width: 44px; text-align: right; color: #5DCAA5; }
      #gtp-list::-webkit-scrollbar { width: 4px; }
      #gtp-list::-webkit-scrollbar-track { background: transparent; }
      #gtp-list::-webkit-scrollbar-thumb { background: #2a4a2a; border-radius: 2px; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    // ── drag ──
    const header = panel.querySelector('#gtp-header');
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
      dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
    });
    document.addEventListener('mousemove', e => {
      if (dragging) { panel.style.left = (e.clientX - ox) + 'px'; panel.style.top = (e.clientY - oy) + 'px'; panel.style.right = 'unset'; }
    });
    document.addEventListener('mouseup', () => dragging = false);

    // ── close ──
    panel.querySelector('#gtp-close').addEventListener('click', () => panel.remove());

    // ── range slider ──
    panel.querySelector('#gtp-range').addEventListener('input', e => {
      rangeNm = +e.target.value;
      panel.querySelector('#gtp-range-val').textContent = rangeNm + ' NM';
      fetchTraffic();
    });

    radarCtx = panel.querySelector('#gtp-radar').getContext('2d');
    return panel;
  }

  // ─── Radar canvas ─────────────────────────────────────────────────────────
  function drawRadar() {
    if (!radarCtx) return;
    const W = 300, H = 160, cx = W / 2, cy = H / 2;
    const ctx = radarCtx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050f05'; ctx.fillRect(0, 0, W, H);

    // rings
    [0.25, 0.5, 0.75, 1].forEach(r => {
      ctx.beginPath();
      ctx.arc(cx, cy, r * Math.min(cx, cy) * 0.92, 0, Math.PI * 2);
      ctx.strokeStyle = '#0f2a0f'; ctx.lineWidth = 0.5; ctx.stroke();
    });
    // crosshair
    ctx.strokeStyle = '#0f2a0f'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();

    // range label
    ctx.fillStyle = '#2a5a2a'; ctx.font = '8px monospace';
    ctx.fillText(rangeNm + ' NM', 4, H - 4);

    // ownship
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#5DCAA5'; ctx.fill();
    ctx.font = '8px monospace'; ctx.fillStyle = '#5DCAA5';
    ctx.fillText('YOU', cx + 5, cy - 3);

    const scale = (Math.min(cx, cy) * 0.92) / rangeNm;

    traffic.forEach(ac => {
      const rad = ac.brg * Math.PI / 180;
      const px = cx + Math.sin(rad) * ac.dist * scale;
      const py = cy - Math.cos(rad) * ac.dist * scale;
      if (px < 0 || px > W || py < 0 || py > H) return;

      const color = ac.emerg ? '#E24B4A' : (ac === selected ? '#5DCAA5' : '#3a7a3a');

      // aircraft symbol (arrow)
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ac.hdg * Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(2.5, 3); ctx.lineTo(0, 1); ctx.lineTo(-2.5, 3); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.restore();

      // callsign label
      ctx.fillStyle = color; ctx.font = '8px monospace';
      ctx.fillText(ac.callsign.slice(0, 8), px + 5, py - 2);

      // alt tag
      const altTag = (ac.alt / 100).toFixed(0).padStart(3, '0');
      const vTag = ac.vspd > 100 ? '↑' : ac.vspd < -100 ? '↓' : '';
      ctx.fillStyle = '#4a7a4a';
      ctx.fillText(altTag + vTag, px + 5, py + 7);
    });
  }

  // ─── Traffic list ─────────────────────────────────────────────────────────
  function renderList() {
    const list = document.getElementById('gtp-list');
    const countEl = document.getElementById('gtp-count');
    if (!list) return;

    list.innerHTML = '';
    countEl.textContent = traffic.length + ' AC';

    traffic.forEach(ac => {
      const row = document.createElement('div');
      row.className = 'gtp-row' + (ac === selected ? ' sel' : '');

      const altStr = (ac.alt / 100).toFixed(0).padStart(3, '0');
      const vArrow = ac.vspd > 100 ? '↑' : ac.vspd < -100 ? '↓' : '·';
      const distStr = ac.dist < 10 ? ac.dist.toFixed(1) + ' NM' : Math.round(ac.dist) + ' NM';
      const altClass = ac.altDiff > 0 ? 'gtp-alt-plus' : ac.altDiff < 0 ? 'gtp-alt-minus' : '';

      row.innerHTML = `
        <span class="gtp-callsign ${ac.emerg ? 'gtp-emerg' : ''}">${ac.callsign}</span>
        <span class="${altClass}">${altStr}${vArrow}</span>
        <span>${ac.spd}</span>
        <span style="text-align:right;padding-right:4px">${distStr}</span>
      `;
      row.addEventListener('click', () => {
        selected = ac === selected ? null : ac;
        renderList();
        drawRadar();
        showDetail();
      });
      list.appendChild(row);
    });
  }

  function showDetail() {
    const el = document.getElementById('gtp-detail');
    if (!el) return;
    if (!selected) { el.style.display = 'none'; return; }
    el.style.display = 'block';

    const altDiffStr = selected.altDiff > 0
      ? `+${selected.altDiff} ft`
      : `${selected.altDiff} ft`;
    const vspdStr = selected.vspd > 0
      ? `+${selected.vspd} fpm`
      : `${selected.vspd} fpm`;

    el.innerHTML = `
      <div style="font-weight:bold;color:#c0f0c0;margin-bottom:5px">${selected.callsign} — ICAO ${selected.icao.toUpperCase()}</div>
      <table>
        <tr><td class="gtp-label">ALT</td><td>${Math.round(selected.alt).toLocaleString()} ft MSL</td><td class="gtp-label" style="padding-left:12px">REL</td><td>${altDiffStr}</td></tr>
        <tr><td class="gtp-label">SPD</td><td>${selected.spd} kt GS</td><td class="gtp-label" style="padding-left:12px">V/S</td><td>${vspdStr}</td></tr>
        <tr><td class="gtp-label">HDG</td><td>${selected.hdg}°</td><td class="gtp-label" style="padding-left:12px">BRG</td><td>${Math.round(selected.brg)}°</td></tr>
        <tr><td class="gtp-label">DIST</td><td>${selected.dist.toFixed(1)} NM</td><td class="gtp-label" style="padding-left:12px">SQK</td><td style="${selected.emerg ? 'color:#E24B4A;font-weight:bold' : ''}">${selected.squawk}${selected.emerg ? ' ⚠' : ''}</td></tr>
      </table>
    `;
  }

  // ─── Status dot ───────────────────────────────────────────────────────────
  function updateStatusDot(color) {
    const dot = document.getElementById('gtp-status-dot');
    if (dot) { dot.className = `gtp-dot-${color}`; }
  }

  // ─── Launch (exposed globally so console can call it too) ─────────────────
  function launch() {
    if (document.getElementById('geofsTrafficPanel')) return;
    buildPanel();
    fetchTraffic();
    pollTimer = setInterval(fetchTraffic, CFG.refreshSec * 1000);
  }
  unsafeWindow._geofsTrafficLaunch = launch;

  // ─── Trigger button ───────────────────────────────────────────────────────
  function addLaunchButton() {
    if (document.getElementById('gtp-launch-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'gtp-launch-btn';
    btn.textContent = '✈ Traffic';
    btn.title = 'GeoFS Real-Time Traffic';
    Object.assign(btn.style, {
      position: 'fixed', top: '60px', right: '10px', zIndex: '999999',
      background: 'rgba(8, 18, 8, 0.85)',
      color: '#5DCAA5', border: '1px solid #2a4a2a',
      borderRadius: '5px', padding: '5px 10px',
      fontFamily: 'Courier New, monospace', fontSize: '12px',
      cursor: 'pointer',
    });
    btn.addEventListener('click', launch);
    document.body.appendChild(btn);
    console.log('[GeoFS-Traffic] Button injected ✈');
  }

  // ─── Init — poll until geofs.aircraft is ready ────────────────────────────
  function init() {
    try {
      if (!unsafeWindow.geofs || !unsafeWindow.geofs.aircraft || !unsafeWindow.geofs.aircraft.instance) {
        setTimeout(init, 500);
        return;
      }
    } catch(e) {
      setTimeout(init, 500);
      return;
    }
    console.log('[GeoFS-Traffic] Loaded ✈');
    addLaunchButton();
  }

  // Start polling as soon as the script runs — no need to wait for load event
  init();

})();
