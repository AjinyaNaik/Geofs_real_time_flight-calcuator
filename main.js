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

    // ================= PANEL =================
    const existing = document.getElementById("fmcPanel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "fmcPanel";

    // Fully self-contained — no GeoFS classes, appended to body
    Object.assign(panel.style, {
        position:        "fixed",
        top:             "60px",
        left:            "10px",
        zIndex:          "99999",
        background:      "rgba(15, 15, 15, 0.92)",
        color:           "#e0e0e0",
        border:          "1px solid rgba(255,255,255,0.15)",
        borderRadius:    "8px",
        padding:         "12px 16px",
        minWidth:        "230px",
        boxShadow:       "0 4px 20px rgba(0,0,0,0.5)",
        fontFamily:      "Consolas, monospace",
        fontSize:        "13px",
        lineHeight:      "1.7",
        display:         "none",
        userSelect:      "none",
    });

    panel.innerHTML = `
        <div style="
            text-align:center;
            font-weight:bold;
            font-size:14px;
            letter-spacing:2px;
            color:#00cfff;
            margin-bottom:10px;
            border-bottom:1px solid rgba(255,255,255,0.1);
            padding-bottom:8px;
        ">GEO FMC / VNAV</div>
        <div id="fmcContent">Waiting for flight plan...</div>
    `;

    document.body.appendChild(panel);

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

    // ================= FMC LOOP =================
    setInterval(() => {
        try {
            const content = document.getElementById("fmcContent");
            if (!content) return;

            const fp     = geofs.flightPlan.waypointArray;
            const active = geofs.flightPlan.trackedWaypoint;
            const pos    = geofs.aircraft.instance.llaLocation;

            if (!fp || fp.length < 2) {
                content.innerHTML = `<span style="color:orange;">NO FLIGHT PLAN</span>`;
                return;
            }

            let idx = fp.findIndex(w => w.id === active?.id);
            if (idx < 0) idx = 0;

            // ---- Remaining distance ----
            let remaining = nm(pos[0], pos[1], fp[idx].lat, fp[idx].lon);
            for (let i = idx; i < fp.length - 1; i++) {
                remaining += nm(fp[i].lat, fp[i].lon, fp[i + 1].lat, fp[i + 1].lon);
            }

            // ---- Speed / ETA ----
            const gs  = geofs.aircraft.instance.groundSpeed * 1.94384;
            const hrs = gs > 1 ? remaining / gs : 0;
            const eta = new Date(Date.now() + hrs * 3600000);

            // ---- Altitude / VNAV ----
            const altFt       = pos[2] * 3.28084;
            const todDistance = (altFt / 1000) * 3;
            const suggestedVS = gs * 5;
            const atTOD       = remaining <= todDistance;

            const next = fp[idx];
            const dest = fp[fp.length - 1];

            const row = (label, value) =>
                `<div style="display:flex;justify-content:space-between;gap:16px;">
                    <span style="color:#888;">${label}</span>
                    <span style="color:#fff;">${value}</span>
                </div>`;

            const phase = atTOD
                ? `<div style="margin-top:10px;text-align:center;color:#ff4444;font-weight:bold;font-size:15px;animation:fmcblink 1s step-end infinite;">▼ DESCEND NOW</div>`
                : `<div style="margin-top:10px;text-align:center;color:#00ff88;font-weight:bold;">▲ CRUISE</div>`;

            content.innerHTML = `
                ${row("NEXT", next?.ident || "N/A")}
                ${row("DEST", dest?.ident || "N/A")}
                <div style="border-top:1px solid rgba(255,255,255,0.08);margin:6px 0;"></div>
                ${row("DIST", remaining.toFixed(0) + " NM")}
                ${row("GS",   gs.toFixed(0) + " KT")}
                ${row("ETE",  Math.floor(hrs) + "h " + ((hrs % 1) * 60).toFixed(0) + "m")}
                ${row("ETA",  eta.toUTCString().slice(17, 22) + " UTC")}
                <div style="border-top:1px solid rgba(255,255,255,0.08);margin:6px 0;"></div>
                ${row("ALT",  altFt.toFixed(0) + " ft")}
                ${row("TOD",  todDistance.toFixed(0) + " NM")}
                ${row("V/S",  "-" + suggestedVS.toFixed(0) + " ft/min")}
                ${phase}
            `;

        } catch (err) {
            const content = document.getElementById("fmcContent");
            if (content) content.innerHTML = `<span style="color:red;">FMC ERROR — check console</span>`;
            console.error("[GeoFMC]", err);
        }
    }, 1000);

    // Blink keyframe for DESCEND NOW
    if (!document.getElementById("fmcStyle")) {
        const s = document.createElement("style");
        s.id = "fmcStyle";
        s.textContent = `@keyframes fmcblink { 0%,100%{opacity:1} 50%{opacity:0.3} }`;
        document.head.appendChild(s);
    }

})();
