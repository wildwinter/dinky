import { dinkyDialogueRule, dinkyDialogueGatherRule, dinkyDialogueBracketedRule } from './tokenizer-rules';

// Dialogue line regexes
const dialogueRegex = dinkyDialogueRule[0];
const dialogueGatherRegex = dinkyDialogueGatherRule[0];
const dialogueBracketedRegex = dinkyDialogueBracketedRule[0];

// DOM elements
let recordScratchBtn;
let recordingOverlay;
let statusBar;

// State
let scratchAudioEnabled = false;
let scratchAudioFolder = '';
let scratchAudioFormat = 'wav';
let isRecording = false;
let recordingDecorationIds = [];

// Dependencies injected via init()
let editor;
let monaco;
let idManager;
let projectCharacters;
let isDinkyAtPosition;
let updateTestAudioButton;
let playTestAudio;

/**
 * Initialise the scratch recorder module.
 * @param {object} deps - External dependencies from renderer.js
 */
export function initScratchRecorder(deps) {
    editor = deps.editor;
    monaco = deps.monaco;
    idManager = deps.idManager;
    projectCharacters = deps.projectCharacters;
    isDinkyAtPosition = deps.isDinkyAtPosition;
    updateTestAudioButton = deps.updateTestAudioButton;
    playTestAudio = deps.playTestAudio;

    recordScratchBtn = document.getElementById('btn-record-scratch');
    recordingOverlay = document.getElementById('recording-overlay');
    statusBar = document.getElementById('status-bar');

    if (recordScratchBtn) {
        recordScratchBtn.addEventListener('click', startRecordingScratch);
    }

    // Reload scratch audio config whenever project settings change
    window.electronAPI.onProjectConfigUpdated(async () => {
        await loadScratchAudioConfig();
        updateRecordScratchButton();
    });
}

/**
 * Load scratch audio settings from project config.
 * Called from renderer.js during checkSyntax / project load.
 */
export async function loadScratchAudioConfig() {
    try {
        const config = await window.electronAPI.getProjectConfig();
        scratchAudioEnabled = !!(config && config.dinky && config.dinky.scratchAudioEnabled);
        scratchAudioFolder = (config && config.dinky && config.dinky.scratchAudioFolder) || '';
        scratchAudioFormat = (config && config.dinky && config.dinky.scratchAudioFormat) || 'wav';
    } catch (e) {
        scratchAudioEnabled = false;
        scratchAudioFolder = '';
        scratchAudioFormat = 'wav';
    }
}

/**
 * Update the record button enabled state based on cursor position.
 * Called from the cursor-position-change handler in renderer.js.
 */
export function updateRecordScratchButton() {
    if (!recordScratchBtn || isRecording) return;

    if (!scratchAudioEnabled || !scratchAudioFolder) {
        setRecordScratchEnabled(false);
        return;
    }

    const position = editor.getPosition();
    const model = editor.getModel();
    if (!position || !model) {
        setRecordScratchEnabled(false);
        return;
    }

    const lineId = idManager.getIdForLine(position.lineNumber);
    if (!lineId) {
        setRecordScratchEnabled(false);
        return;
    }

    if (!isDinkyAtPosition(model, position)) {
        setRecordScratchEnabled(false);
        return;
    }

    const lineContent = model.getLineContent(position.lineNumber);
    if (!isDinkDialogueLine(lineContent)) {
        setRecordScratchEnabled(false);
        return;
    }

    setRecordScratchEnabled(true);
}

// ---------------------------------------------------------------------------
// Hash generation (FNV-1a, matching dink compiler)
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32-bit hash, returning a 6-character base64 string.
 * Matches GenerateHashFromText in dink/csharp/DinkCompiler/GoogleTTS.cs
 */
export function generateHashFromText(input) {
    if (!input) return '000000';
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619); // FNV prime
    }
    // Convert to 4 bytes (little-endian, matching C# BitConverter)
    const bytes = new Uint8Array(4);
    bytes[0] = hash & 0xFF;
    bytes[1] = (hash >>> 8) & 0xFF;
    bytes[2] = (hash >>> 16) & 0xFF;
    bytes[3] = (hash >>> 24) & 0xFF;
    // Base64 encode, take first 6 characters
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.substring(0, Math.min(6, base64.length));
}

/**
 * Extract just the text element from a Dink dialogue line.
 * Excludes character name, qualifier, direction, tags, and comments.
 */
