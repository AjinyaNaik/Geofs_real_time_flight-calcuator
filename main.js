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

    function pad(str, len) {
        return String(str).padStart(len, ' ');
    }

    // ================= STATE =================
    let currentPage = 0;
    const PAGES = ["PROGRESS", "LEGS", "PERF", "FUEL"];

    // Fuel state (user-editable)
    let fuelLbs       = 20000;
    let fuelBurnRate  = 5000;  // lbs/hr default, editable
    let fuelEditMode  = false;
    let fuelEditField = null;  // "load" | "burn"
    let fuelInputBuf  = "";

    // Perf state
    let perfEditMode  = false;
    let perfEditField = null;  // "v1"|"vr"|"v2"|"vapp"|"cruise"
    let perfInputBuf  = "";
    let vSpeeds = { v1: 145, vr: 152, v2: 158, vapp: 135, cruise: 280 };

    // Track session start for fuel burn
    let sessionStart  = Date.now();
    let lastAltFt     = null;

    // ================= STYLE =================
    if (!document.getElementById("fmcStyle")) {
        const s = document.createElement("style");
        s.id = "fmcStyle";
        s.textContent = `
            @keyframes fmcblink { 0%,100%{opacity:1} 50%{opacity:0} }
            #fmcPanel * { box-sizing: border-box; }
            #fmcPanel { font-family: 'Courier New', Courier, monospace; }
            .fmc-screen { background: #0a1a0a; border-radius: 4px; padding: 8px; min-height: 260px; }
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
            .fmc-nav { display: flex; gap: 4px; margin-top: 8px; }
            .fmc-nav-btn {
                flex: 1; padding: 5px 0; font-size: 10px; font-weight: bold;
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

    function exitEditMode() {
        fuelEditMode = false;
        fuelEditField = null;
        fuelInputBuf = "";
        perfEditMode = false;
        perfEditField = null;
        perfInputBuf = "";
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
        const buf = fuelEditMode ? fuelInputBuf : perfInputBuf;
        el.innerHTML = buf
            ? `<span style="color:#ffb300;">${buf}</span><span class="fmc-cursor">_</span>`
            : `<span class="fmc-cursor">_</span>`;
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

        // Running cumulative distance from current position
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

        // Mach approximation: TAS ≈ GS for sim, speed of sound ~661kt at sea level, decreases ~2kt/1000ft
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
        const elapsed   = (Date.now() - sessionStart) / 3600000; // hours
        const burned    = fuelBurnRate * elapsed;
        const remaining = Math.max(0, fuelLbs - burned);
        const endurance = fuelBurnRate > 0 ? remaining / fuelBurnRate : 0;
        const range     = gs > 1 ? endurance * gs : 0;
        const pctLeft   = fuelLbs > 0 ? (remaining / fuelLbs) * 100 : 0;

        const barLen  = 16;
        const filled  = Math.round((pctLeft / 100) * barLen);
        const barCol  = pctLeft > 50 ? "#00e676" : pctLeft > 20 ? "#ffb300" : "#ff4444";
        const bar     = `<span style="color:${barCol};">${"█".repeat(filled)}${"░".repeat(barLen - filled)}</span>`;

        const fuelColor = pctLeft > 50 ? "green" : pctLeft > 20 ? "amber" : "red";

        const editBtn = (field, label) =>
            `<span class="fmc-input-btn" data-fuel-field="${field}">[${label}]</span>`;

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
            <div class="fmc-label">FUEL LOAD ${editBtn("load", "SET")}</div>
            <div class="fmc-value white">${fuelLbs.toFixed(0)} LBS</div>
            <div class="fmc-label" style="margin-top:4px;">BURN RATE ${editBtn("burn", "SET")}</div>
            <div class="fmc-value white">${fuelBurnRate.toFixed(0)} LBS/HR</div>
        `;
    }

    // ================= RENDER =================
    function renderPage() {
        const content   = document.getElementById("fmcContent");
        const pageTitle = document.getElementById("fmcPageTitle");
        if (!content || !pageTitle) return;

        pageTitle.textContent = PAGES[currentPage];

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

            // Bind PERF edit buttons
            content.querySelectorAll(".fmc-input-btn[data-field]").forEach(b => {
                b.onclick = () => startPerfEdit(b.dataset.field);
            });

            // Bind FUEL edit buttons
            content.querySelectorAll(".fmc-input-btn[data-fuel-field]").forEach(b => {
                b.onclick = () => startFuelEdit(b.dataset.fuelField);
            });

        } catch (err) {
            content.innerHTML = `<span style="color:red;">FMC ERROR</span>`;
            console.error("[GeoFMC]", err);
        }
    }

    // ================= EDIT MODES =================
    function startFuelEdit(field) {
        exitEditMode();
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
                        sessionStart = Date.now(); // reset burn timer on refuel
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

    // ================= LOOP =================
    setInterval(() => {
        if (panel.style.display === "none") return;
        if (fuelEditMode || perfEditMode) return; // don't redraw while user is typing
        renderPage();
    }, 1000);

})();
