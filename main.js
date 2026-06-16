(function () {

    // ================= DISTANCE (NM) =================
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
    const panel = document.createElement("div");
    panel.id = "geoFMC_VNAV";

    Object.assign(panel.style, {
        position: "fixed",
        top: "90px",
        right: "20px",
        width: "240px",
        background: "rgba(0,0,0,0.88)",
        color: "#00ff88",
        fontFamily: "Consolas",
        fontSize: "13px",
        border: "1px solid #333",
        zIndex: 999999,
        boxShadow: "0 0 12px rgba(0,0,0,0.6)"
    });

    const header = document.createElement("div");
    header.innerHTML = "✈ GEO FMC / VNAV";
    Object.assign(header.style, {
        padding: "6px",
        background: "#111",
        cursor: "pointer",
        color: "#fff",
        fontWeight: "bold"
    });

    const content = document.createElement("div");
    content.style.padding = "8px";

    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);

    // toggle
    let minimized = false;
    header.onclick = () => {
        minimized = !minimized;
        content.style.display = minimized ? "none" : "block";
    };

    // drag
    let drag = false, ox = 0, oy = 0;

    header.onmousedown = (e) => {
        drag = true;
        ox = e.clientX - panel.offsetLeft;
        oy = e.clientY - panel.offsetTop;
    };

    document.onmousemove = (e) => {
        if (drag) {
            panel.style.left = (e.clientX - ox) + "px";
            panel.style.top = (e.clientY - oy) + "px";
            panel.style.right = "auto";
        }
    };

    document.onmouseup = () => drag = false;

    // ================= LOOP =================
    setInterval(() => {

        try {

            const fp = geofs.flightPlan.waypointArray;
            const active = geofs.flightPlan.trackedWaypoint;
            const pos = geofs.aircraft.instance.llaLocation;

            if (!fp || fp.length < 2) {
                content.innerHTML = "NO FLIGHT PLAN";
                return;
            }

            // active waypoint index
            let idx = fp.findIndex(w => w.id === active?.id);
            if (idx < 0) idx = 0;

            // remaining distance
            let remaining = nm(
                pos[0], pos[1],
                fp[idx].lat,
                fp[idx].lon
            );

            for (let i = idx; i < fp.length - 1; i++) {
                remaining += nm(
                    fp[i].lat, fp[i].lon,
                    fp[i + 1].lat, fp[i + 1].lon
                );
            }

            // ================= SPEED =================
            const gs = geofs.aircraft.instance.groundSpeed * 1.94384;

            const hrs = gs > 1 ? remaining / gs : 0;
            const eta = new Date(Date.now() + hrs * 3600000);

            // ================= ALTITUDE =================
            const altM = pos[2];
            const altFt = altM * 3.28084;

            // TOD rule: 3 NM per 1000 ft
            const todDistance = (altFt / 1000) * 3;

            // VNAV vertical speed rule: GS × 5
            const suggestedVS = gs * 5;

            const atTOD = remaining <= todDistance;

            const next = fp[idx];
            const dest = fp[fp.length - 1];

            // ================= UI =================
            content.innerHTML = `
NEXT: ${next?.ident || "N/A"}<br>
DEST: ${dest?.ident || "N/A"}<br>
----------------------<br>
DIST: ${remaining.toFixed(0)} NM<br>
GS: ${gs.toFixed(0)} KT<br>
ETE: ${Math.floor(hrs)}h ${(hrs % 1 * 60).toFixed(0)}m<br>
ETA: ${eta.toUTCString().slice(17,22)} UTC<br>
----------------------<br>
ALT: ${altFt.toFixed(0)} ft<br>
TOD: ${todDistance.toFixed(0)} NM<br>
VS: -${suggestedVS.toFixed(0)} ft/min<br>
${atTOD ? "▼ DES NOW" : ""}
            `;

        } catch (e) {
            content.innerHTML = "FMC ERROR";
        }

    }, 1000);

})();