export function extractDialogueText(lineContent) {
    let match = lineContent.match(dialogueRegex);
    if (match) return (match[10] || '').trim();

    match = lineContent.match(dialogueGatherRegex);
    if (match) return (match[12] || '').trim();

    match = lineContent.match(dialogueBracketedRegex);
    if (match) return (match[14] || '').trim();

    return '';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isDinkDialogueLine(lineContent) {
    const match = lineContent.match(dialogueRegex) ||
                  lineContent.match(dialogueGatherRegex) ||
                  lineContent.match(dialogueBracketedRegex);
    if (!match) return false;

    let charName = null;
    if (lineContent.match(dialogueRegex)) {
        charName = match[2];
    } else if (lineContent.match(dialogueGatherRegex)) {
        charName = match[4];
    } else if (lineContent.match(dialogueBracketedRegex)) {
        charName = match[6];
    }

    if (!charName) return false;

    const chars = projectCharacters();
    if (chars.length > 0) {
        return chars.some(c => c.ID === charName);
    }
    return true;
}

function setRecordScratchEnabled(enabled) {
    if (!recordScratchBtn) return;
    if (enabled) {
        recordScratchBtn.style.opacity = '1';
        recordScratchBtn.style.pointerEvents = 'auto';
        recordScratchBtn.style.filter = '';
    } else {
        recordScratchBtn.style.opacity = '0.5';
        recordScratchBtn.style.pointerEvents = 'none';
        recordScratchBtn.style.filter = 'grayscale(1)';
    }
}

function playBeep(frequency, durationMs) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.3;
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + durationMs / 1000);
    setTimeout(() => audioCtx.close(), durationMs + 100);
}

// ---------------------------------------------------------------------------
// Audio encoding
// ---------------------------------------------------------------------------

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function encodeWav(audioBuffer, hashCode) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
        channels.push(audioBuffer.getChannelData(i));
    }

    const threshold = 0.01;
    let totalSamples = channels[0].length;
    let startSample = 0;
    let endSample = totalSamples - 1;

    for (let i = 0; i < totalSamples; i++) {
        let maxAmp = 0;
        for (let ch = 0; ch < numChannels; ch++) {
            maxAmp = Math.max(maxAmp, Math.abs(channels[ch][i]));
        }
        if (maxAmp > threshold) {
            startSample = Math.max(0, i - Math.floor(sampleRate * 0.05));
            break;
        }
    }

    for (let i = totalSamples - 1; i >= startSample; i--) {
        let maxAmp = 0;
        for (let ch = 0; ch < numChannels; ch++) {
            maxAmp = Math.max(maxAmp, Math.abs(channels[ch][i]));
        }
        if (maxAmp > threshold) {
            endSample = Math.min(totalSamples - 1, i + Math.floor(sampleRate * 0.05));
            break;
        }
    }

    const trimmedLength = endSample - startSample + 1;
    const dataLength = trimmedLength * numChannels * (bitsPerSample / 8);

    // Build the LIST/INFO/DINK chunk for the hash (matching dink compiler format)
    const hashBytes = new TextEncoder().encode(hashCode || '');
    const needsPadding = hashBytes.length % 2 !== 0;
    const dinkChunkSize = 4 + 4 + hashBytes.length + (needsPadding ? 1 : 0); // DINK + size + data + pad
    const listChunkSize = 4 + dinkChunkSize; // INFO + DINK chunk
    const listTotalSize = 8 + listChunkSize; // LIST + size + content

    const buffer = new ArrayBuffer(44 + dataLength + listTotalSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength + listTotalSize, true); // Updated RIFF size
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = startSample; i <= endSample; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch][i]));
            const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, int16, true);
            offset += 2;
        }
    }

    // Append LIST/INFO/DINK chunk
    writeString(view, offset, 'LIST'); offset += 4;
    view.setUint32(offset, listChunkSize, true); offset += 4;
    writeString(view, offset, 'INFO'); offset += 4;
    writeString(view, offset, 'DINK'); offset += 4;
    view.setUint32(offset, hashBytes.length, true); offset += 4;
    for (let i = 0; i < hashBytes.length; i++) {
        view.setUint8(offset + i, hashBytes[i]);
    }
    offset += hashBytes.length;
    if (needsPadding) {
        view.setUint8(offset, 0);
    }

    return buffer;
}

