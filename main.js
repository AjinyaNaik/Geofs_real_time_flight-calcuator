// ==UserScript==
// @name         GeoFMC
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Flight Management Computer for GeoFS with boarding, ground ops, fueling, and pushback simulation
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {

    // ================= DISTANCE =================
    function nm(lat1, lon1, lat2, lon2) {
        const R = 3440.065;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function formatUTC(date) {
        return date.toUTCString().slice(17, 22);
    }

    // ================= STATE =================
    let currentPage = 0;
    const PAGES = ["PROGRESS", "LEGS", "PERF", "FUEL", "GROUND", "PUSH", "BOARD"];

    // Fuel state
    let fuelLbs       = 20000;
    let fuelBurnRate  = 5000;
    let fuelEditMode  = false;
    let fuelEditField = null;
    let fuelInputBuf  = "";

    // Fuel truck state
    let fuelTruckTarget   = null;   // target lbs
    let fuelTruckActive   = false;
    let fuelTruckInterval = null;
    let fuelTruckRate     = 1500;   // lbs per 5s tick
    let fuelTruckEditMode = false;
    let fuelTruckInputBuf = "";

    // Perf state
    let perfEditMode  = false;
    let perfEditField = null;
    let perfInputBuf  = "";
    let vSpeeds = { v1: 145, vr: 152, v2: 158, vapp: 135, cruise: 280 };

    // Boarding state
    let boardingEditMode    = false;
    let boardingInputBuf    = "";
    let boardingTotal       = 0;      // total pax to board
    let boardingBoarded     = 0;      // pax currently boarded
    let boardingActive      = false;  // is boarding in progress
    let boardingInterval    = null;   // setInterval handle
    let boardingDeboarding  = false;  // true = deboard mode
    let boardingComplete    = false;  // boarding finished flag
    let boardingStartTime   = null;

    // Cargo state
    let cargoTarget    = 0;     // lbs target
    let cargoLoaded    = 0;
    let cargoActive    = false;
    let cargoInterval  = null;
    let cargoRate      = 800;   // lbs per 5s tick
    let cargoEditMode  = false;
    let cargoInputBuf  = "";

    // Catering state
    let cateringTarget   = 4;   // carts needed
    let cateringLoaded   = 0;
    let cateringActive   = false;
    let cateringInterval = null;
    let cateringEditMode = false;
    let cateringInputBuf = "";

    // Pushback / engine start checklist
    let pushChecklist = [
        { label: "PARKING BRAKE SET",     checked: false },
        { label: "PUSHBACK CLEARANCE",    checked: false },
        { label: "TUG CONNECTED",         checked: false },
        { label: "DOORS CLOSED",          checked: false },
        { label: "BEACON ON",             checked: false },
        { label: "ENGINE 1 START",        checked: false },
        { label: "ENGINE 2 START",        checked: false },
        { label: "TUG DISCONNECTED",      checked: false },
        { label: "BRAKE RELEASED",        checked: false },
    ];

    let sessionStart = Date.now();

    // ================= STYLE =================
    if (!document.getElementById("fmcStyle")) {
        const s = document.createElement("style");
        s.id = "fmcStyle";
        s.textContent = `
            @keyframes fmcblink { 0%,100%{opacity:1} 50%{opacity:0} }
            #fmcPanel * { box-sizing: border-box; }
            #fmcPanel { font-family: 'Courier New', Courier, monospace; }
            .fmc-screen { background: #0a1a0a; border-radius: 4px; padding: 8px; min-height: 260px; max-height: 380px; overflow-y: auto; }
            .fmc-row { display: flex; justify-content: space-between; font-size: 12px; line-height: 1.55; }
            .fmc-label { color: #5aafff; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
            .fmc-value { color: #e8e8e8; }
            .fmc-value.green  { color: #00e676; }
            .fmc-value.cyan   { color: #00cfff; }
            .fmc-value.amber  { color: #ffb300; }
            .fmc-value.red    { color: #ff4444; }
            .fmc-value.white  { color: #ffffff; font-weight: bold; }
            .fmc-divider { border: none; border-top: 1px solid #1e3a1e; margin: 4px 0; }
            .fmc-page-title {
                text-align: center; color: #00cfff; font-size: 12px;
                font-weight: bold; letter-spacing: 3px;
                margin-bottom: 6px; padding-bottom: 4px;
                border-bottom: 1px solid #1e3a1e;
            }
            .fmc-nav { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
            .fmc-nav-btn {
                flex: 1; min-width: 56px; padding: 5px 0; font-size: 10px; font-weight: bold;
                letter-spacing: 1px; cursor: pointer; border: none; border-radius: 3px;
                background: #1a2a1a; color: #5aafff; border: 1px solid #2a4a2a;
                transition: background 0.15s;
            }
            .fmc-nav-btn:hover   { background: #2a3a2a; }
            .fmc-nav-btn.active  { background: #003a00; color: #00e676; border-color: #00e676; }
            .fmc-input-btn {
                display: inline-block; padding: 1px 5px; font-size: 10px;
                cursor: pointer; background: #1a3a1a; color: #00cfff;
                border: 1px solid #2a5a2a; border-radius: 2px; margin-left: 4px;
            }
            .fmc-input-btn:hover { background: #2a4a2a; }
            .fmc-action-btn {
                display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: bold;
                cursor: pointer; border-radius: 3px; border: 1px solid #2a5a2a;
                background: #1a3a1a; color: #00e676; margin: 2px 2px 0 0;
            }
            .fmc-action-btn:hover { background: #2a4a2a; }
            .fmc-action-btn.stop  { color: #ff4444; border-color: #5a2a2a; background: #3a1a1a; }
            .fmc-action-btn.stop:hover { background: #4a2020; }
            .fmc-action-btn.deboard { color: #ffb300; border-color: #5a4a2a; background: #3a2a1a; }
            .fmc-action-btn.deboard:hover { background: #4a3a1a; }
            .fmc-kbd-row { display: flex; gap: 3px; margin-top: 4px; }
            .fmc-kbd {
                flex: 1; padding: 4px 0; font-size: 11px; font-weight: bold;
                cursor: pointer; border: none; border-radius: 3px;
                background: #1a2a1a; color: #ccc; border: 1px solid #2a4a2a;
                text-align: center;
            }
            .fmc-kbd:hover { background: #2a3a2a; color: #fff; }
            .fmc-kbd.del  { color: #ff7777; }
            .fmc-kbd.ok   { color: #00e676; }
            .fmc-cursor { animation: fmcblink 0.8s step-end infinite; }
            .fmc-scratch {
                background: #001800; border: 1px solid #2a4a2a; border-radius: 3px;
                padding: 3px 6px; font-size: 12px; color: #ffb300;
                margin-bottom: 4px; min-height: 22px; letter-spacing: 1px;
            }
            .fmc-alert {
                text-align: center; font-size: 13px; font-weight: bold;
                padding: 4px 0; animation: fmcblink 1s step-end infinite;
            }
            .fmc-pax-bar-bg {
                width: 100%; height: 10px; background: #0f2a0f;
                border-radius: 3px; overflow: hidden; margin: 4px 0 6px;
            }
            .fmc-pax-bar-fill {
                height: 100%; border-radius: 3px;
                transition: width 0.4s ease;
            }
            .fmc-checklist-item {
                display: flex; align-items: center; gap: 6px;
                padding: 4px 2px; border-bottom: 1px solid #0f1f0f;
                cursor: pointer; font-size: 12px;
            }
            .fmc-checklist-item:hover { background: #0f1f0f; }
            .fmc-checkbox {
                width: 14px; height: 14px; border: 1px solid #2a5a2a;
                border-radius: 2px; flex: 0 0 auto;
                display: flex; align-items: center; justify-content: center;
                font-size: 10px; color: #00e676; background: #001800;
            }
        `;
        document.head.appendChild(s);
    }

    // ================= PANEL =================
    const existing = document.getElementById("fmcPanel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "fmcPanel";
    Object.assign(panel.style, {
        position:     "fixed",
        top:          "60px",
        left:         "10px",
        zIndex:       "99999",
        background:   "linear-gradient(160deg, #101810 0%, #0a100a 100%)",
        color:        "#e0e0e0",
        border:       "1px solid #2a4a2a",
        borderRadius: "10px",
        padding:      "12px",
        width:        "280px",
        boxShadow:    "0 8px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)",
        display:      "none",
        userSelect:   "none",
    });

    panel.innerHTML = `
        <div style="
            text-align:center; font-weight:bold; font-size:13px;
            letter-spacing:3px; color:#00cfff; margin-bottom:8px;
            padding-bottom:6px; border-bottom:1px solid #1e3a1e;
            font-family:'Courier New',monospace;
        ">✈ GEO FMC</div>

        <div class="fmc-nav" id="fmcPageNav"></div>

        <div style="margin-top:8px;">
            <div class="fmc-screen" id="fmcScreen">
                <div class="fmc-page-title" id="fmcPageTitle">PROGRESS</div>
                <div id="fmcContent">Initializing...</div>
            </div>
        </div>

        <div id="fmcKeyboard" style="display:none; margin-top:6px;"></div>
    `;

    document.body.appendChild(panel);

    // Build page nav buttons
    const nav = document.getElementById("fmcPageNav");
    PAGES.forEach((name, i) => {
        const b = document.createElement("button");
        b.className = "fmc-nav-btn" + (i === 0 ? " active" : "");
        b.textContent = name;
        b.onclick = () => {
            currentPage = i;
            exitEditMode();
            renderPage();
            nav.querySelectorAll(".fmc-nav-btn").forEach((btn, j) => {
                btn.classList.toggle("active", j === i);
            });
        };
        nav.appendChild(b);
    });

    // ================= BUTTON =================
    const oldBtn = document.getElementById("fmcButton");
    if (oldBtn) oldBtn.remove();

    const btn = document.createElement("button");
    btn.id = "fmcButton";
    btn.className = "mdl-button mdl-js-button geofs-f-standard-ui geofs-mediumScreenOnly";
    btn.title = "Geo FMC";
    btn.innerHTML = `<span style="font-weight:bold;color:white;font-size:13px;">FMC</span>`;
    btn.onclick = () => {
        panel.style.display = panel.style.display === "none" ? "block" : "none";
    };

    const toolbar = document.querySelector(".geofs-ui-bottom");
    if (toolbar) {
        const insertPos = geofs.version >= 3.6 ? 4 : 3;
        toolbar.insertBefore(btn, toolbar.children[Math.min(insertPos, toolbar.children.length)]);
    }

    // ================= HELPERS =================
    function row(label, value, cls = "") {
        return `
            <div>
                <div class="fmc-label">${label}</div>
                <div class="fmc-row">
                    <span class="fmc-value ${cls}">${value}</span>
                </div>
            </div>
        `;
    }

    function rowSplit(label, left, right, clsL = "", clsR = "amber") {
        return `
            <div>
                <div class="fmc-label">${label}</div>
                <div class="fmc-row">
                    <span class="fmc-value ${clsL}">${left}</span>
                    <span class="fmc-value ${clsR}">${right}</span>
                </div>
            </div>
        `;
    }

    function divider() {
        return `<hr class="fmc-divider">`;
    }

    function progressBar(pct, color) {
        const barLen = 16;
        const filled = Math.round((pct / 100) * barLen);
        return `<span style="color:${color};">${"█".repeat(filled)}${"░".repeat(barLen - filled)}</span>`;
    }

    function exitEditMode() {
        fuelEditMode = false;
        fuelEditField = null;
        fuelInputBuf = "";
        fuelTruckEditMode = false;
        fuelTruckInputBuf = "";
        perfEditMode = false;
        perfEditField = null;
        perfInputBuf = "";
        boardingEditMode = false;
        boardingInputBuf = "";
        cargoEditMode = false;
        cargoInputBuf = "";
        cateringEditMode = false;
        cateringInputBuf = "";
        document.getElementById("fmcKeyboard").style.display = "none";
    }

    function showKeyboard(onDigit, onDel, onOk) {
        const kb = document.getElementById("fmcKeyboard");
        kb.style.display = "block";
        kb.innerHTML = `
            <div class="fmc-scratch" id="fmcScratch"><span class="fmc-cursor">_</span></div>
            <div class="fmc-kbd-row">
                ${[1,2,3,4,5].map(n => `<button class="fmc-kbd" data-n="${n}">${n}</button>`).join("")}
            </div>
            <div class="fmc-kbd-row">
                ${[6,7,8,9,0].map(n => `<button class="fmc-kbd" data-n="${n}">${n}</button>`).join("")}
            </div>
            <div class="fmc-kbd-row">
                <button class="fmc-kbd del" id="fmcKbdDel">DEL</button>
                <button class="fmc-kbd ok"  id="fmcKbdOk">EXEC</button>
            </div>
        `;

        kb.querySelectorAll(".fmc-kbd[data-n]").forEach(b => {
            b.onclick = () => { onDigit(b.dataset.n); updateScratch(); };
        });
        document.getElementById("fmcKbdDel").onclick = () => { onDel(); updateScratch(); };
        document.getElementById("fmcKbdOk").onclick  = () => { onOk(); };
    }

    function updateScratch() {
        const el = document.getElementById("fmcScratch");
        if (!el) return;
        let buf = "";
        if (fuelEditMode)      buf = fuelInputBuf;
        if (fuelTruckEditMode) buf = fuelTruckInputBuf;
        if (perfEditMode)      buf = perfInputBuf;
        if (boardingEditMode)  buf = boardingInputBuf;
        if (cargoEditMode)     buf = cargoInputBuf;
        if (cateringEditMode)  buf = cateringInputBuf;
        el.innerHTML = buf
            ? `<span style="color:#ffb300;">${buf}</span><span class="fmc-cursor">_</span>`
            : `<span class="fmc-cursor">_</span>`;
    }

    // ================= BOARDING LOGIC =================

    function startBoarding() {
        if (boardingTotal <= 0 || boardingActive) return;
        boardingActive     = true;
        boardingDeboarding = false;
        boardingComplete   = false;
        boardingStartTime  = Date.now();

        boardingInterval = setInterval(() => {
            if (boardingBoarded < boardingTotal) {
                boardingBoarded++;
            } else {
                clearInterval(boardingInterval);
                boardingInterval = null;
                boardingActive   = false;
                boardingComplete = true;
            }
        }, 5000); // 1 pax every 5 seconds
    }

    function startDeboarding() {
        if (boardingBoarded <= 0 || boardingActive) return;
        boardingActive     = true;
        boardingDeboarding = true;
        boardingComplete   = false;

        boardingInterval = setInterval(() => {
            if (boardingBoarded > 0) {
                boardingBoarded--;
            } else {
                clearInterval(boardingInterval);
                boardingInterval = null;
                boardingActive   = false;
                boardingBoarded  = 0;
                boardingTotal    = 0;
            }
        }, 5000);
    }

    function stopBoarding() {
        if (boardingInterval) {
            clearInterval(boardingInterval);
            boardingInterval = null;
        }
        boardingActive = false;
    }

    function resetBoarding() {
        stopBoarding();
        boardingBoarded  = 0;
        boardingTotal    = 0;
        boardingComplete = false;
        boardingDeboarding = false;
    }

    function boardingETA() {
        if (!boardingActive) return "--:--";
        const remaining = boardingDeboarding
            ? boardingBoarded
            : boardingTotal - boardingBoarded;
        const seconds = remaining * 5;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m + "m " + String(s).padStart(2, "0") + "s";
    }

    // ================= CARGO LOGIC =================

    function startCargo() {
        if (cargoTarget <= 0 || cargoActive) return;
        cargoActive = true;
        cargoInterval = setInterval(() => {
            if (cargoLoaded < cargoTarget) {
                cargoLoaded = Math.min(cargoTarget, cargoLoaded + cargoRate);
            } else {
                clearInterval(cargoInterval);
                cargoInterval = null;
                cargoActive = false;
            }
        }, 5000);
    }

    function stopCargo() {
        if (cargoInterval) { clearInterval(cargoInterval); cargoInterval = null; }
        cargoActive = false;
    }

    function resetCargo() {
        stopCargo();
        cargoLoaded = 0;
        cargoTarget = 0;
    }

    // ================= CATERING LOGIC =================

    function startCatering() {
        if (cateringActive || cateringLoaded >= cateringTarget) return;
        cateringActive = true;
        cateringInterval = setInterval(() => {
            if (cateringLoaded < cateringTarget) {
                cateringLoaded++;
            } else {
                clearInterval(cateringInterval);
                cateringInterval = null;
                cateringActive = false;
            }
        }, 8000); // 1 cart every 8 seconds
    }

    function stopCatering() {
        if (cateringInterval) { clearInterval(cateringInterval); cateringInterval = null; }
        cateringActive = false;
    }

    function resetCatering() {
        stopCatering();
        cateringLoaded = 0;
    }

    // ================= FUEL TRUCK LOGIC =================

    function startFuelTruck() {
        if (!fuelTruckTarget || fuelTruckActive) return;
        fuelTruckActive = true;
        fuelTruckInterval = setInterval(() => {
            if (fuelLbs < fuelTruckTarget) {
                fuelLbs = Math.min(fuelTruckTarget, fuelLbs + fuelTruckRate);
                sessionStart = Date.now(); // reset burn baseline as truck tops off
            } else {
                clearInterval(fuelTruckInterval);
                fuelTruckInterval = null;
                fuelTruckActive = false;
            }
        }, 5000);
    }

    function stopFuelTruck() {
        if (fuelTruckInterval) { clearInterval(fuelTruckInterval); fuelTruckInterval = null; }
        fuelTruckActive = false;
    }

    function resetFuelTruck() {
        stopFuelTruck();
        fuelTruckTarget = null;
    }

    // ================= PAGES =================

    function renderProgress(data) {
        const { remaining, gs, hrs, eta, altFt, todDistance, suggestedVS, atTOD, next, dest } = data;

        const phase = atTOD
            ? `<div class="fmc-alert" style="color:#ff4444;">▼ DESCEND NOW</div>`
            : `<div class="fmc-alert" style="color:#00e676; animation:none;">▲ CRUISE</div>`;

        return `
            ${rowSplit("ROUTE", next?.ident || "----", dest?.ident || "----", "cyan", "cyan")}
            ${divider()}
            ${rowSplit("DIST / GS", remaining.toFixed(0) + " NM", gs.toFixed(0) + " KT")}
            ${rowSplit("ETE / ETA", Math.floor(hrs) + "h " + ((hrs % 1) * 60).toFixed(0) + "m", formatUTC(eta) + "Z")}
            ${divider()}
            ${rowSplit("ALT / TOD", altFt.toFixed(0) + " ft", todDistance.toFixed(0) + " NM")}
            ${row("TARGET V/S", "-" + suggestedVS.toFixed(0) + " ft/min", "amber")}
            ${divider()}
            ${phase}
        `;
    }

    function renderLegs(data) {
        const { fp, idx, pos, gs } = data;
        if (!fp || fp.length < 2) return `<div class="fmc-value" style="color:orange;text-align:center;margin-top:40px;">NO FLIGHT PLAN</div>`;

        let html = "";
        const max = Math.min(fp.length, idx + 6);
        let cumDist = nm(pos[0], pos[1], fp[idx].lat, fp[idx].lon);

        for (let i = idx; i < max; i++) {
            const wp   = fp[i];
            const dist = i === idx ? cumDist : (() => {
                cumDist += nm(fp[i-1].lat, fp[i-1].lon, wp.lat, wp.lon);
                return cumDist;
            })();

            const ete  = gs > 1 ? dist / gs : 0;
            const eta  = new Date(Date.now() + ete * 3600000);
            const isCurrent = i === idx;

            html += `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #0f1f0f;">
                    <span class="fmc-value ${isCurrent ? "cyan" : "white"}" style="width:48px;">
                        ${isCurrent ? "▶ " : ""}${wp.ident || "----"}
                    </span>
                    <span class="fmc-value amber" style="width:60px;text-align:right;">
                        ${dist.toFixed(0)} NM
                    </span>
                    <span class="fmc-value green" style="width:55px;text-align:right;">
                        ${formatUTC(eta)}Z
                    </span>
                </div>
            `;
        }

        if (fp.length > idx + 6) {
            html += `<div class="fmc-label" style="text-align:center;margin-top:4px;">... ${fp.length - idx - 6} MORE WAYPOINTS</div>`;
        }

        return `
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span class="fmc-label" style="width:48px;">WPT</span>
                <span class="fmc-label" style="width:60px;text-align:right;">DIST</span>
                <span class="fmc-label" style="width:55px;text-align:right;">ETA</span>
            </div>
            ${html}
        `;
    }

    function renderPerf(data) {
        const { gs, altFt } = data;
        const sos  = 661 - (altFt / 1000) * 2;
        const mach = gs > 0 ? (gs / sos).toFixed(3) : "-.---";

        const editBtn = (field, val) =>
            `<span class="fmc-input-btn" data-field="${field}">[${val}]</span>`;

        return `
            <div class="fmc-label">V-SPEEDS (KT)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin-bottom:4px;">
                <div><span class="fmc-label">V1</span>
                    <span class="fmc-value cyan">${vSpeeds.v1}</span>
                    ${editBtn("v1", "EDIT")}
                </div>
                <div><span class="fmc-label">VR</span>
                    <span class="fmc-value cyan">${vSpeeds.vr}</span>
                    ${editBtn("vr", "EDIT")}
                </div>
                <div><span class="fmc-label">V2</span>
                    <span class="fmc-value cyan">${vSpeeds.v2}</span>
                    ${editBtn("v2", "EDIT")}
                </div>
                <div><span class="fmc-label">VAPP</span>
                    <span class="fmc-value cyan">${vSpeeds.vapp}</span>
                    ${editBtn("vapp", "EDIT")}
                </div>
            </div>
            ${divider()}
            <div class="fmc-label">CRUISE SPD</div>
            <div class="fmc-row">
                <span class="fmc-value amber">${vSpeeds.cruise} KT</span>
                ${editBtn("cruise", "EDIT")}
                <span class="fmc-value ${gs > vSpeeds.cruise ? "red" : "green"}">
                    ${gs > vSpeeds.cruise ? "OVERSPEED" : "NORMAL"}
                </span>
            </div>
            ${divider()}
            ${rowSplit("GS / MACH", gs.toFixed(0) + " KT", "M" + mach, "white", "amber")}
            ${row("PRESSURE ALT", altFt.toFixed(0) + " ft", "green")}
        `;
    }

    function renderFuel(data) {
        const { gs } = data;
        const elapsed   = (Date.now() - sessionStart) / 3600000;
        const burned    = fuelBurnRate * elapsed;
        const remaining = Math.max(0, fuelLbs - burned);
        const endurance = fuelBurnRate > 0 ? remaining / fuelBurnRate : 0;
        const range     = gs > 1 ? endurance * gs : 0;
        const pctLeft   = fuelLbs > 0 ? (remaining / fuelLbs) * 100 : 0;

        const barCol  = pctLeft > 50 ? "#00e676" : pctLeft > 20 ? "#ffb300" : "#ff4444";
        const bar     = progressBar(pctLeft, barCol);

        const fuelColor = pctLeft > 50 ? "green" : pctLeft > 20 ? "amber" : "red";

        const editBtn = (field, label) =>
            `<span class="fmc-input-btn" data-fuel-field="${field}">[${label}]</span>`;

        // Fuel truck section
        let truckSection = "";
        if (fuelTruckTarget) {
            const truckPct = Math.min(100, (fuelLbs / fuelTruckTarget) * 100);
            const truckColor = fuelLbs >= fuelTruckTarget ? "#00e676" : "#00cfff";
            const status = fuelTruckActive ? "FUELING" : (fuelLbs >= fuelTruckTarget ? "TARGET REACHED" : "PAUSED");
            let truckBtns = "";
            if (fuelLbs >= fuelTruckTarget) {
                truckBtns = `<span class="fmc-input-btn" id="fmcTruckReset">[RESET]</span>`;
            } else if (fuelTruckActive) {
                truckBtns = `<button class="fmc-action-btn stop" id="fmcTruckStop">⏸ PAUSE</button>`;
            } else {
                truckBtns = `
                    <button class="fmc-action-btn" id="fmcTruckStart">▶ FUEL</button>
                    <button class="fmc-action-btn stop" id="fmcTruckReset2">✕ RESET</button>
                `;
            }
            truckSection = `
                ${divider()}
                <div class="fmc-label">FUEL TRUCK — TARGET ${fuelTruckTarget.toFixed(0)} LBS</div>
                <div style="font-size:11px;letter-spacing:0;margin:2px 0 4px;">${progressBar(truckPct, truckColor)}</div>
                <div class="fmc-row" style="margin-bottom:4px;">
                    <span class="fmc-value ${fuelTruckActive ? "cyan" : "amber"}">${status}</span>
                    <span class="fmc-value">${truckPct.toFixed(0)}%</span>
                </div>
                <div>${truckBtns}</div>
            `;
        } else {
            truckSection = `
                ${divider()}
                <div class="fmc-label">FUEL TRUCK</div>
                <div class="fmc-value" style="color:#5aafff; font-size:11px; margin:4px 0;">
                    No fuel truck called. ${editBtn("trucktarget", "CALL TRUCK")}
                </div>
            `;
        }

        return `
            <div class="fmc-label">FUEL QUANTITY</div>
            <div class="fmc-row" style="margin-bottom:2px;">
                <span class="fmc-value ${fuelColor}">${remaining.toFixed(0)} LBS</span>
                <span class="fmc-label">${pctLeft.toFixed(0)}%</span>
            </div>
            <div style="font-size:11px;letter-spacing:0;margin-bottom:4px;">${bar}</div>
            ${divider()}
            ${rowSplit("BURNED", burned.toFixed(0) + " LBS", elapsed.toFixed(1) + " HRS", "amber", "amber")}
            ${rowSplit("ENDURANCE", endurance.toFixed(1) + " HRS", range.toFixed(0) + " NM")}
            ${divider()}
            <div class="fmc-label">FUEL LOAD (MANUAL) ${editBtn("load", "SET")}</div>
            <div class="fmc-value white">${fuelLbs.toFixed(0)} LBS</div>
            <div class="fmc-label" style="margin-top:4px;">BURN RATE ${editBtn("burn", "SET")}</div>
            <div class="fmc-value white">${fuelBurnRate.toFixed(0)} LBS/HR</div>
            ${truckSection}
        `;
    }

    function renderGround() {
        const cargoPct    = cargoTarget > 0 ? Math.round((cargoLoaded / cargoTarget) * 100) : 0;
        const cateringPct = cateringTarget > 0 ? Math.round((cateringLoaded / cateringTarget) * 100) : 0;

        // Cargo buttons
        let cargoBtns = "";
        if (cargoTarget === 0) {
            cargoBtns = `<span class="fmc-input-btn" id="fmcCargoSetBtn">[SET LBS]</span>`;
        } else if (cargoLoaded >= cargoTarget) {
            cargoBtns = `<span class="fmc-input-btn" id="fmcCargoReset">[RESET]</span>`;
        } else if (cargoActive) {
            cargoBtns = `<button class="fmc-action-btn stop" id="fmcCargoStop">⏸ PAUSE</button>`;
        } else {
            cargoBtns = `
                <button class="fmc-action-btn" id="fmcCargoStart">▶ LOAD</button>
                <button class="fmc-action-btn stop" id="fmcCargoReset2">✕ RESET</button>
                <span class="fmc-input-btn" id="fmcCargoSetBtn">[SET LBS]</span>
            `;
        }

        // Catering buttons
        let cateringBtns = "";
        if (cateringLoaded >= cateringTarget) {
            cateringBtns = `<span class="fmc-input-btn" id="fmcCateringReset">[RESET]</span>`;
        } else if (cateringActive) {
            cateringBtns = `<button class="fmc-action-btn stop" id="fmcCateringStop">⏸ PAUSE</button>`;
        } else {
            cateringBtns = `
                <button class="fmc-action-btn" id="fmcCateringStart">▶ LOAD</button>
                <button class="fmc-action-btn stop" id="fmcCateringReset2">✕ RESET</button>
                <span class="fmc-input-btn" id="fmcCateringSetBtn">[SET CARTS]</span>
            `;
        }

        return `
            <div class="fmc-label">CARGO LOADING</div>
            ${cargoTarget > 0 ? `
                <div class="fmc-row" style="margin-bottom:2px;">
                    <span class="fmc-value white">${cargoLoaded.toFixed(0)} / ${cargoTarget.toFixed(0)} LBS</span>
                    <span class="fmc-value ${cargoLoaded >= cargoTarget ? "green" : "cyan"}">
                        ${cargoLoaded >= cargoTarget ? "COMPLETE" : (cargoActive ? "LOADING" : "PAUSED")}
                    </span>
                </div>
                <div style="font-size:11px;letter-spacing:0;margin-bottom:6px;">
                    ${progressBar(cargoPct, cargoLoaded >= cargoTarget ? "#00e676" : "#00cfff")}
                </div>
            ` : `<div class="fmc-value" style="color:#5aafff; font-size:11px; margin:4px 0 6px;">No cargo manifest set.</div>`}
            <div>${cargoBtns}</div>

            ${divider()}

            <div class="fmc-label">CATERING (${cateringTarget} CARTS)</div>
            <div class="fmc-row" style="margin-bottom:2px;">
                <span class="fmc-value white">${cateringLoaded} / ${cateringTarget} CARTS</span>
                <span class="fmc-value ${cateringLoaded >= cateringTarget ? "green" : "cyan"}">
                    ${cateringLoaded >= cateringTarget ? "COMPLETE" : (cateringActive ? "LOADING" : "PAUSED")}
                </span>
            </div>
            <div style="font-size:11px;letter-spacing:0;margin-bottom:6px;">
                ${progressBar(cateringPct, cateringLoaded >= cateringTarget ? "#00e676" : "#00cfff")}
            </div>
            <div>${cateringBtns}</div>
        `;
    }

    function renderPush() {
        const checkedCount = pushChecklist.filter(i => i.checked).length;
        const allDone = checkedCount === pushChecklist.length;

        const items = pushChecklist.map((item, i) => `
            <div class="fmc-checklist-item" data-idx="${i}">
                <span class="fmc-checkbox">${item.checked ? "✓" : ""}</span>
                <span class="fmc-value ${item.checked ? "green" : "white"}">${item.label}</span>
            </div>
        `).join("");

        return `
            <div class="fmc-row" style="margin-bottom:4px;">
                <span class="fmc-label">PUSHBACK / ENGINE START</span>
                <span class="fmc-value ${allDone ? "green" : "amber"}">${checkedCount}/${pushChecklist.length}</span>
            </div>
            ${items}
            ${divider()}
            ${allDone
                ? `<div class="fmc-alert" style="color:#00e676;">✔ READY FOR TAXI</div>`
                : `<div class="fmc-value" style="color:#5aafff; font-size:11px;">Tap each item to confirm completion.</div>`
            }
            <div style="margin-top:6px;">
                <button class="fmc-action-btn stop" id="fmcPushReset">✕ RESET CHECKLIST</button>
            </div>
        `;
    }

    function renderBoarding() {
        const pct = boardingTotal > 0
            ? Math.round((boardingBoarded / boardingTotal) * 100)
            : 0;

        // Progress bar color
        const barColor = boardingComplete
            ? "#00e676"
            : boardingDeboarding
                ? "#ffb300"
                : "#00cfff";

        // Status text
        let statusText = "READY";
        let statusCls  = "cyan";
        if (boardingActive && !boardingDeboarding) { statusText = "BOARDING"; statusCls = "green"; }
        if (boardingActive && boardingDeboarding)  { statusText = "DEBOARDING"; statusCls = "amber"; }
        if (boardingComplete)                       { statusText = "COMPLETE"; statusCls = "green"; }
        if (!boardingActive && !boardingComplete && boardingBoarded > 0 && !boardingDeboarding)
            { statusText = "PAUSED"; statusCls = "amber"; }

        // Total duration estimate
        const totalMinutes = boardingTotal > 0
            ? Math.floor((boardingTotal * 5) / 60)
            : 0;
        const totalSeconds = boardingTotal > 0
            ? (boardingTotal * 5) % 60
            : 0;

        // Buttons
        let buttons = "";
        if (!boardingActive && boardingTotal === 0) {
            // No pax set yet — show set button
            buttons = `<span class="fmc-input-btn" id="fmcBoardSetBtn">[SET PAX]</span>`;
        } else if (!boardingActive && !boardingComplete && boardingBoarded < boardingTotal) {
            // Ready to board or paused
            buttons = `
                <button class="fmc-action-btn" id="fmcBoardStart">▶ BOARD</button>
                <button class="fmc-action-btn stop" id="fmcBoardReset">✕ RESET</button>
                <span class="fmc-input-btn" id="fmcBoardSetBtn">[SET PAX]</span>
            `;
        } else if (boardingActive && !boardingDeboarding) {
            // Currently boarding
            buttons = `
                <button class="fmc-action-btn stop" id="fmcBoardStop">⏸ PAUSE</button>
            `;
        } else if (boardingComplete || (!boardingActive && boardingBoarded === boardingTotal && boardingTotal > 0)) {
            // Boarding done — offer deboard
            buttons = `
                <button class="fmc-action-btn deboard" id="fmcBoardDeboard">▼ DEBOARD</button>
                <button class="fmc-action-btn stop" id="fmcBoardReset">✕ RESET</button>
            `;
        } else if (boardingActive && boardingDeboarding) {
            // Deboarding in progress
            buttons = `
                <button class="fmc-action-btn stop" id="fmcBoardStop">⏸ PAUSE</button>
            `;
        } else if (!boardingActive && boardingBoarded > 0) {
            // Paused mid-deboard
            buttons = `
                <button class="fmc-action-btn deboard" id="fmcBoardDeboard">▼ DEBOARD</button>
                <button class="fmc-action-btn stop" id="fmcBoardReset">✕ RESET</button>
            `;
        }

        return `
            <div class="fmc-label">PAX STATUS</div>
            <div class="fmc-row" style="margin-bottom:2px; align-items:center;">
                <span class="fmc-value white" style="font-size:20px;">${boardingBoarded}</span>
                <span class="fmc-value" style="font-size:12px; color:#5aafff;">/ ${boardingTotal} PAX</span>
                <span class="fmc-value ${statusCls}" style="font-size:11px;">${statusText}</span>
            </div>

            <div class="fmc-pax-bar-bg">
                <div class="fmc-pax-bar-fill" style="width:${pct}%; background:${barColor};"></div>
            </div>

            <div class="fmc-row" style="margin-bottom:4px;">
                <span class="fmc-label">${pct}% BOARDED</span>
                <span class="fmc-label">${boardingBoarded} SEATED</span>
            </div>

            ${divider()}

            ${boardingTotal > 0 ? `
                ${rowSplit("TOTAL TIME", totalMinutes + "m " + String(totalSeconds).padStart(2,"0") + "s", "@ 1 PAX/5S", "amber", "")}
                ${boardingActive ? rowSplit("ETA DONE", boardingETA(), "REMAINING", "cyan", "") : ""}
            ` : `
                <div class="fmc-value" style="color:#5aafff; font-size:11px; margin:6px 0;">
                    Set number of passengers to begin boarding simulation.
                </div>
            `}

            ${divider()}

            <div style="margin-top:4px;">${buttons}</div>
        `;
    }

    // ================= RENDER =================
    function renderPage() {
        const content   = document.getElementById("fmcContent");
        const pageTitle = document.getElementById("fmcPageTitle");
        if (!content || !pageTitle) return;

        pageTitle.textContent = PAGES[currentPage];

        // Pages that don't need live GeoFS flight data
        if (PAGES[currentPage] === "GROUND") {
            content.innerHTML = renderGround();
            bindGroundButtons();
            return;
        }
        if (PAGES[currentPage] === "PUSH") {
            content.innerHTML = renderPush();
            bindPushButtons();
            return;
        }
        if (PAGES[currentPage] === "BOARD") {
            content.innerHTML = renderBoarding();
            bindBoardingButtons();
            return;
        }

        try {
            const fp     = geofs.flightPlan.waypointArray;
            const active = geofs.flightPlan.trackedWaypoint;
            const pos    = geofs.aircraft.instance.llaLocation;
            const gs     = geofs.aircraft.instance.groundSpeed * 1.94384;
            const altFt  = pos[2] * 3.28084;

            let idx = fp ? fp.findIndex(w => w.id === active?.id) : -1;
            if (idx < 0) idx = 0;

            let remaining = 0, hrs = 0, eta = new Date(), todDistance = 0, suggestedVS = 0;
            let next = null, dest = null, atTOD = false;

            if (fp && fp.length >= 2) {
                remaining = nm(pos[0], pos[1], fp[idx].lat, fp[idx].lon);
                for (let i = idx; i < fp.length - 1; i++) {
                    remaining += nm(fp[i].lat, fp[i].lon, fp[i+1].lat, fp[i+1].lon);
                }
                hrs          = gs > 1 ? remaining / gs : 0;
                eta          = new Date(Date.now() + hrs * 3600000);
                todDistance  = (altFt / 1000) * 3;
                suggestedVS  = gs * 5;
                atTOD        = remaining <= todDistance && altFt > 1000;
                next         = fp[idx];
                dest         = fp[fp.length - 1];
            }

            const data = { fp, idx, pos, gs, altFt, remaining, hrs, eta, todDistance, suggestedVS, atTOD, next, dest };

            switch (currentPage) {
                case 0: content.innerHTML = renderProgress(data); break;
                case 1: content.innerHTML = renderLegs(data);     break;
                case 2: content.innerHTML = renderPerf(data);     break;
                case 3: content.innerHTML = renderFuel(data);     break;
            }

            content.querySelectorAll(".fmc-input-btn[data-field]").forEach(b => {
                b.onclick = () => startPerfEdit(b.dataset.field);
            });
            content.querySelectorAll(".fmc-input-btn[data-fuel-field]").forEach(b => {
                b.onclick = () => startFuelEdit(b.dataset.fuelField);
            });

            if (currentPage === 3) bindFuelTruckButtons();

        } catch (err) {
            content.innerHTML = `<span style="color:red;">FMC ERROR</span>`;
            console.error("[GeoFMC]", err);
        }
    }

    function bindBoardingButtons() {
        const content = document.getElementById("fmcContent");
        if (!content) return;

        const setBtn     = content.querySelector("#fmcBoardSetBtn");
        const startBtn   = content.querySelector("#fmcBoardStart");
        const stopBtn    = content.querySelector("#fmcBoardStop");
        const resetBtn   = content.querySelector("#fmcBoardReset");
        const deboardBtn = content.querySelector("#fmcBoardDeboard");

        if (setBtn)     setBtn.onclick     = () => startBoardingEdit();
        if (startBtn)   startBtn.onclick   = () => { startBoarding(); renderPage(); };
        if (stopBtn)    stopBtn.onclick    = () => { stopBoarding(); renderPage(); };
        if (resetBtn)   resetBtn.onclick   = () => { resetBoarding(); renderPage(); };
        if (deboardBtn) deboardBtn.onclick = () => { startDeboarding(); renderPage(); };
    }

    function bindGroundButtons() {
        const content = document.getElementById("fmcContent");
        if (!content) return;

        const cargoSetBtn   = content.querySelector("#fmcCargoSetBtn");
        const cargoStart    = content.querySelector("#fmcCargoStart");
        const cargoStop     = content.querySelector("#fmcCargoStop");
        const cargoReset    = content.querySelector("#fmcCargoReset");
        const cargoReset2   = content.querySelector("#fmcCargoReset2");

        if (cargoSetBtn) cargoSetBtn.onclick = () => startCargoEdit();
        if (cargoStart)  cargoStart.onclick  = () => { startCargo(); renderPage(); };
        if (cargoStop)   cargoStop.onclick   = () => { stopCargo(); renderPage(); };
        if (cargoReset)  cargoReset.onclick  = () => { resetCargo(); renderPage(); };
        if (cargoReset2) cargoReset2.onclick = () => { resetCargo(); renderPage(); };

        const cateringSetBtn = content.querySelector("#fmcCateringSetBtn");
        const cateringStart  = content.querySelector("#fmcCateringStart");
        const cateringStop   = content.querySelector("#fmcCateringStop");
        const cateringReset  = content.querySelector("#fmcCateringReset");
        const cateringReset2 = content.querySelector("#fmcCateringReset2");

        if (cateringSetBtn) cateringSetBtn.onclick = () => startCateringEdit();
        if (cateringStart)  cateringStart.onclick  = () => { startCatering(); renderPage(); };
        if (cateringStop)   cateringStop.onclick   = () => { stopCatering(); renderPage(); };
        if (cateringReset)  cateringReset.onclick  = () => { resetCatering(); renderPage(); };
        if (cateringReset2) cateringReset2.onclick = () => { resetCatering(); renderPage(); };
    }

    function bindPushButtons() {
        const content = document.getElementById("fmcContent");
        if (!content) return;

        content.querySelectorAll(".fmc-checklist-item").forEach(el => {
            el.onclick = () => {
                const idx = parseInt(el.dataset.idx, 10);
                pushChecklist[idx].checked = !pushChecklist[idx].checked;
                renderPage();
            };
        });

        const resetBtn = content.querySelector("#fmcPushReset");
        if (resetBtn) resetBtn.onclick = () => {
            pushChecklist.forEach(i => i.checked = false);
            renderPage();
        };
    }

    function bindFuelTruckButtons() {
        const content = document.getElementById("fmcContent");
        if (!content) return;

        const start  = content.querySelector("#fmcTruckStart");
        const stop   = content.querySelector("#fmcTruckStop");
        const reset  = content.querySelector("#fmcTruckReset");
        const reset2 = content.querySelector("#fmcTruckReset2");

        if (start)  start.onclick  = () => { startFuelTruck(); renderPage(); };
        if (stop)   stop.onclick   = () => { stopFuelTruck(); renderPage(); };
        if (reset)  reset.onclick  = () => { resetFuelTruck(); renderPage(); };
        if (reset2) reset2.onclick = () => { resetFuelTruck(); renderPage(); };
    }

    // ================= EDIT MODES =================
    function startFuelEdit(field) {
        exitEditMode();

        if (field === "trucktarget") {
            fuelTruckEditMode = true;
            fuelTruckInputBuf = "";
            showKeyboard(
                (digit) => { fuelTruckInputBuf += digit; },
                ()      => { fuelTruckInputBuf = fuelTruckInputBuf.slice(0, -1); },
                ()      => {
                    const val = parseFloat(fuelTruckInputBuf);
                    if (!isNaN(val) && val > 0) {
                        fuelTruckTarget = val;
                    }
                    exitEditMode();
                    renderPage();
                }
            );
            updateScratch();
            return;
        }

        fuelEditMode  = true;
        fuelEditField = field;
        fuelInputBuf  = "";

        showKeyboard(
            (digit) => { fuelInputBuf += digit; },
            ()      => { fuelInputBuf = fuelInputBuf.slice(0, -1); },
            ()      => {
                const val = parseFloat(fuelInputBuf);
                if (!isNaN(val) && val > 0) {
                    if (fuelEditField === "load") {
                        fuelLbs = val;
                        sessionStart = Date.now();
                    } else if (fuelEditField === "burn") {
                        fuelBurnRate = val;
                    }
                }
                exitEditMode();
                renderPage();
            }
        );
        updateScratch();
    }

    function startPerfEdit(field) {
        exitEditMode();
        perfEditMode  = true;
        perfEditField = field;
        perfInputBuf  = "";

        showKeyboard(
            (digit) => { perfInputBuf += digit; },
            ()      => { perfInputBuf = perfInputBuf.slice(0, -1); },
            ()      => {
                const val = parseFloat(perfInputBuf);
                if (!isNaN(val) && val > 0) {
                    vSpeeds[perfEditField] = val;
                }
                exitEditMode();
                renderPage();
            }
        );
        updateScratch();
    }

    function startBoardingEdit() {
        exitEditMode();
        boardingEditMode = true;
        boardingInputBuf = "";

        showKeyboard(
            (digit) => { boardingInputBuf += digit; },
            ()      => { boardingInputBuf = boardingInputBuf.slice(0, -1); },
            ()      => {
                const val = parseInt(boardingInputBuf, 10);
                if (!isNaN(val) && val > 0) {
                    // Reset boarding state when setting new pax count
                    stopBoarding();
                    boardingBoarded  = 0;
                    boardingTotal    = val;
                    boardingComplete = false;
                    boardingDeboarding = false;
                }
                exitEditMode();
                renderPage();
            }
        );
        updateScratch();
    }

    function startCargoEdit() {
        exitEditMode();
        cargoEditMode = true;
        cargoInputBuf = "";

        showKeyboard(
            (digit) => { cargoInputBuf += digit; },
            ()      => { cargoInputBuf = cargoInputBuf.slice(0, -1); },
            ()      => {
                const val = parseFloat(cargoInputBuf);
                if (!isNaN(val) && val > 0) {
                    stopCargo();
                    cargoLoaded = 0;
                    cargoTarget = val;
                }
                exitEditMode();
                renderPage();
            }
        );
        updateScratch();
    }

    function startCateringEdit() {
        exitEditMode();
        cateringEditMode = true;
        cateringInputBuf = "";

        showKeyboard(
            (digit) => { cateringInputBuf += digit; },
            ()      => { cateringInputBuf = cateringInputBuf.slice(0, -1); },
            ()      => {
                const val = parseInt(cateringInputBuf, 10);
                if (!isNaN(val) && val > 0) {
                    stopCatering();
                    cateringLoaded = 0;
                    cateringTarget = val;
                }
                exitEditMode();
                renderPage();
            }
        );
        updateScratch();
    }

    // ================= LOOP =================
    setInterval(() => {
        if (panel.style.display === "none") return;
        if (fuelEditMode || perfEditMode || boardingEditMode || cargoEditMode || cateringEditMode || fuelTruckEditMode) return;
        renderPage();
    }, 1000);

})();
