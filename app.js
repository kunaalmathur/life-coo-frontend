/* ---------------------------------------------------------------
   LIFE COO - FRONTEND (Booking Verdict™ Option B, Render-aligned)
   - Matches current index.html structure
   - Talks to Render backend index.js
   - Stable, minimal, UAT-ready
--------------------------------------------------------------- */

const API_BASE = "https://life-coo-realtime-backend.onrender.com";

// DOM REFERENCES ------------------------------------------------

// Header / drive mode
const driveToggle = document.getElementById("driveToggle");
const themeToggle = document.getElementById("themeToggle");

// Agent box + actions
const agentBox = document.getElementById("agentBox");
const agentInput = document.getElementById("agentInput");
const voiceBtn = document.getElementById("voiceBtn");
const aiFillBtn = document.getElementById("aiFillBtn");
const aiFillOptimizeBtn = document.getElementById("aiFillOptimizeBtn");

// Form fields
const originInput = document.getElementById("origin");
const destinationInput = document.getElementById("destination");
const datesInput = document.getElementById("dates");
const travellersInput = document.getElementById("travellers");
const preferencesInput = document.getElementById("preferences");
const outputStyleSelect = document.getElementById("outputStyle");
const notesInput = document.getElementById("notes");

// Sample + profile
const sampleBtn = document.getElementById("sampleBtn");
const routingUpdated = document.getElementById("routingUpdated");
const rememberProfileCheckbox = document.getElementById("rememberProfile");
const loadProfileBtn = document.getElementById("loadProfileBtn");

// Optimize
const optimizeBtn = document.getElementById("optimizeBtn");
const playRecapCheckbox = document.getElementById("playRecap");

// Results (RHS)
const recapList = document.getElementById("recapList");
const optionsContainer = document.getElementById("optionsContainer");
const riskList = document.getElementById("riskList");

// Booking Recommendation (Beta)
const bookingCard = document.getElementById("bookingCard");
const bookingChannel = document.getElementById("bookingChannel");
const bookingReasons = document.getElementById("bookingReasons");
const bookingLinks = document.getElementById("bookingLinks");

// Risk pills
const riskLow = document.getElementById("riskLow");
const riskMedium = document.getElementById("riskMedium");
const riskHigh = document.getElementById("riskHigh");

// Airports datalist
const airportListEl = document.getElementById("airportList");

// Profile storage key
const PROFILE_KEY = "lifeCooFamilyProfile_v1";

// NEW: remember last optimize result globally
let lastOptimizeResult = null;

// ---------------------------------------------------------------
// TYPOGRAPHY NORMALIZATION (hyphens, dashes)
// ---------------------------------------------------------------

function normalizeDashes(text) {
  if (!text || typeof text !== "string") return text;

  return text
    // Normalize long dashes → spaced hyphen
    .replace(/[\u2012\u2013\u2014\u2015]/g, " - ")
    // Repair real hyphenated words (same-day, hand-offs)
    .replace(/\b(\w+)\s-\s(\w+)\b/g, "$1-$2")
    // Collapse extra whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------
// UI STATE (Upgrade 2 Step 2)
// ---------------------------------------------------------------
const UI_STATES = {
  IDLE: "Idle",
  LISTENING: "Listening",
  UNDERSTANDING: "Understanding",
  OPTIMIZING: "Optimizing",
  SPEAKING: "Speaking",
  ERROR: "Error",
};

let uiState = UI_STATES.IDLE;

let pendingRecapUrl = null;   // if iOS blocks autoplay, we store the audio here

// ✅ iOS audio unlock (Drive Mode uses the toggle as the one "gesture" for the whole session)
let audioUnlocked = false;

function speakIfDriveMode(message) {
  if (!driveModeActive || !message) return;

  speakSummary({
    execRecapBullets: [message],
    routingOptions: [],
    riskRadarBullets: []
  }, { force: true });
}

async function unlockAudioOnce() {
  if (audioUnlocked) return true;

  // 1) WebAudio unlock attempt
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      await ctx.resume();

      // play a tiny silent buffer
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);

      audioUnlocked = true;
      return true;
    }
  } catch (_) {}

  // 2) Fallback: muted HTMLAudio unlock
  try {
    const a = new Audio();
    a.muted = true;
    a.playsInline = true;
    a.src =
      "data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA" +
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    await a.play();
    audioUnlocked = true;
    return true;
  } catch (_) {}

  return false;
}

function setUIState(nextState, messageOverride = "") {
  uiState = nextState;

  // 1) Human-friendly status text
  const defaultMessage =
    nextState === UI_STATES.IDLE ? "Ready." :
    nextState === UI_STATES.LISTENING ? "Listening…" :
    nextState === UI_STATES.UNDERSTANDING ? "Understanding your trip…" :
    nextState === UI_STATES.OPTIMIZING ? "Optimizing your routing…" :
    nextState === UI_STATES.SPEAKING ? "Playing spoken recap…" :
    "Something went wrong. Try again.";

  showRoutingUpdated(messageOverride || defaultMessage);

  // 2) Basic guardrails: prevent double clicks during “busy” states
  const isBusy =
    nextState === UI_STATES.LISTENING ||
    nextState === UI_STATES.UNDERSTANDING ||
    nextState === UI_STATES.OPTIMIZING ||
    nextState === UI_STATES.SPEAKING;

  if (optimizeBtn) optimizeBtn.disabled = isBusy;
  if (aiFillBtn) aiFillBtn.disabled = isBusy;
  if (aiFillOptimizeBtn) aiFillOptimizeBtn.disabled = isBusy;

  // 3) Button labels (tiny polish)
  if (optimizeBtn) {
    optimizeBtn.textContent =
      nextState === UI_STATES.OPTIMIZING ? "Optimizing route…" : "Optimize route ✈️";
  }
   
     // ✅ Voice button label reflects real state (preparing vs playing)
  const statusText = (messageOverride || defaultMessage || "").toLowerCase();

  if (voiceBtn) {
    voiceBtn.textContent =
      nextState === UI_STATES.SPEAKING
        ? (statusText.includes("preparing") || statusText.includes("warming")
            ? "Preparing recap…"
            : "Playing recap…")
        : nextState === UI_STATES.LISTENING
        ? "Listening…"
        : pendingRecapUrl
        ? "Tap to play recap"
        : "Tap to speak";
    voiceBtn.disabled = (nextState === UI_STATES.SPEAKING);
  }
} // ✅ THIS closes setUIState