async function encodeOgg(audioBuffer, hashCode) {
    const trimmed = trimAudioBuffer(audioBuffer);
    const offline = new OfflineAudioContext(trimmed.numberOfChannels, trimmed.length, trimmed.sampleRate);
    const source = offline.createBufferSource();
    source.buffer = trimmed;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    const ctx = new AudioContext({ sampleRate: rendered.sampleRate });
    const dest = ctx.createMediaStreamDestination();
    const bufSrc = ctx.createBufferSource();
    bufSrc.buffer = rendered;
    bufSrc.connect(dest);

    const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus';
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    const chunks = [];

    const done = new Promise((resolve) => {
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => resolve();
    });

    recorder.start();
    bufSrc.start();

    bufSrc.onended = () => {
        recorder.stop();
    };

    await done;
    await ctx.close();

    const blob = new Blob(chunks, { type: mimeType });
    const oggBuffer = await blob.arrayBuffer();

    // Append DINK hash trailer: "DINK" + uint32LE length + hash bytes
    const hashBytes = new TextEncoder().encode(hashCode || '');
    const trailer = new ArrayBuffer(8 + hashBytes.length);
    const tv = new DataView(trailer);
    tv.setUint8(0, 0x44); // D
    tv.setUint8(1, 0x49); // I
    tv.setUint8(2, 0x4E); // N
    tv.setUint8(3, 0x4B); // K
    tv.setUint32(4, hashBytes.length, true);
    for (let i = 0; i < hashBytes.length; i++) {
        tv.setUint8(8 + i, hashBytes[i]);
    }

    // Concatenate OGG data + trailer
    const combined = new Uint8Array(oggBuffer.byteLength + trailer.byteLength);
    combined.set(new Uint8Array(oggBuffer), 0);
    combined.set(new Uint8Array(trailer), oggBuffer.byteLength);
    return combined.buffer;
}

function trimAudioBuffer(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const threshold = 0.01;
    const totalSamples = audioBuffer.length;

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
        channels.push(audioBuffer.getChannelData(i));
    }

    let startSample = 0;
    let endSample = totalSamples - 1;

    for (let i = 0; i < totalSamples; i++) {
        let maxAmp = 0;
        for (let ch = 0; ch < numChannels; ch++) {
            maxAmp = Math.max(maxAmp, Math.abs(channels[ch][i]));
        }
        if (maxAmp > threshold) {
            startSample = Math.max(0, i - Math.floor(sampleRate * 0.05));
            break;
        }
    }

    for (let i = totalSamples - 1; i >= startSample; i--) {
        let maxAmp = 0;
        for (let ch = 0; ch < numChannels; ch++) {
            maxAmp = Math.max(maxAmp, Math.abs(channels[ch][i]));
        }
        if (maxAmp > threshold) {
            endSample = Math.min(totalSamples - 1, i + Math.floor(sampleRate * 0.05));
            break;
        }
    }

    const trimmedLength = endSample - startSample + 1;
    const ctx = new OfflineAudioContext(numChannels, trimmedLength, sampleRate);
    const trimmedBuffer = ctx.createBuffer(numChannels, trimmedLength, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
        const srcData = audioBuffer.getChannelData(ch);
        const dstData = trimmedBuffer.getChannelData(ch);
        for (let i = 0; i < trimmedLength; i++) {
            dstData[i] = srcData[startSample + i];
        }
    }
    return trimmedBuffer;
}

async function encodeAudio(audioBuffer, format, hashCode) {
    switch (format) {
        case 'ogg':
            return await encodeOgg(audioBuffer, hashCode);
        case 'wav':
        default:
            return encodeWav(audioBuffer, hashCode);
    }
}

// ---------------------------------------------------------------------------
// Main recording flow
// ---------------------------------------------------------------------------

