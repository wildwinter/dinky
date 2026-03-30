import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { getCurrentProject } from './project-manager'
import { vcWriteBinary } from './vc'

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];

const MIME_TYPES = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
};

/**
 * Search a directory (non-recursively) for a file starting with the given lineId
 * and having one of the supported audio extensions.
 * Returns the full path if found, null otherwise.
 */
async function findAudioInFolder(folderPath, lineId) {
    try {
        const entries = await fs.readdir(folderPath);
        for (const entry of entries) {
            const ext = path.extname(entry).toLowerCase();
            if (!AUDIO_EXTENSIONS.includes(ext)) continue;
            const baseName = path.basename(entry, ext);
            if (baseName === lineId || baseName.startsWith(lineId + '_') || baseName.startsWith(lineId + '-') || baseName.startsWith(lineId + '.')) {
                // Check it starts with lineId as a complete prefix
                return path.join(folderPath, entry);
            }
        }
    } catch {
        // Folder doesn't exist or can't be read
    }
    return null;
}

/**
 * Search for an audio file matching the given line ID across all audio status folders,
 * checking them in order. Returns the absolute file path if found, null otherwise.
 */
ipcMain.handle('find-audio-file', async (event, lineId) => {
    const project = getCurrentProject();
    if (!project || !lineId) return null;

    const projectDir = path.dirname(project.path);
    const audioStatuses = project.content?.audioStatus || [];

    for (const status of audioStatuses) {
        if (!status.folder) continue;
        const folderPath = path.resolve(projectDir, status.folder);
        const result = await findAudioInFolder(folderPath, lineId);
        if (result) return {
            path: result,
            status: status.status || '',
            color: status.color || null
        };
    }

    return null;
});

/**
 * Bulk lookup audio status for an array of line IDs.
 * Returns { [lineId]: { status, color, path } } for IDs that have audio.
 * IDs without audio are omitted from the result.
 */
ipcMain.handle('get-bulk-audio-status', async (event, lineIds) => {
    const project = getCurrentProject();
    if (!project || !lineIds || !lineIds.length) return {};

    const projectDir = path.dirname(project.path);
    const audioStatuses = project.content?.audioStatus || [];
    const result = {};

    // For each audio status folder, list all files once, then match against requested IDs
    for (const status of audioStatuses) {
        if (!status.folder) continue;
        const folderPath = path.resolve(projectDir, status.folder);
        const filesInFolder = await listLineIdsInFolder(folderPath);

        for (const lineId of lineIds) {
            if (result[lineId]) continue; // Already found in a higher-priority folder
            if (filesInFolder[lineId]) {
                result[lineId] = {
                    status: status.status || '',
                    color: status.color || null,
                    path: filesInFolder[lineId]
                };
            }
        }
    }

    return result;
});

/**
 * Read an audio file and return its data as a base64 data URL.
 */
ipcMain.handle('read-audio-file', async (event, filePath) => {
    if (!filePath) return null;
    try {
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'audio/mpeg';
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString('base64');
        return `data:${mimeType};base64,${base64}`;
    } catch {
        return null;
    }
});

/**
 * Read the DINK hash from a WAV or OGG file without loading audio data.
 * WAV: scans RIFF chunks for LIST/INFO/DINK.
 * OGG: checks for trailing DINK marker.
 */
ipcMain.handle('read-audio-hash', async (event, filePath) => {
    if (!filePath) return null;
    try {
        const ext = path.extname(filePath).toLowerCase();
        const fd = await fs.open(filePath, 'r');
        try {
            if (ext === '.wav') {
                return await readHashFromWav(fd);
            } else if (ext === '.ogg') {
                return await readHashFromOgg(fd);
            }
        } finally {
            await fd.close();
        }
    } catch {
        // File doesn't exist or can't be read
    }
    return null;
});

