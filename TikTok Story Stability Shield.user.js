// ==UserScript==
// @name         TikTok Story Stability Shield
// @namespace    stability.shield
// @version      3.0
// @match        https://www.tiktok.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // -------------------------------
    // ⚙️ CONFIG
    // -------------------------------
    const STORAGE_KEY = 'tiktok_crash_data';
    const LOG_LIMIT = 12;

    const COOLDOWN_MS = 1000;
    const TRANSITION_LOCK_MS = 800;

    // -------------------------------
    // 🧾 LITE LOGGER
    // -------------------------------
    let logs = [];

    const log = (type, detail) => {
        logs.push({
            t: new Date().toLocaleTimeString(),
            type,
            detail
        });
        if (logs.length > LOG_LIMIT) logs.shift();
    };

    const saveReport = (reason) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            reason,
            time: new Date().toLocaleString(),
            logs
        }));
    };

    // -------------------------------
    // 🧠 STABILITY STATE
    // -------------------------------
    let jsErrorTimes = [];
    let netLoopTimes = [];
    let lastExitState = null;
    let flickerCount = 0;

    let inStory = false;

    let cooldownUntil = 0;
    let transitionLockedUntil = 0;

    // -------------------------------
    // 🧠 SIGNAL DETECTORS
    // -------------------------------

    const now = () => Date.now();

    const jsErrorBurst = () => {
        const t = now();
        jsErrorTimes = jsErrorTimes.filter(x => t - x < 1000);
        return jsErrorTimes.length >= 3;
    };

    const netLoopActive = () => {
        const t = now();
        netLoopTimes = netLoopTimes.filter(x => t - x < 3000);
        return netLoopTimes.length >= 3;
    };

    const domUnstable = () => flickerCount >= 2;

    const inCooldown = () => now() < cooldownUntil;

    const transitionLocked = () => now() < transitionLockedUntil;

    // -------------------------------
    // 🛡️ DEFENCE ACTIONS
    // -------------------------------

    const enterCooldown = (reason) => {
        cooldownUntil = now() + COOLDOWN_MS;
        log("DEFENCE", "Cooldown: " + reason);
    };

    const lockTransitions = () => {
        transitionLockedUntil = now() + TRANSITION_LOCK_MS;
        log("DEFENCE", "Transition locked");
    };

    const triggerRecovery = () => {
        log("DEFENCE", "Recovery triggered");

        const exitBtn = document.querySelector('button[aria-label="exit"]');
        if (exitBtn) {
            exitBtn.click();
        }

        saveReport("Prevented Hard Crash (Recovery Triggered)");
    };

    // -------------------------------
    // 🚫 BLOCK INPUT DURING INSTABILITY
    // -------------------------------
    const blockInteraction = (e) => {
        if (inCooldown() || transitionLocked()) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    };

    window.addEventListener("click", blockInteraction, true);
    window.addEventListener("pointerdown", blockInteraction, true);
    window.addEventListener("keydown", blockInteraction, true);

    // -------------------------------
    // 🌐 NETWORK TRACKING (MINIMAL)
    // -------------------------------
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;

        if (url.includes('/story/view/report')) {
            netLoopTimes.push(now());
            log("NET_LOOP", "story/report");
        }

        return originalFetch(...args);
    };

    // -------------------------------
    // ⚠️ ERROR TRACKING
    // -------------------------------
    window.addEventListener('error', () => {
        jsErrorTimes.push(now());
        log("JS_ERROR", "burst signal");
    }, true);

    // -------------------------------
    // 🧱 DOM OBSERVER
    // -------------------------------
    const observer = new MutationObserver(() => {
        const exitBtn = !!document.querySelector('button[aria-label="exit"]');
        const errorText = document.body.innerText.includes("Something went wrong");

        // Detect story mode
        if (exitBtn && !inStory) {
            inStory = true;
            log("STATUS", "Entered story");
        }

        if (!exitBtn && inStory) {
            log("STATUS", "Exited story (forced)");
        }

        // Flicker detection
        if (lastExitState !== null && lastExitState !== exitBtn) {
            flickerCount++;
            log("FLICKER", "exit button flip");
        }
        lastExitState = exitBtn;

        // -------------------------------
        // 🧠 CORE DEFENCE LOGIC
        // -------------------------------

        const errorBurst = jsErrorBurst();
        const netLoop = netLoopActive();
        const unstable = domUnstable();

        // 1. Enter cooldown early
        if (errorBurst || netLoop) {
            enterCooldown("error/net loop");
        }

        // 2. Lock transitions if DOM unstable
        if (unstable) {
            lockTransitions();
        }

        // 3. Full pre-crash detection
        if (errorBurst && netLoop && unstable) {
            triggerRecovery();
        }

        // 4. Hard failure fallback
        if (errorText) {
            saveReport("UI Error Message Detected");
        }

    });

    observer.observe(document.body, { childList: true, subtree: true });

    // -------------------------------
    // 💥 UNLOAD SAFETY
    // -------------------------------
    window.onbeforeunload = () => {
        if (inStory) {
            saveReport("Page Unload (Possible Crash)");
        }
    };

})();