async function startRecordingScratch() {
    if (isRecording) return;

    const position = editor.getPosition();
    const model = editor.getModel();
    if (!position || !model) return;

    const lineId = idManager.getIdForLine(position.lineNumber);
    if (!lineId) return;

    const lineNumber = position.lineNumber;
    isRecording = true;

    // Show overlay to block all clicks
    if (recordingOverlay) recordingOverlay.style.display = 'block';

    // Highlight the line being recorded (gold background)
    recordingDecorationIds = editor.deltaDecorations([], [{
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
            isWholeLine: true,
            className: 'recording-line-highlight',
            inlineClassName: undefined
        }
    }]);

    // Make editor read-only during recording
    editor.updateOptions({ readOnly: true });

    // Disable menus via IPC
    window.electronAPI.setRecordingMode(true);

    // Disable record button during recording
    setRecordScratchEnabled(false);

    // Block all keys except ESC and SPACE
    const keyBlocker = (e) => {
        if (e.key !== 'Escape' && e.key !== ' ') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    };
    document.addEventListener('keydown', keyBlocker, true);

    // Save original status bar class
    const originalStatusBarClass = statusBar ? statusBar.className : '';

    function cleanup() {
        isRecording = false;

        if (recordingOverlay) recordingOverlay.style.display = 'none';

        if (recordingDecorationIds.length > 0) {
            editor.deltaDecorations(recordingDecorationIds, []);
            recordingDecorationIds = [];
        }

        editor.updateOptions({ readOnly: false });

        window.electronAPI.setRecordingMode(false);

        document.removeEventListener('keydown', keyBlocker, true);

        if (statusBar) {
            statusBar.className = originalStatusBarClass;
            statusBar.textContent = '';
            // Re-append the audio hint span (it was removed when textContent was set during recording)
            const hintSpan = document.getElementById('status-bar-audio-hint');
            if (!hintSpan) {
                // Recreate the hint span if it was destroyed
                const span = document.createElement('span');
                span.id = 'status-bar-audio-hint';
                statusBar.appendChild(span);
            } else if (!statusBar.contains(hintSpan)) {
                statusBar.appendChild(hintSpan);
            }
        }

        updateTestAudioButton();
        updateRecordScratchButton();
    }

    // --- Acquire microphone before countdown so there's no delay after "1" ---
    let mediaStream;
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        console.error('Failed to get microphone access:', err);
        cleanup();
        return;
    }

    // --- Countdown Phase ---
    let cancelled = false;

    const waitForCountdown = (text) => {
        return new Promise((resolve) => {
            if (statusBar) {
                statusBar.className = 'recording-countdown';
                statusBar.id = 'status-bar';
                statusBar.textContent = text;
            }
            playBeep(880, 100);

            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelled = true;
                    document.removeEventListener('keydown', onKey, true);
                    resolve();
                }
            };
            document.addEventListener('keydown', onKey, true);

            setTimeout(() => {
                document.removeEventListener('keydown', onKey, true);
                resolve();
            }, 1000);
        });
    };

    for (const num of ['3', '2', '1']) {
        if (cancelled) {
            mediaStream.getTracks().forEach(t => t.stop());
            cleanup();
            return;
        }
        await waitForCountdown(num);
    }

    if (cancelled) {
        mediaStream.getTracks().forEach(t => t.stop());
        cleanup();
        return;
    }

    // --- Recording Phase ---
    let mediaRecorder;
    let audioChunks = [];

    if (statusBar) {
        statusBar.className = 'recording-active';
        statusBar.id = 'status-bar';
        statusBar.textContent = 'RECORDING \u2014 ESC cancel, SPACE complete';
    }

    playBeep(440, 200);

    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start();

    const result = await new Promise((resolve) => {
        const onKey = (e) => {
            if (e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                document.removeEventListener('keydown', onKey, true);
                resolve('complete');
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                document.removeEventListener('keydown', onKey, true);
                resolve('cancel');
            }
        };
        document.addEventListener('keydown', onKey, true);
    });

    const recordingDone = new Promise((resolve) => {
        mediaRecorder.onstop = () => resolve();
    });
    mediaRecorder.stop();
    await recordingDone;

    mediaStream.getTracks().forEach(t => t.stop());

    if (result === 'complete' && audioChunks.length > 0) {
        try {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            audioCtx.close();

            // Compute hash from the dialogue text of the current line
            const lineContent = model.getLineContent(lineNumber);
            const dialogueText = extractDialogueText(lineContent);
            const hashCode = generateHashFromText(dialogueText);

            const encodedBuffer = await encodeAudio(audioBuffer, scratchAudioFormat, hashCode);

            const saveResult = await window.electronAPI.saveScratchAudio(lineId, encodedBuffer, scratchAudioFolder, scratchAudioFormat);
            if (saveResult && saveResult.success) {
                // Restore UI, refresh audio button to pick up the new file, then play it
                cleanup();
                await updateTestAudioButton();
                playTestAudio();
                return;
            } else {
                console.error('Failed to save scratch audio:', saveResult?.error);
            }
        } catch (err) {
            console.error('Failed to encode/save audio:', err);
        }
    }

    cleanup();
}