async function readHashFromWav(fd) {
    // Read RIFF header (12 bytes)
    const header = Buffer.alloc(12);
    await fd.read(header, 0, 12, 0);
    if (header.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (header.toString('ascii', 8, 12) !== 'WAVE') return null;

    let pos = 12;
    const stat = await fd.stat();
    const fileSize = stat.size;
    const chunkHeader = Buffer.alloc(8);

    while (pos < fileSize) {
        const bytesRead = await fd.read(chunkHeader, 0, 8, pos);
        if (bytesRead.bytesRead < 8) break;

        const chunkId = chunkHeader.toString('ascii', 0, 4);
        const chunkSize = chunkHeader.readUInt32LE(4);
        pos += 8;

        if (chunkId === 'LIST') {
            // Read list type (4 bytes)
            const listType = Buffer.alloc(4);
            await fd.read(listType, 0, 4, pos);
            if (listType.toString('ascii') === 'INFO') {
                let subPos = pos + 4;
                const listEnd = pos + chunkSize;
                while (subPos < listEnd) {
                    const subHeader = Buffer.alloc(8);
                    const sr = await fd.read(subHeader, 0, 8, subPos);
                    if (sr.bytesRead < 8) break;
                    const subId = subHeader.toString('ascii', 0, 4);
                    const subSize = subHeader.readUInt32LE(4);
                    subPos += 8;
                    if (subId === 'DINK') {
                        const data = Buffer.alloc(subSize);
                        await fd.read(data, 0, subSize, subPos);
                        return data.toString('utf8').replace(/\0+$/, '');
                    }
                    // Skip, respecting word alignment
                    subPos += subSize + (subSize % 2 !== 0 ? 1 : 0);
                }
            }
        }
        // Skip chunk, respecting word alignment
        pos += chunkSize + (chunkSize % 2 !== 0 ? 1 : 0);
    }
    return null;
}

async function readHashFromOgg(fd) {
    // Check for trailing DINK marker: "DINK" + uint32LE size + hash bytes
    const stat = await fd.stat();
    const fileSize = stat.size;
    if (fileSize < 12) return null;

    // Read the last 64 bytes (hash is short, this is more than enough)
    const tailSize = Math.min(64, fileSize);
    const tail = Buffer.alloc(tailSize);
    await fd.read(tail, 0, tailSize, fileSize - tailSize);

    // Scan backwards for "DINK" marker
    for (let i = tailSize - 9; i >= 0; i--) {
        if (tail[i] === 0x44 && tail[i+1] === 0x49 && tail[i+2] === 0x4E && tail[i+3] === 0x4B) {
            const hashLen = tail.readUInt32LE(i + 4);
            if (i + 8 + hashLen <= tailSize) {
                return tail.toString('utf8', i + 8, i + 8 + hashLen);
            }
        }
    }
    return null;
}

/**
 * Lightweight helper: list all lineIds (from filenames) in a given audio folder.
 */
async function listLineIdsInFolder(folderPath) {
    const result = {};
    try {
        const entries = await fs.readdir(folderPath);
        for (const entry of entries) {
            const ext = path.extname(entry).toLowerCase();
            if (!AUDIO_EXTENSIONS.includes(ext)) continue;
            const lineId = path.basename(entry, ext);
            result[lineId] = path.join(folderPath, entry);
        }
    } catch {
        // Folder doesn't exist
    }
    return result;
}

/**
 * Get navigation context for scratch audio prev/next.
 * Returns { scratchFiles: { lineId: filePath }, betterAudioLineIds: string[] }
 * All via lightweight directory listings — no file content reading.
 */
ipcMain.handle('get-scratch-nav-context', async (event, scratchFolder) => {
    const project = getCurrentProject();
    if (!project || !scratchFolder) return { scratchFiles: {}, betterAudioLineIds: [] };

    const projectDir = path.dirname(project.path);
    const audioStatuses = project.content?.audioStatus || [];
    const scratchFolderResolved = path.resolve(projectDir, scratchFolder);

    const betterAudioLineIds = new Set();
    let scratchFiles = {};

    for (const status of audioStatuses) {
        if (!status.folder) continue;
        const folderPath = path.resolve(projectDir, status.folder);

        if (folderPath === scratchFolderResolved) {
            scratchFiles = await listLineIdsInFolder(folderPath);
            break; // Don't scan folders after scratch
        }

        // Folder before scratch — collect lineIds that have better audio
        const lineIds = await listLineIdsInFolder(folderPath);
        for (const lineId of Object.keys(lineIds)) {
            betterAudioLineIds.add(lineId);
        }
    }

    return { scratchFiles, betterAudioLineIds: [...betterAudioLineIds] };
});

/**
 * Check scratch audio status for a line.
 * Returns whether better audio exists (in a folder before scratchFolder),
 * and if not, whether scratch audio exists and its path.
 */
ipcMain.handle('find-scratch-audio-status', async (event, lineId, scratchFolder) => {
    const project = getCurrentProject();
    if (!project || !lineId || !scratchFolder) return { hasBetterAudio: false, scratchFile: null };

    const projectDir = path.dirname(project.path);
    const audioStatuses = project.content?.audioStatus || [];
    const scratchFolderResolved = path.resolve(projectDir, scratchFolder);

    for (const status of audioStatuses) {
        if (!status.folder) continue;
        const folderPath = path.resolve(projectDir, status.folder);
        const result = await findAudioInFolder(folderPath, lineId);

        if (folderPath === scratchFolderResolved) {
            // This is the scratch folder — return what we found (or null)
            return { hasBetterAudio: false, scratchFile: result };
        }

        if (result) {
            // Found audio in a folder before the scratch folder
            return { hasBetterAudio: true, scratchFile: null };
        }
    }

    return { hasBetterAudio: false, scratchFile: null };
});

/**
 * Update the DINK hash embedded in a WAV or OGG audio file.
 */
ipcMain.handle('update-audio-hash', async (event, filePath, newHash) => {
    if (!filePath || !newHash) return { success: false, error: 'Missing parameters' };
    try {
        const ext = path.extname(filePath).toLowerCase();
        const fileData = await fs.readFile(filePath);

        let updatedData;
        if (ext === '.wav') {
            updatedData = updateWavHash(fileData, newHash);
        } else if (ext === '.ogg') {
            updatedData = updateOggHash(fileData, newHash);
        } else {
            return { success: false, error: 'Unsupported format' };
        }

        if (!updatedData) return { success: false, error: 'Could not find DINK hash in file' };

        vcWriteBinary(filePath, updatedData);
        return { success: true };
    } catch (error) {
        console.error('Failed to update audio hash:', error);
        dialog.showErrorBox('Failed to update audio hash', error.message);
        return { success: false, error: error.message };
    }
});

function updateWavHash(fileData, newHash) {
    // Scan for LIST/INFO/DINK chunk and replace the hash
    if (fileData.length < 12) return null;
    if (fileData.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (fileData.toString('ascii', 8, 12) !== 'WAVE') return null;

    let pos = 12;
    while (pos < fileData.length - 8) {
        const chunkId = fileData.toString('ascii', pos, pos + 4);
        const chunkSize = fileData.readUInt32LE(pos + 4);
        const chunkStart = pos;
        pos += 8;

        if (chunkId === 'LIST' && pos + 4 <= fileData.length) {
            const listType = fileData.toString('ascii', pos, pos + 4);
            if (listType === 'INFO') {
                // Found LIST/INFO — rebuild everything before this chunk + new LIST/INFO/DINK + everything after
                const beforeList = fileData.subarray(0, chunkStart);
                const afterList = fileData.subarray(chunkStart + 8 + chunkSize + (chunkSize % 2 !== 0 ? 1 : 0));

                const hashBytes = Buffer.from(newHash, 'utf8');
                const needsPadding = hashBytes.length % 2 !== 0;
                const dinkChunkSize = 4 + 4 + hashBytes.length + (needsPadding ? 1 : 0);
                const listContentSize = 4 + dinkChunkSize; // INFO + DINK chunk
                const listTotal = 8 + listContentSize; // LIST + size + content

                const newList = Buffer.alloc(listTotal);
                let off = 0;
                newList.write('LIST', off); off += 4;
                newList.writeUInt32LE(listContentSize, off); off += 4;
                newList.write('INFO', off); off += 4;
                newList.write('DINK', off); off += 4;
                newList.writeUInt32LE(hashBytes.length, off); off += 4;
                hashBytes.copy(newList, off); off += hashBytes.length;
                if (needsPadding) { newList.writeUInt8(0, off); off += 1; }

                const result = Buffer.concat([beforeList, newList, afterList]);
                // Update RIFF size
                result.writeUInt32LE(result.length - 8, 4);
                return result;
            }
        }
        pos += chunkSize + (chunkSize % 2 !== 0 ? 1 : 0);
    }
    return null;
}

function updateOggHash(fileData, newHash) {
    // Find trailing DINK marker and replace
    const tailSize = Math.min(64, fileData.length);
    const tailStart = fileData.length - tailSize;

    for (let i = fileData.length - 9; i >= tailStart; i--) {
        if (fileData[i] === 0x44 && fileData[i+1] === 0x49 && fileData[i+2] === 0x4E && fileData[i+3] === 0x4B) {
            // Found DINK marker — everything before it is the OGG data
            const oggData = fileData.subarray(0, i);
            const hashBytes = Buffer.from(newHash, 'utf8');
            const trailer = Buffer.alloc(8 + hashBytes.length);
            trailer.write('DINK', 0);
            trailer.writeUInt32LE(hashBytes.length, 4);
            hashBytes.copy(trailer, 8);
            return Buffer.concat([oggData, trailer]);
        }
    }
    return null;
}

/**
 * Save scratch audio recording.
 * Receives the lineId, audio data as an ArrayBuffer, the relative folder path, and the format (wav/ogg/flac).
 */
ipcMain.handle('save-scratch-audio', async (event, lineId, audioArrayBuffer, folder, format) => {
    const project = getCurrentProject();
    if (!project || !lineId || !audioArrayBuffer || !folder) return { success: false, error: 'Missing parameters' };

    const ext = format || 'wav';

    try {
        const projectDir = path.dirname(project.path);
        const folderPath = path.resolve(projectDir, folder);

        // Ensure folder exists
        await fs.mkdir(folderPath, { recursive: true });

        const filePath = path.join(folderPath, `${lineId}.${ext}`);
        const buffer = Buffer.from(audioArrayBuffer);
        vcWriteBinary(filePath, buffer);

        return { success: true, path: filePath };
    } catch (error) {
        console.error('Failed to save scratch audio:', error);
        dialog.showErrorBox('Failed to save audio recording', error.message);
        return { success: false, error: error.message };
    }
});