// NEW: prevent overlapping recap audio
let activeAudio = null;
// ✅ NEW: single source of truth - are we currently playing recap audio?
let isSpeakingAudio = false;
let driveModeQueued = false;
let speakToken = 0; // cancels older in-flight speakSummary calls
let rearmAfterEnd = false;
let micLockedForPlayback = false;

let recognition = null;
let speechFinalTranscript = "";
let speechSilenceTimeout = null;
let isRecognizing = false;

// ✅ Shared helper: resume Drive Mode mic safely after ANY recap audio ends
function resumeDriveModeListeningSafely() {
  if (!(driveModeActive || driveModeQueued)) return;

  driveModeQueued = false;

  // give mobile browsers a beat after playback before restarting mic
  setTimeout(() => {
    startListeningDriveMode();

    // watchdog retry once
    setTimeout(() => {
      if (
        driveModeActive &&
        !isRecognizing &&
        !isSpeakingAudio &&
        !micLockedForPlayback
      ) {
        console.warn("Watchdog: mic did not start, retrying recognition.start()");
        startListeningDriveMode();
      }
    }, 900);
  }, 350);
}

// ---------------------------------------------------------------
// DRIVE MODE - Upgrade 3A (hands-free core)
// ---------------------------------------------------------------
let driveModeActive = false;
let driveModePrevPlayRecap = null;

function setDriveMode(isOn) {
  driveModeActive = isOn;

  // Auto-enable recap while in Drive Mode
  if (playRecapCheckbox) {
    if (isOn) {
      driveModePrevPlayRecap = playRecapCheckbox.checked;
      playRecapCheckbox.checked = true;
    } else if (driveModePrevPlayRecap !== null) {
      playRecapCheckbox.checked = driveModePrevPlayRecap;
      driveModePrevPlayRecap = null;
    }
  }

  // ✅ Drive Mode ON
  if (isOn) {
    // If recap is currently playing, don't start listening yet - queue it
    if (isSpeakingAudio || uiState === UI_STATES.SPEAKING || activeAudio) {
      driveModeQueued = true;
      setUIState(UI_STATES.SPEAKING, "Drive Mode on. Will listen after recap…");
      return;
    }

    // Normal case: start listening immediately
    driveModeQueued = false;
    setUIState(UI_STATES.LISTENING, "Drive Mode on. Listening…");
    startListeningDriveMode();
    return;
  }

  // 🔴 Drive Mode OFF - hard stop voice engine + cancel any queued resume
  rearmAfterEnd = false;
  driveModeQueued = false;

  try { recognition && recognition.stop(); } catch (_) {}
  isRecognizing = false;

  // 🔇 Stop any recap audio immediately
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  micLockedForPlayback = false;
  isSpeakingAudio = false;

  setUIState(UI_STATES.IDLE, "Drive Mode off.");
}

// Returns true if handled (so we don’t send it to /interpret)
function handleDriveModeCommand(rawText) {
  const text = (rawText || "").trim().toLowerCase();
  if (!text) return false;

  // Safety: don’t accept voice commands while speaking (echo risk)
  if (uiState === UI_STATES.SPEAKING) return true;

  // Stop recap
  if (text.includes("stop recap") || text === "stop") {
    speakToken++; // cancel any in-flight recap
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
    isSpeakingAudio = false;
    setUIState(UI_STATES.IDLE, "Recap stopped.");
    // In Drive Mode, resume listening
    if (driveModeActive) startListeningDriveMode();
    return true;
  }

  // Replay recap (last result)
  if (text.includes("replay recap") || text.includes("replay") || text.includes("play recap again")) {
    if (!lastOptimizeResult) {
      setUIState(UI_STATES.ERROR, "Nothing to replay yet. Optimize a trip first.");
      if (driveModeActive) startListeningDriveMode();
      return true;
    }
    speakSummary(lastOptimizeResult, { force: true });
    return true;
  }

  // (Optional) Rewind 10s - only works if audio is currently playing
  // Note: We are NOT listening during playback in Drive Mode, so this is mainly useful after playback ends.
  if (text.includes("rewind 10") || text.includes("rewind ten")) {
    if (activeAudio) {
      activeAudio.currentTime = Math.max(0, (activeAudio.currentTime || 0) - 10);
      setUIState(UI_STATES.SPEAKING, "Rewound 10 seconds.");
    } else {
      setUIState(UI_STATES.ERROR, "No recap is playing right now.");
      if (driveModeActive) startListeningDriveMode();
    }
    return true;
  }

  // Not a command
  return false;
}

