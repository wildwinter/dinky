import { writeTextFile, writeBinaryFile, deleteFile as vcLibDeleteFile, renameFile as vcLibRenameFile } from '@wildwinter/simple-vc-lib';

/**
 * Write a text file via the VC library so that version control systems
 * (Perforce, Plastic SCM, SVN, Git) are informed of the change.
 * Throws an Error with a descriptive message on failure.
 *
 * @param {string} filePath
 * @param {string} content
 * @param {BufferEncoding} [encoding='utf-8']
 */
export function vcWriteText(filePath, content, encoding = 'utf-8') {
    const result = writeTextFile(filePath, content, encoding);
    if (!result.success) {
        throw new Error(`Could not write file "${filePath}":\n${result.message}`);
    }
}

/**
 * Write a binary file via the VC library.
 * Throws an Error with a descriptive message on failure.
 *
 * @param {string} filePath
 * @param {Buffer | Uint8Array} data
 */
export function vcWriteBinary(filePath, data) {
    const result = writeBinaryFile(filePath, data instanceof Buffer ? data : Buffer.from(data));
    if (!result.success) {
        throw new Error(`Could not write file "${filePath}":\n${result.message}`);
    }
}

/**
 * Delete a file via the VC library so that version control systems
 * are informed of the deletion.
 * Throws an Error with a descriptive message on failure.
 *
 * @param {string} filePath
 */
export function vcDelete(filePath) {
    const result = vcLibDeleteFile(filePath);
    if (!result.success) {
        throw new Error(`Could not delete file "${filePath}":\n${result.message}`);
    }
}

/**
 * Rename a file via the VC library so that version control systems
 * are informed of the move (e.g. git mv, p4 move, svn move).
 * Throws an Error with a descriptive message on failure.
 *
 * @param {string} oldPath
 * @param {string} newPath
 */
export function vcRename(oldPath, newPath) {
    const result = vcLibRenameFile(oldPath, newPath);
    if (!result.success) {
        throw new Error(`Could not rename "${oldPath}" to "${newPath}":\n${result.message}`);
    }
}
