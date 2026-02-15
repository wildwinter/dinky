import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { getCurrentProject } from './project-manager'

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