// ---------------------------------------------------------------
// INIT
// ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  hydrateAirportDatalist();
  resetResults();

  // ✅ Normalize airport dropdown UX
  normalizeAirportDropdown(originInput);
  normalizeAirportDropdown(destinationInput);
   
  // Restore saved theme
  try {
    const saved = localStorage.getItem("lifeCooTheme");
    if (saved === "light") {
      document.body.classList.add("light-mode");
    }
  } catch (_) {}

if (themeToggle) {
  themeToggle.classList.toggle(
    "drive-switch-active",
    document.body.classList.contains("light-mode")
     );
   }
});

// ---------------------------------------------------------------
// AIRPORT DATALIST (from airports.json)
// ---------------------------------------------------------------
async function hydrateAirportDatalist() {
  if (!airportListEl) return;
  try {
    const res = await fetch("airports.json");
    if (!res.ok) return;
    const airports = await res.json();
    airportListEl.innerHTML = "";
    airports.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = `${a.city} (${a.code})`;
      opt.label = `${a.city} (${a.code}) – ${a.name}`;
      airportListEl.appendChild(opt);
    });
  } catch (err) {
    console.error("Error loading airports.json", err);
  }
}

// ---------------------------------------------------------------
// BASIC UI HELPERS
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// AIRPORT INPUT NORMALIZATION (Premium UX)
// Forces full datalist on focus even when value is prefilled
// ---------------------------------------------------------------

function normalizeAirportDropdown(inputEl) {
  if (!inputEl) return;

  let lastCommittedValue = inputEl.value || "";

  inputEl.addEventListener("focus", () => {
    lastCommittedValue = inputEl.value;
    inputEl.value = "";
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  });

  inputEl.addEventListener("change", () => {
    lastCommittedValue = inputEl.value;
  });

  inputEl.addEventListener("blur", () => {
    if (!inputEl.value) {
      inputEl.value = lastCommittedValue;
    }
  });
}

function showRoutingUpdated(message) {
  if (!routingUpdated) return;
  routingUpdated.textContent = message || "Routing updated";
  routingUpdated.classList.remove("hidden");
}

function resetResults() {
  if (recapList) {
    recapList.innerHTML = "<li>No recap yet.</li>";
  }
  if (optionsContainer) {
    optionsContainer.innerHTML = '<div class="placeholder">No routing options yet.</div>';
  }
  if (riskList) {
    riskList.innerHTML = "<li>No risk details yet.</li>";
  }
   // Reset booking recommendation
  if (bookingCard) bookingCard.classList.add("hidden");
  if (bookingChannel) bookingChannel.textContent = "";
  if (bookingReasons) bookingReasons.innerHTML = "";
  if (bookingLinks) bookingLinks.innerHTML = "";
  }

// Risk pill highlight
function setRiskLevel(level) {
  if (!riskLow || !riskMedium || !riskHigh) return;

  [riskLow, riskMedium, riskHigh].forEach((pill) => {
    pill.style.opacity = "0.4";
    pill.style.boxShadow = "none";
  });

  let active = null;
  if (level === "Low") active = riskLow;
  else if (level === "High") active = riskHigh;
  else active = riskMedium; // default Medium

  if (active) {
    active.style.opacity = "1";
    active.style.boxShadow = "0 0 15px rgba(56,189,248,0.5)";
  }
}

// ---------------------------------------------------------------
// API HELPER (POST JSON)
// ---------------------------------------------------------------
async function postJSON(path, body) {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.error("API error:", res.status, await res.text());
      return { error: true };
    }
    return await res.json();
  } catch (err) {
    console.error("Network error:", err);
    return { error: true };
  }
}

