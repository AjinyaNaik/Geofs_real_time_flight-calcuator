(function () {

    function nm(lat1, lon1, lat2, lon2) {

        const R = 3440.065;

        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;

        return R * 2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );
    }

    const hud = document.createElement("div");

    Object.assign(hud.style, {
        position: "fixed",
        top: "15px",
        right: "15px",
        background: "rgba(0,0,0,.85)",
        color: "#00ff00",
        padding: "12px",
        fontFamily: "Consolas",
        fontSize: "14px",
        zIndex: 999999,
        border: "1px solid #555"
    });

    document.body.appendChild(hud);

    setInterval(() => {

        const fp = geofs.flightPlan.waypointArray;
        const active = geofs.flightPlan.trackedWaypoint;

        if (!fp?.length || !active) {
            hud.innerHTML = "NO ACTIVE FLIGHT PLAN";
            return;
        }

        const activeIndex =
            fp.findIndex(w => w.id === active.id);

        const pos =
            geofs.aircraft.instance.llaLocation;

        let remaining = nm(
            pos[0],
            pos[1],
            active.lat,
            active.lon
        );

        for (
            let i = activeIndex;
            i < fp.length - 1;
            i++
        ) {

            remaining += nm(
                fp[i].lat,
                fp[i].lon,
                fp[i + 1].lat,
                fp[i + 1].lon
            );

        }

        const gs =
            geofs.aircraft.instance.groundSpeed *
            1.94384;

        if (gs < 1) return;

        const hrs = remaining / gs;

        const eta =
            new Date(
                Date.now() +
                hrs * 3600000
            );

        const h = Math.floor(hrs);
        const m = Math.floor((hrs - h) * 60);

        const dest = fp[fp.length - 1];

        hud.innerHTML =
            `<b>GeoFS FMC</b><br>` +
            `NEXT: ${active.ident}<br>` +
            `DEST: ${dest.ident}<br>` +
            `REMAIN: ${remaining.toFixed(0)} NM<br>` +
            `GS: ${gs.toFixed(0)} KT<br>` +
            `ETE: ${h}H ${m}M<br>` +
            `ARR: ${eta.toUTCString().slice(17,22)} UTC`;

    }, 1000);

})();
