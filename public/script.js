/**
 * 103.5 Dawn FM - Client Logic (Server Driven)
 */

// Audio streamed from secure endpoint
const AUDIO_SRC = 'stream';

// DOM Elements
const audioEl = document.getElementById('radio-stream');
const overlayEl = document.getElementById('interaction-overlay');
const titleEl = document.getElementById('track-title');
const artistEl = document.getElementById('track-artist');
const artEl = document.getElementById('track-art');
const bgEl = document.getElementById('dynamic-bg');
const muteBtn = document.getElementById('mute-btn');
const volSlider = document.getElementById('volume-slider');

// Configuration
const DEFAULT_IMAGE = "cover"; // Served from backend
let isPlaying = false;
var syncTimeout = null; // var avoids Temporal Dead Zone issues if hoisted functions access it

/**
 * Initialize
 */
async function init() {
    audioEl.src = AUDIO_SRC;

    try {
        if (typeof FastAverageColor !== 'undefined') {
            colorFac = new FastAverageColor();
        } else {
            console.warn("FastAverageColor lib not found.");
        }
    } catch (e) {
        console.warn("Color init error", e);
    }

    // Initial Sync
    await performSync();

    setupControls();
    setupInteraction();
    setupMediaSession();
}

/**
 * Sync with Server
 * Fetches current metadata and schedules the next update.
 */
async function performSync() {
    try {
        const res = await fetch('sync');
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        // Clone response to read text if json fails
        const clone = res.clone();
        let data;
        try {
            data = await res.json();
        } catch (jsonErr) {
            const text = await clone.text();
            console.error("Invalid JSON received:", text.substring(0, 100)); // Log first 100 chars
            throw new Error("Invalid JSON");
        }

        console.log(`[Dawn FM] Sync: ${data.now_playing.title} (${data.formatted_time})`);

        // Update Visuals
        updateVisuals(data.now_playing);

        // NOTE: We no longer seek/correct drift manually.
        // The /stream endpoint handles the "Tune In" time on connection.
        // We just let it play.

        // Schedule Next Sync
        // Add a small buffer (e.g. 100ms) to ensure server has flipped to next track
        const delay = data.next_update_in + 100;
        console.log(`[Dawn FM] Next update in: ${(delay / 1000).toFixed(1)}s`);

        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(performSync, delay);

    } catch (e) {
        console.error("Sync failed:", e);
        // Retry in 5 seconds if failed
        setTimeout(performSync, 5000);
    }
}

/**
 * Visuals
 */
function updateVisuals(meta) {
    if (titleEl.textContent === meta.title) return; // No change

    titleEl.classList.add('fade-out');
    // Artist is static for this album usually, but we keep it dynamic just in case
    // artistEl.classList.add('fade-out'); 

    setTimeout(() => {
        titleEl.textContent = meta.title;
        artistEl.textContent = "The Weeknd"; // Hardcoded or from meta if provided

        artEl.src = DEFAULT_IMAGE;
        if (artEl.classList.contains('hidden')) {
            artEl.classList.remove('hidden');
        }

        titleEl.classList.remove('fade-out');

        // Update OS Media Session
        updateMediaSession(meta);
    }, 600);
}

/**
 * Omni-Click / Interaction
 */
function setupInteraction() {
    const unlock = () => {
        audioEl.play().catch(e => console.warn("Autoplay blocked", e));
        overlayEl.classList.add('hidden');
        setTimeout(() => { overlayEl.style.display = 'none'; }, 500);

        // Remove listeners once unlocked
        overlayEl.removeEventListener('click', unlock);
        document.removeEventListener('keydown', unlock);
    };

    overlayEl.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);

    // Auto-sync on resume/play to fix background desync
    audioEl.addEventListener('play', () => {
        isPlaying = true;
        console.log("[Dawn FM] Resumed. Re-syncing clock...");
        performSync();
    });

    audioEl.addEventListener('pause', () => {
        isPlaying = false;
    });
}

/**
 * Controls (Unique to User)
 * Since this is client-side JS, it is inherently unique to the user session.
 */
function setupControls() {
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audioEl.muted = !audioEl.muted;
        updateMuteIcon();
    });

    volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        audioEl.volume = e.target.value;
        if (audioEl.volume > 0) audioEl.muted = false; // Unmute if volume > 0
        updateMuteIcon();
    });

    // Prevent overlay clicks when using controls
    document.querySelector('.controls-container').addEventListener('click', (e) => e.stopPropagation());
    // Also allow interaction on the overlay AREA if safe, but we moved controls up via Z-Index
}

function updateMuteIcon() {
    // Show normal icon if flow is active (volume > 0 and not explicitly muted)
    const isMuted = audioEl.muted || audioEl.volume === 0;
    muteBtn.innerHTML = isMuted
        ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4l-6.84 4.12H5v6h2.26"></path></svg>'
        : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
    // Note: Updated "normal" icon to include sound waves
}

/**
 * Media Session API
 * Integrates with OS lock screen, watches, etc.
 */
function setupMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
            audioEl.play().catch(e => console.warn("Play blocked", e));
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            audioEl.pause();
        });
        navigator.mediaSession.setActionHandler('stop', () => {
            audioEl.pause();
            audioEl.currentTime = 0; // Optional: Reset logic
        });
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
    }
}

function updateMediaSession(meta) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: meta.title,
            artist: "The Weeknd",
            album: "Dawn FM",
            artwork: [
                { src: DEFAULT_IMAGE, sizes: '512x512', type: 'image/jpeg' }
            ]
        });
    }
}

init();