// Helper: POST with a single silent retry + timeout
async function postJSONWithRetry(path, body, options = {}) {
  const {
    maxRetries = 1,
    timeoutMs = 15000, // 15s per attempt
  } = options;

  const url = `${API_BASE}${path}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const isServerError = res.status >= 500 && res.status < 600;

        // retry only on 5xx
        if (attempt < maxRetries && isServerError) {
          console.warn(
            `[postJSONWithRetry] Attempt ${attempt + 1} failed with ${res.status}, retrying...`
          );
          continue;
        }

        console.error(
          "postJSONWithRetry final HTTP error:",
          res.status,
          await res.text()
        );
        return { error: true };
      }

      // 🎉 success
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);

      const isAbortError = err.name === "AbortError";
      const isNetworkError = err instanceof TypeError;

      if (attempt < maxRetries && (isAbortError || isNetworkError)) {
        console.warn(
          `[postJSONWithRetry] Attempt ${attempt + 1} error, retrying...`,
          err
        );
        continue;
      }

      console.error("postJSONWithRetry final error:", err);
      return { error: true };
    }
  }

  // Fallback (shouldn’t really hit)
  return { error: true };
}

// ---------------------------------------------------------------
// INTERPRET (free text → structured form)
// ---------------------------------------------------------------
async function runInterpret(autoOptimize = false) {
  const text = (agentInput?.value || "").trim();
  if (!text) return;
// ✅ Global voice/text commands (work even when Drive Mode is OFF)
  if (handleDriveModeCommand(text)) {
    return;
  }

   setUIState(UI_STATES.UNDERSTANDING);

  if (aiFillBtn) {
    aiFillBtn.disabled = true;
    aiFillBtn.textContent = "Understanding your trip…";
  }
  if (aiFillOptimizeBtn) aiFillOptimizeBtn.disabled = true;

  const result = await postJSON("/interpret", { text });

  if (aiFillBtn) {
    aiFillBtn.disabled = false;
    aiFillBtn.textContent = "AI fill form";
  }
  if (aiFillOptimizeBtn) aiFillOptimizeBtn.disabled = false;

if (result.error) {
  const msg = "I couldn't understand that. Please rephrase your trip.";
  setUIState(UI_STATES.ERROR, msg);
  speakIfDriveMode(msg);
  return;
}

  // Map backend fields → form DOM
  originInput.value = result.origin || "";
  
  destinationInput.value = result.destination || "";
  
  datesInput.value = result.datesWindow || "";
  travellersInput.value = result.travellers || "";
  preferencesInput.value = result.preferences || "";
  notesInput.value = result.notes || "";

  if (autoOptimize) {
     // If interpret didn’t extract the minimum needed fields, don’t pretend we can optimize.
     if (!originInput.value.trim() || !destinationInput.value.trim()) {
       const msg = "I understood part of your request, but I still need the origin and destination.";
       setUIState(UI_STATES.ERROR, msg);
       speakIfDriveMode(msg);
       return;
     }

     setUIState(UI_STATES.IDLE, "Trip understood. Optimizing now…");
     await runOptimize();
     return;
}    else {
     setUIState(UI_STATES.IDLE, "Trip understood. Ready to optimize.");
     return;
}

}

// Button: AI fill only
aiFillBtn?.addEventListener("click", () => runInterpret(false));

// Button: AI fill + optimize
aiFillOptimizeBtn?.addEventListener("click", () => runInterpret(true));

// ---------------------------------------------------------------
// VOICE INPUT - STREAMING + SANE PAUSE
// ---------------------------------------------------------------

function startListeningDriveMode() {
  if (micLockedForPlayback) return;
  if (!driveModeActive) return;
  if (!recognition) {
    setUIState(UI_STATES.ERROR, "Drive Mode requires a browser that supports voice input.");
    return;
  }

  // ✅ Don’t listen while recap audio is playing (echo protection)
  if (isSpeakingAudio) return;

  // ✅ If we are already listening, do nothing.
  if (isRecognizing) return;

  // Reset capture
  speechFinalTranscript = "";
  if (speechSilenceTimeout) {
    clearTimeout(speechSilenceTimeout);
    speechSilenceTimeout = null;
  }

  if (agentInput) {
    agentInput.value = "";
    agentInput.placeholder = "Drive Mode: speak naturally…";
  }

  try {
    recognition.start();
  } catch (e) {
    console.warn("Drive Mode recognition.start() blocked:", e);
  }
}

/* 🔼🔼🔼 END BLOCK C 🔼🔼🔼 */

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";

  // ✅ KEY CHANGES
  recognition.continuous = true;       // keep listening across small pauses
  recognition.interimResults = true;   // stream partial text as you speak

recognition.onstart = () => {
  // Never allow mic to “start” while recap audio is playing
  if (micLockedForPlayback || isSpeakingAudio) {
    try { recognition.stop(); } catch (_) {}
    return;
  }

  isRecognizing = true;
  setUIState(UI_STATES.LISTENING);

  if (agentBox) agentBox.classList.add("agent-box-active");
  if (agentInput) agentInput.placeholder = "Listening… speak naturally.";
};
   
recognition.onerror = (event) => {
  if (micLockedForPlayback || isSpeakingAudio) return;
  console.warn("Speech recognition error:", event.error);
  const isSoft =
    event.error === "no-speech" ||
    event.error === "aborted" ||
    event.error === "audio-capture" ||
    event.error === "network";

  // Drive Mode: treat common errors as transient and re-arm listening
  if (driveModeActive && isSoft) {
      setUIState(UI_STATES.IDLE, "Re-arming listening…");

    // Ask the normal onend handler to re-arm
    rearmAfterEnd = true;

    try { recognition.stop(); } catch (_) {}
    return;
  }

  // Hard failures (permissions)
  if (
    driveModeActive &&
    (event.error === "not-allowed" || event.error === "service-not-allowed")
  ) {
    setUIState(
      UI_STATES.ERROR,
      "Mic permission blocked. Allow mic access, then toggle Drive Mode again."
    );
    return;
  }

  // Manual mode fallback
  setUIState(UI_STATES.IDLE, "Voice had a hiccup. Tap to speak again.");
  if (agentBox) agentBox.classList.remove("agent-box-active");
  //if (voiceBtn) voiceBtn.textContent = "Tap to speak";
  if (agentInput) agentInput.placeholder = "Describe your trip to your Travel COO…";

  if (speechSilenceTimeout) {
    clearTimeout(speechSilenceTimeout);
    speechSilenceTimeout = null;
  }
};

  recognition.onresult = (event) => {
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;

      if (result.isFinal) {
        speechFinalTranscript += transcript + " ";
      } else {
        interimTranscript += transcript + " ";
      }
    }

    // ✅ LIVE STREAMING TEXT (final + interim)
    const combined = (speechFinalTranscript + interimTranscript).trim();
    if (agentInput) agentInput.value = combined;

    // ✅ Reset silence timer on every result
    if (speechSilenceTimeout) {
      clearTimeout(speechSilenceTimeout);
    }
    // If user is silent for 2 seconds, stop & process
    speechSilenceTimeout = setTimeout(() => {
      recognition.stop();
    }, 2000); // Increase to 2500–3000 if you want more breathing room
  };

  recognition.onend = () => {
    isRecognizing = false;
       // ✅ If recap audio is playing, do NOT rearm listening or change state
    if (micLockedForPlayback || isSpeakingAudio) return;
     // Soft-error rearm path (must happen before finalText processing)
    if (driveModeActive && rearmAfterEnd) {
    rearmAfterEnd = false;
    setTimeout(() => startListeningDriveMode(), 250);
    return;
  }
    if (speechSilenceTimeout) {
      clearTimeout(speechSilenceTimeout);
      speechSilenceTimeout = null;
    }
    if (agentBox) agentBox.classList.remove("agent-box-active");
    //if (voiceBtn) voiceBtn.textContent = "Tap to speak";
    if (agentInput && !agentInput.value) {
      agentInput.placeholder = "Describe your trip to your Travel COO…";
    }

    const finalText = agentInput ? agentInput.value.trim() : "";

if (!finalText) {
  if (driveModeActive) {
    // Do NOT change UI here - let onstart handle it
    setTimeout(() => startListeningDriveMode(), 300);
    return;
  }

  setUIState(UI_STATES.IDLE);
  return;
}
      setUIState(UI_STATES.UNDERSTANDING);

    // 🔴 THIS IS THE CRITICAL LINE:
    // Use your existing pipeline exactly as before
    // Drive Mode: intercept luxury commands (stop/replay/etc)
    if (driveModeActive && handleDriveModeCommand(finalText)) {
      return;
    }

// Normal pipeline
runInterpret(true);
  };
}

voiceBtn?.addEventListener("click", () => {
// ✅ If iOS blocked autoplay, let user tap to play recap instead of starting mic
  if (pendingRecapUrl) {
    // Stop mic if it's running
    rearmAfterEnd = false;
    try { recognition && recognition.stop(); } catch (_) {}
    isRecognizing = false;

    // Stop any existing recap audio first
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }

    const a = new Audio(pendingRecapUrl);
    activeAudio = a;

    a.onplay = () => {
      isSpeakingAudio = true;
      micLockedForPlayback = true;
      setUIState(UI_STATES.SPEAKING, "Playing spoken recap now.");
    };

    a.onended = () => {
     isSpeakingAudio = false;
     micLockedForPlayback = false;
     activeAudio = null;

     URL.revokeObjectURL(pendingRecapUrl);
     pendingRecapUrl = null;

     setUIState(UI_STATES.IDLE, "Routing updated just now.");
     resumeDriveModeListeningSafely();
   };

    a.onerror = () => {
      isSpeakingAudio = false;
      micLockedForPlayback = false;
      activeAudio = null;

      URL.revokeObjectURL(pendingRecapUrl);
      pendingRecapUrl = null;

      setUIState(UI_STATES.ERROR, "Could not play spoken recap.");
      // If Drive Mode is on, don't strand the user - re-arm listening
      resumeDriveModeListeningSafely();

    };

    a.play().catch(() => {
      setUIState(UI_STATES.ERROR, "Playback blocked. Try again.");
    });

    return; // ✅ don't start recognition on this tap
  }

  if (!recognition) {
    setUIState(UI_STATES.ERROR, "Voice input isn’t supported in this browser.");
    return;
  }
  if (isRecognizing) return;   // ✅ add this

  // reset state for a fresh capture
  speechFinalTranscript = "";
  if (speechSilenceTimeout) {
    clearTimeout(speechSilenceTimeout);
    speechSilenceTimeout = null;
  }

  if (agentInput) {
    agentInput.value = "";
    agentInput.placeholder = "Listening… speak naturally.";
  }

  try {
  recognition.start();
} catch (e) {
  console.warn("Manual recognition.start() blocked:", e);
}

});

// ==== END VOICE RECOGNITION v2 ====

// ---------------------------------------------------------------
// OPTIMIZE - form → backend → RHS
// ---------------------------------------------------------------
async function runOptimize() {
  const origin = originInput.value.trim();
  const destination = destinationInput.value.trim();

if (!origin || !destination) {
  const msg = "Please tell me both the origin and destination.";
  setUIState(UI_STATES.ERROR, msg);
  speakIfDriveMode(msg);
  return;
}
  setUIState(UI_STATES.OPTIMIZING);

  const datesWindow = datesInput.value.trim();
  const travellers = travellersInput.value.trim();
  const preferences = preferencesInput.value.trim();
  const notes = notesInput.value.trim();
  const outputStyle =
    (outputStyleSelect.value || "Executive summary (C-suite / family office)").trim();

  setUIState(UI_STATES.OPTIMIZING, "Optimizing your routing…");

  // Optionally save profile
  if (rememberProfileCheckbox?.checked) {
    saveProfile();
  }

  const payload = {
    origin,
    destination,
    datesWindow,
    travellers,
    preferences,
    outputStyle,
    notes,
  };

  // Cold-start immunity: fast attempt, then a masked retry
  let result = await postJSONWithRetry("/optimize", payload, {
    maxRetries: 0,
    timeoutMs: 8000,
  });

  if (result.error) {
    setUIState(UI_STATES.OPTIMIZING, "Waking up your concierge… one moment.");
    result = await postJSONWithRetry("/optimize", payload, {
      maxRetries: 0,
      timeoutMs: 15000,
    });
  }

  if (result.error) {
    setUIState(UI_STATES.ERROR, "Couldn’t optimize. Please try again.");
    return;
  }

  // remember latest result for replay / late recap
  lastOptimizeResult = result;

  const verdictSignals = extractBookingSignals({
  input: {
    travellers,
    datesWindow
  },
  optimizeResult: result
});

const verdict = getBookingVerdict(verdictSignals);
result.bookingVerdict = verdict;   

  // Render verdict BEFORE backend recommendation (intentional)
   
  renderBookingVerdict(verdict);
  renderBookingRecommendation({
     bookingLinks: result.bookingLinks || []
  });
  renderResults(result);
  setUIState(UI_STATES.IDLE, "Routing updated just now.");

  if (playRecapCheckbox?.checked) {
    speakSummary(result);
  }
}

optimizeBtn?.addEventListener("click", async () => {
  unlockAudioOnce();     // ✅ helps iPhone allow upcoming playback
  await runOptimize();
});

function renderBookingRecommendation(br) {
  if (!bookingCard || !br) return;

  bookingCard.classList.remove("hidden");

  bookingChannel.textContent = "Where to book";

  // Executive non-bulleted guidance (intentional)
  bookingReasons.innerHTML = `
    <div style="font-size:13px; line-height:1.55;">
      Booking directly with the airline provides stronger control during
      disruptions and ensures priority re-accommodation when plans change.
    </div>
  `;

  bookingLinks.innerHTML = "";
  (br.bookingLinks || []).forEach(link => {
    const a = document.createElement("a");
    a.className = "lux-link-btn";
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = link.label;
    bookingLinks.appendChild(a);
  });
}

function extractBookingSignals({ input, optimizeResult }) {
  const travellersText = (input.travellers || "").toLowerCase();
  const datesText = (input.datesWindow || "").toLowerCase();

  const hasFamily =
    travellersText.includes("kid") ||
    travellersText.includes("child") ||
    travellersText.includes("infant");

  const flexibility =
    datesText.includes("flex") ||
    datesText.includes("±")
      ? "high"
      : "low";

  // Try to infer trip length from routing options if present
  let tripLengthDays = 7; // fallback
  if (Array.isArray(optimizeResult?.routingOptions)) {
    const text = optimizeResult.routingOptions
      .map(opt => (opt.bullets || []).join(" "))
      .join(" ");

    const daysMatch = text.match(/(\d+)\s*(day|night)/i);
    if (daysMatch) {
      tripLengthDays = parseInt(daysMatch[1], 10);
    }
  }
   
  // Season inference (safe & conservative for v1)
  let season = "shoulder";
  if (datesText.includes("dec") || datesText.includes("jan") || datesText.includes("feb")) {
    season = "winter";
  } else if (datesText.includes("jul") || datesText.includes("aug")) {
    season = "summer";
  }

  return {
    hasFamily,
    flexibility,
    tripLengthDays,
    season
  };
}

// ---------------------------------------------------------------
// BOOKING VERDICT LOGIC (v1 - pure, frontend-only)
// ---------------------------------------------------------------

function getBookingVerdict({ hasFamily, flexibility, tripLengthDays, season }) {
  let verdict = "DIRECT WITH AIRLINE";
  let confidence = "High";
  let reasons;

if (hasFamily) {
  reasons = [
    "Higher priority rebooking when traveling with dependents",
    "Cleaner support path when same-day alternatives are required",
    "Fewer vendor hand-offs during irregular operations"
  ];
} else if (season === "winter") {
  reasons = [
    "Faster reaccommodation during weather-driven delays",
    "Reduced downgrade risk during capacity re-balancing",
    "Direct access to airline disruption queues"
  ];
} else if (flexibility === "high") {
  reasons = [
    "Flexibility allows selective use of lower-cost channels",
    "Airline-direct preserves disruption control if plans shift",
    "Avoids refund delays across fragmented ticketing"
  ];
} else {
  reasons = [
    "Priority handling during disruptions",
    "Simplest path for rebooking and refunds",
    "Fewer hand-offs during irregular operations"
  ];
}

  if (!hasFamily && flexibility === "high") {
  confidence = "Medium";
}

  let hiddenRisk;

  if (hasFamily) {
    hiddenRisk =
      "This booking avoids third-party reaccommodation delays, which typically cause overnight stranding when weather or aircraft swaps disrupt schedules.";
  } else if (season === "winter") {
    hiddenRisk =
      "This booking avoids priority downgrades, which often happen during winter disruption queues on indirect ticketing.";
  } else if (flexibility === "high") {
    hiddenRisk =
      "This booking avoids fragmented refunds, which commonly slow down cancellations when plans change inside short booking windows.";
  } else {
    hiddenRisk =
      "This booking avoids indirect support loops, which can delay resolution when itinerary changes are required.";
  }

  return {
    verdict,
    confidence,
    reasons,
    hiddenRisk
  };
}

// ---------------------------------------------------------------
// BOOKING VERDICT (Frontend-only, v1)
// ---------------------------------------------------------------

function ensureBookingVerdictContainer() {
  if (!bookingCard) return null;
   
  let verdictEl = document.getElementById("bookingVerdict");
  if (!verdictEl) {
    verdictEl = document.createElement("div");
    verdictEl.id = "bookingVerdict";
    verdictEl.style.marginBottom = "16px";
    verdictEl.style.padding = "12px 14px";
    verdictEl.style.border = "1px solid rgba(255,255,255,0.15)";
    verdictEl.style.borderRadius = "14px";
    verdictEl.style.background = "rgba(17,24,39,0.85)";

    // bookingCard.parentNode.insertBefore(verdictEl, bookingCard);
    const whereToBookSection = bookingCard.closest(".rhs-section") || bookingCard.parentNode;
    whereToBookSection.parentNode.insertBefore(verdictEl, whereToBookSection);
  }
  return verdictEl;
}

function renderBookingVerdict(verdict) {
  const container = ensureBookingVerdictContainer();
  if (!container || !verdict) return;

  container.classList.add("booking-verdict");
  container.innerHTML = `
    <div style="
      font-size:11px;
      letter-spacing:0.18em;
      opacity:0.6;
      margin-bottom:10px;
    ">
      BOOKING VERDICT
    </div>

    <div style="
      font-size:20px;
      font-weight:600;
      margin-bottom:6px;
    ">
      ${verdict.verdict}
    </div>

    <div style="
      font-size:12px;
      opacity:0.6;
      margin-bottom:14px;
    ">
      Confidence · ${verdict.confidence}
    </div>

    <div style="
  margin-bottom:12px;
">
  <div style="
    font-size:11px;
    letter-spacing:0.18em;
    opacity:0.6;
    margin-bottom:6px;
  ">
    HIDDEN RISK AVOIDED
  </div>

  <div style="
    font-size:13px;
    line-height:1.55;
    opacity:0.95;
  ">
    ${verdict.hiddenRisk}
  </div>
</div>

<ul style="
  margin:0;
  padding-left:18px;
  line-height:1.45;
">
  ${verdict.reasons
    .map(r => `<li style="margin-bottom:6px;">${normalizeDashes(r)}</li>`)
    .join("")}
</ul>
  `;
}

// ---------------------------------------------------------------
// RENDER RESULTS (RHS)
// ---------------------------------------------------------------
function renderResults(data) {
  const execRecapBullets = Array.isArray(data.execRecapBullets)
    ? data.execRecapBullets
    : [];
  const routingOptions = Array.isArray(data.routingOptions)
    ? data.routingOptions
    : [];
  const riskRadarBullets = Array.isArray(data.riskRadarBullets)
    ? data.riskRadarBullets
    : [];

  // Recap
  recapList.innerHTML = "";
  if (!execRecapBullets.length) {
    recapList.innerHTML = "<li>No recap returned.</li>";
  } else {
    execRecapBullets.forEach((b) => {
      const li = document.createElement("li");
      li.textContent = normalizeDashes(b);
      recapList.appendChild(li);
    });
  }

  // Options
  optionsContainer.innerHTML = "";
  if (!routingOptions.length) {
    optionsContainer.innerHTML = '<div class="placeholder">No routing options returned.</div>';
  } else {
    routingOptions.forEach((opt) => {
      const block = document.createElement("div");
      block.className = "option-block";

      const title = document.createElement("div");
      title.className = "option-title";
      title.textContent = normalizeDashes(opt.title || "Option");
      block.appendChild(title);

      const ul = document.createElement("ul");
      ul.className = "option-bullets";
      (opt.bullets || []).forEach((b) => {
        const li = document.createElement("li");
        li.textContent = normalizeDashes(b);
        ul.appendChild(li);
      });
      block.appendChild(ul);

      optionsContainer.appendChild(block);
    });
  }

  // Risk
  riskList.innerHTML = "";
  if (!riskRadarBullets.length) {
    riskList.innerHTML = "<li>No risk details returned.</li>";
  } else {
    riskRadarBullets.forEach((b) => {
      const li = document.createElement("li");
      li.textContent = normalizeDashes(b);
      riskList.appendChild(li);
    });
  }

  // Risk level pill
  setRiskLevel(data.riskLevel || "Medium");
}

// ✅ iOS autoplay fallback: when playback is blocked, store URL and ask user to tap
function showTapToPlayRecap(url) {
  pendingRecapUrl = url;
  setUIState(UI_STATES.IDLE, "Recap ready. Tap the voice button to play.");
}

// ---------------------------------------------------------------
// SPEAK SUMMARY (cleaner, de-garbled recap)
// ---------------------------------------------------------------
async function speakSummary(data, { force = false } = {}) {
  if (data.bookingVerdict) {
  data.execRecapBullets = [
    ...(data.execRecapBullets || []),
    `Booking recommendation: ${data.bookingVerdict.verdict}.`,
    data.bookingVerdict.hiddenRisk
     ];
   } 
  setUIState(UI_STATES.SPEAKING);
  const myToken = ++speakToken;
  try {
    // UX: let the user know something is happening
    setUIState(UI_STATES.SPEAKING, "Preparing your spoken recap…");

  let res = await fetch(`${API_BASE}/tts-recap`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

if (!res.ok) {
  // masked single retry for cold-start
  setUIState(UI_STATES.SPEAKING, "Warming the voice concierge…");
  await new Promise((r) => setTimeout(r, 900));

  res = await fetch(`${API_BASE}/tts-recap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

if (!res.ok) {
  console.error("TTS recap error:", res.status, await res.text());
  setUIState(UI_STATES.ERROR, "Could not play spoken recap.");
  return;
}

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

   // If another speak started after this one, or recap got turned off, don't play.
   if (myToken !== speakToken || (!force && !playRecapCheckbox?.checked)) {
     URL.revokeObjectURL(url);
     setUIState(UI_STATES.IDLE, "Recap skipped.");
     return;
   }
    const audio = new Audio(url);

audio.onplay = () => {
  isSpeakingAudio = true;
  micLockedForPlayback = true; // ✅ HARD LOCK
  setUIState(UI_STATES.SPEAKING, "Playing spoken recap now.");
};

audio.onended = () => {
  isSpeakingAudio = false;
  micLockedForPlayback = false; // ✅ UNLOCK

  activeAudio = null;
  URL.revokeObjectURL(url);
   
  setUIState(UI_STATES.IDLE, "Routing updated just now.");
  
  resumeDriveModeListeningSafely();
};

audio.onerror = () => {
  isSpeakingAudio = false;
  micLockedForPlayback = false;

  activeAudio = null;
  URL.revokeObjectURL(url);
  setUIState(UI_STATES.ERROR, "Could not play spoken recap.");

  resumeDriveModeListeningSafely();
};

// Stop any previous recap audio (prevents overlap)
if (activeAudio) {
  activeAudio.pause();
  activeAudio.currentTime = 0;
  activeAudio = null;
}
activeAudio = audio;

// ✅ HARD STOP mic + timers before playing audio (prevents echo pickup / weird UI)
rearmAfterEnd = false;
driveModeQueued = driveModeQueued || driveModeActive;

if (speechSilenceTimeout) {
  clearTimeout(speechSilenceTimeout);
  speechSilenceTimeout = null;
}

if (isRecognizing) {
  try { recognition.stop(); } catch (_) {}
  isRecognizing = false;
}

audio.play().catch(async (err) => {
  console.warn("Autoplay blocked:", err);

  // ✅ Drive Mode: try to unlock and retry once (hands-free as much as iOS allows)
  if (driveModeActive) {
    const ok = await unlockAudioOnce();
    if (ok) {
      try {
        await audio.play();
        return;
      } catch (_) {
        // fall through to tap-to-play
      }
    }
  }

  // fallback (works everywhere)
  showTapToPlayRecap(url);
});

  } catch (err) {
    console.error("Network error during TTS recap:", err);
    setUIState(UI_STATES.ERROR, "Could not play spoken recap.");
  }
}


