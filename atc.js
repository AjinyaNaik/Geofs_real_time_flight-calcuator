(function () {

    // ================= PREVENT DUPLICATES =================
    if (window.__GEOFS_ATC_FMC_UI__) return;
    window.__GEOFS_ATC_FMC_UI__ = true;

    // ================= STATE =================
    let callsign = "TEST123";
    let listening = false;
    let lastHeard = "";

    // ================= STYLE (FMC MATCH) =================
    const style = document.createElement("style");
    style.textContent = `
        #atcFmcPanel * { box-sizing: border-box; font-family: 'Courier New', monospace; }

        #atcFmcPanel {
            position: fixed;
            right: 10px;
            bottom: 60px;
            width: 300px;
            z-index: 99999;
            background: linear-gradient(160deg,#0b1a0b,#050d05);
            border: 1px solid #1e3a1e;
            border-radius: 10px;
            padding: 10px;
            color: #e0e0e0;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6);
            display: none;
        }

        .atc-title {
            text-align:center;
            color:#00cfff;
            font-weight:bold;
            letter-spacing:3px;
            font-size:13px;
            margin-bottom:8px;
            border-bottom:1px solid #1e3a1e;
            padding-bottom:6px;
        }

        .atc-screen {
            background:#071407;
            border:1px solid #1e3a1e;
            border-radius:6px;
            padding:8px;
            min-height:120px;
        }

        .atc-label {
            font-size:10px;
            color:#5aafff;
            letter-spacing:1px;
            text-transform:uppercase;
        }

        .atc-text {
            font-size:12px;
            color:#e8e8e8;
            margin-top:4px;
            word-wrap: break-word;
        }

        .atc-green { color:#00e676; }
        .atc-amber { color:#ffb300; }

        .atc-btn {
            width:100%;
            margin-top:5px;
            padding:6px;
            background:#132113;
            border:1px solid #2a4a2a;
            color:#00cfff;
            font-size:11px;
            cursor:pointer;
            border-radius:4px;
        }

        .atc-btn:hover { background:#1d2d1d; }

        .atc-mic {
            background:#003a00;
            color:#00e676;
        }

        .atc-input {
            width:100%;
            margin-top:6px;
            padding:5px;
            background:#071407;
            border:1px solid #2a4a2a;
            color:white;
            font-size:12px;
        }

        .atc-log {
            margin-top:6px;
            font-size:11px;
            color:#aaa;
            min-height:20px;
        }

        .atc-output {
            margin-top:6px;
            font-size:12px;
            color:#fff;
        }
    `;
    document.head.appendChild(style);

    // ================= PANEL =================
    const panel = document.createElement("div");
    panel.id = "atcFmcPanel";

    panel.innerHTML = `
        <div class="atc-title">✈ ATC CONTROL</div>

        <div class="atc-screen">
            <div class="atc-label">ACTIVE TRANSMISSION</div>
            <div id="atcOut" class="atc-text atc-green">STANDBY...</div>

            <div class="atc-label" style="margin-top:8px;">VOICE LOG</div>
            <div id="atcLog" class="atc-text atc-amber">---</div>
        </div>

        <input id="atcCs" class="atc-input" value="${callsign}" />

        <button class="atc-btn" data-cmd="pushback">PUSHBACK</button>
        <button class="atc-btn" data-cmd="taxi">TAXI</button>
        <button class="atc-btn" data-cmd="takeoff">TAKEOFF</button>
        <button class="atc-btn" data-cmd="climb">CLIMB</button>
        <button class="atc-btn" data-cmd="cruise">CRUISE</button>
        <button class="atc-btn" data-cmd="descent">DESCENT</button>
        <button class="atc-btn" data-cmd="landing">LANDING</button>

        <button class="atc-btn atc-mic" id="micBtn">🎤 START VOICE</button>
    `;

    document.body.appendChild(panel);

    // ================= TOOLBAR BUTTON =================
    const btn = document.createElement("button");
    btn.innerHTML = "ATC";
    btn.className = "mdl-button mdl-js-button geofs-f-standard-ui geofs-mediumScreenOnly";

    btn.onclick = () => {
        panel.style.display = panel.style.display === "none" ? "block" : "none";
    };

    document.querySelector(".geofs-ui-bottom")?.appendChild(btn);

    // ================= SPEECH =================
    function speak(text) {
        speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.rate = 1;
        speechSynthesis.speak(msg);
    }

    function atc(text) {
        callsign = document.getElementById("atcCs").value || "TEST123";
        const full = `${callsign}, ${text}`;

        document.getElementById("atcOut").innerText = full;
        speak(full);
    }

    function handle(cmd) {
        switch (cmd) {
            case "pushback": atc("pushback approved"); break;
            case "taxi": atc("taxi to runway approved"); break;
            case "takeoff": atc("cleared for takeoff"); break;
            case "climb": atc("climb and maintain assigned altitude"); break;
            case "cruise": atc("radar contact established"); break;
            case "descent": atc("descend and maintain flight level 300"); break;
            case "landing": atc("cleared to land, wind calm"); break;
        }
    }

    panel.querySelectorAll("[data-cmd]").forEach(b => {
        b.onclick = () => handle(b.dataset.cmd);
    });

    // ================= VOICE =================
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.lang = "en-US";
    }

    function startVoice() {
        if (!recognition) return alert("Speech not supported");

        recognition.start();
        listening = true;
        document.getElementById("micBtn").innerText = "🛑 STOP VOICE";

        recognition.onresult = (e) => {
            const text = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();

            if (text === lastHeard) return;
            lastHeard = text;

            document.getElementById("atcLog").innerText = "HEARD: " + text;

            if (text.includes("pushback")) handle("pushback");
            else if (text.includes("taxi")) handle("taxi");
            else if (text.includes("takeoff")) handle("takeoff");
            else if (text.includes("climb")) handle("climb");
            else if (text.includes("cruise")) handle("cruise");
            else if (text.includes("descend")) handle("descent");
            else if (text.includes("landing")) handle("landing");
        };

        recognition.onend = () => {
            listening = false;
            document.getElementById("micBtn").innerText = "🎤 START VOICE";
        };
    }

    function stopVoice() {
        if (recognition) recognition.stop();
        listening = false;
    }

    document.getElementById("micBtn").onclick = () => {
        listening ? stopVoice() : startVoice();
    };

})();
