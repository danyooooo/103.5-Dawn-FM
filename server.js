const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIGURATION & STATE
// ==========================================
// Parsing MM:SS to Milliseconds
function parseTime(timeStr) {
    const [min, sec] = timeStr.split(':').map(Number);
    return (min * 60 + sec) * 1000;
}

// Load and Parse Data
const rawData = JSON.parse(fs.readFileSync(path.join(__dirname, 'server/data/offsets.json'), 'utf8'));
const STATION_DATA = rawData.map(track => ({
    ...track,
    triggerMs: parseTime(track.triggerAt)
})).sort((a, b) => a.triggerMs - b.triggerMs);

// Global Clock
const TOTAL_AUDIO_DURATION_MS = 3600 * 1000; // Default 1 hour fallback
const STATE_FILE = path.join(__dirname, 'server/data/state.json');

// Load stored state or start fresh
let existingUptime = 0;
try {
    if (fs.existsSync(STATE_FILE)) {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (state.uptime && typeof state.uptime === 'number') {
            existingUptime = state.uptime;
            console.log(`[Dawn FM] Resuming broadcast from: ${existingUptime} ms`);
        }
    }
} catch (e) {
    console.warn("[Dawn FM] State load failed, starting fresh.", e.message);
}

// The moment the station "virtually" started
const SERVER_START_TIME = Date.now() - existingUptime;

console.log(`[Dawn FM] Station launched. Tracks loaded: ${STATION_DATA.length}`);

// Autosave State often (every 5 seconds)
setInterval(() => {
    const uptime = (Date.now() - SERVER_START_TIME) % TOTAL_AUDIO_DURATION_MS;
    fs.writeFile(STATE_FILE, JSON.stringify({ uptime }), (err) => {
        if (err) console.error("[Dawn FM] State save failed", err.message);
    });
}, 5000);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
    // console.log(`[Request] ${req.method} ${req.url}`); // Verbose logging
    next();
});
// Mount static on both
app.use('/dawn-fm', express.static(path.join(__dirname, 'public')));
app.use('/', express.static(path.join(__dirname, 'public')));

// ==========================================
// ROUTES (via Router for Subdirectory Support)
// ==========================================
const apiRouter = express.Router();

/**
 * GET /stream
 * Securely pipes the audio file.
 */
/**
 * GET /stream
 * Live Radio Stream
 * Pipes audio starting from the current server time, looping infinitely.
 */
apiRouter.get('/stream', (req, res) => {
    const filePath = path.join(__dirname, 'server/assets/master.mp3');

    // Ensure file exists
    if (!fs.existsSync(filePath)) return res.status(404).end();

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const durationMs = TOTAL_AUDIO_DURATION_MS; // 3600000 ms

    // Calculate where we are in the "Broadcast"
    const uptime = Date.now() - SERVER_START_TIME;
    const currentOffsetMs = uptime % durationMs;
    const startByte = Math.floor((currentOffsetMs / durationMs) * fileSize);

    // Set headers for continuous stream
    // Set headers (Node handles chunking automatically when piping)
    res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
    });

    console.log(`[Stream] Connection: ${currentOffsetMs}ms / ${durationMs}ms`);
    console.log(`[Stream] Byte Offset: ${startByte} / ${fileSize}`);

    if (isNaN(startByte) || startByte >= fileSize) {
        console.error("[Stream] Invalid byte offset calculated.");
        return res.end();
    }

    // Recursive function to handle looping
    let currentStream;

    const playLoop = (offset) => {
        currentStream = fs.createReadStream(filePath, { start: offset });

        // Pipe to response, but don't end response when file ends (end: false)
        currentStream.pipe(res, { end: false });

        currentStream.on('end', () => {
            // File ended, loop back to start
            playLoop(0);
        });

        currentStream.on('error', (err) => {
            console.error('[Stream] Error:', err);
            res.end();
        });
    };

    // Handle client disconnect
    res.on('close', () => {
        if (currentStream) currentStream.destroy();
    });

    // Start playing from calculated offset
    playLoop(startByte);
});

/**
 * GET /cover
 * Serves the album art.
 */
apiRouter.get('/cover', (req, res) => {
    res.sendFile(path.join(__dirname, 'server/assets/The-Weeknd-Dawn-FM.jpeg'));
});

/**
 * GET /sync
 * Smart Sync: Returns current track and when to check back.
 */
apiRouter.get('/sync', (req, res) => {
    const now = Date.now();
    const uptime = now - SERVER_START_TIME;
    const loopDuration = 3600000;
    const currentLoopPosition = uptime % loopDuration;

    // Find current track
    let currentTrackIndex = STATION_DATA.findLastIndex(t => t.triggerMs <= currentLoopPosition);
    if (currentTrackIndex === -1) currentTrackIndex = STATION_DATA.length - 1;

    const currentTrack = STATION_DATA[currentTrackIndex];
    const nextTrackIndex = (currentTrackIndex + 1) % STATION_DATA.length;
    const nextTrack = STATION_DATA[nextTrackIndex];

    let nextTriggerMs = nextTrack.triggerMs;
    // Handle wrap around case
    if (nextTrackIndex === 0) {
        nextTriggerMs = loopDuration;
    }

    const timeUntilNext = nextTriggerMs - currentLoopPosition;

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
        serverTime: now,
        currentOffset: currentLoopPosition,
        now_playing: currentTrack.meta,
        formatted_time: currentTrack.triggerAt,
        next_update_in: timeUntilNext
    });
});

// Mount Routes on both Root and Subdirectory
app.use('/dawn-fm', apiRouter);
app.use('/', apiRouter);

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`[Dawn FM] Frequency tuned to http://localhost:${PORT}`);
});