// ---------------------------------------------------------------
// SAMPLE + PROFILE
// ---------------------------------------------------------------
sampleBtn?.addEventListener("click", () => {
  originInput.value = "Calgary (YYC)";
  destinationInput.value = "London (LHR)";
  datesInput.value = "Mid-July, flexible ±2 days";
  travellersInput.value = "2 adults, 2 kids";
  preferencesInput.value = "1 stop, layover under 4 hours, daytime flights";
  outputStyleSelect.value = "Executive summary (C-suite / family office)";
  notesInput.value = "Kids are 8 and 10; prefer calm connections.";
  showRoutingUpdated("Sample trip loaded. Ready to optimize.");
});

function saveProfile() {
  try {
    const profile = {
      origin: originInput.value,
      destination: destinationInput.value,
      datesWindow: datesInput.value,
      travellers: travellersInput.value,
      preferences: preferencesInput.value,
      outputStyle: outputStyleSelect.value,
      notes: notesInput.value
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.error("Error saving profile", err);
  }
}

loadProfileBtn?.addEventListener("click", () => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      setUIState(UI_STATES.ERROR, "No saved family profile yet.");
      return;
    }
    const profile = JSON.parse(raw);
    originInput.value = profile.origin || "";
    destinationInput.value = profile.destination || "";
    datesInput.value = profile.datesWindow || "";
    travellersInput.value = profile.travellers || "";
    preferencesInput.value = profile.preferences || "";
    outputStyleSelect.value = profile.outputStyle || "";
    notesInput.value = profile.notes || "";
    setUIState(UI_STATES.IDLE, "Saved family profile loaded.");
  } catch (err) {
    console.error("Error loading profile", err);
  }
});

// ---------------------------------------------------------------
// This makes it play immediately if you tick the box after a result is already on screen.
// ---------------------------------------------------------------

   playRecapCheckbox?.addEventListener("change", () => {
  // If user turns it OFF: stop audio + cancel any in-flight fetch
  if (!playRecapCheckbox.checked) {
    speakToken++; // cancels pending speakSummary responses

    if (pendingRecapUrl) {
      URL.revokeObjectURL(pendingRecapUrl);
      pendingRecapUrl = null;
    }

    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }

    setUIState(UI_STATES.IDLE, "Recap playback off.");

    // if Drive Mode is on, resume listening immediately
    if (driveModeActive) startListeningDriveMode();
    return;
  }

  // If user turns it ON: unlock audio now (iOS gesture)
  unlockAudioOnce();

  // Clean up any existing audio/pending before starting a new recap
  speakToken++; // cancel any in-flight recap
  if (pendingRecapUrl) {
    URL.revokeObjectURL(pendingRecapUrl);
    pendingRecapUrl = null;
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }

  // If a recap already exists, play it (unless we're currently speaking/locked)
  if (lastOptimizeResult && !isSpeakingAudio && !micLockedForPlayback) {
    speakSummary(lastOptimizeResult);
  }
});


// ---------------------------------------------------------------
// DRIVE MODE (visual only for now)
// ---------------------------------------------------------------

driveToggle?.addEventListener("click", () => {
  // Decide intent based on current logical state
  const isTurningOn = !driveModeActive;

  // iOS: use Drive Mode toggle as the one-time gesture to unlock audio
  if (isTurningOn) {
    unlockAudioOnce();
  }

  // 🔐 SINGLE SOURCE OF TRUTH
  setDriveMode(isTurningOn);

  // 🔁 Reflect state visually (CSS / SVG reads from this)
  driveToggle.classList.toggle("drive-switch-active", isTurningOn);
  document.body.classList.toggle("drive-mode", isTurningOn);
});

// ---------------------------------------------------------------
// THEME TOGGLE (Dark / Light)
// ---------------------------------------------------------------
themeToggle?.addEventListener("click", () => {
  const isLight = document.body.classList.toggle("light-mode");
  themeToggle.classList.toggle("drive-switch-active", isLight);
  try {
    localStorage.setItem("lifeCooTheme", isLight ? "light" : "dark");
  } catch (_) {}
});
