/*
 * memory.js - Centralized Save Data System for Rabbitwine Apps
 *
 * Overview:
 * Unified, namespaced storage for all apps/features, with versioning and metadata. Supports storing objects, blobs, and files using localStorage. Each namespace is isolated and tracks its own version. Global metadata tracks last access/write times.
 *
 * Usage Examples:
 *   // Store and retrieve simple data
 *   memory.write('app', 'score', 42);
 *   const score = memory.read('app', 'score');
 *
 *   // Store and retrieve objects
 *   memory.write('editor', 'settings', {theme:'dark'});
 *   const settings = memory.read('editor', 'settings');
 *
 *   // Store and retrieve blobs/files
 *   await memory.writeBlob('gallery', 'img1', blob, 'pic.png');
 *   const imgBlob = memory.readBlob('gallery', 'img1', 'image/png');
 *
 *   // List keys and namespaces
 *   memory.keys('editor'); // ['settings', ...]
 *   memory.listNamespaces(); // ['app', 'editor', ...]
 *
 *   // Clear/reset
 *   memory.clearNamespace('editor');
 *   memory.resetAll();
 *
 *   // Metadata
 *   memory.updateMetadata();
 *   const meta = memory.getMetadata();
 */

const MEMORY_PREFIX = 'memjs_';
const META_NAMESPACE = '__meta__';

const memory = {
    // Helper to infer MIME type from file extension
    _inferMimeType(filename) {
        if (!filename) return 'application/octet-stream';
        const ext = filename.split('.').pop().toLowerCase();
        const mimeMap = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'bmp': 'image/bmp',
            'ico': 'image/x-icon',
            'pdf': 'application/pdf',
            'txt': 'text/plain',
            'json': 'application/json',
            'xml': 'application/xml',
            'html': 'text/html',
            'css': 'text/css',
            'js': 'application/javascript',
            'mp3': 'audio/mpeg',
            'mp4': 'video/mp4',
            'avi': 'video/x-msvideo',
            'mov': 'video/quicktime',
            'wav': 'audio/wav',
            'zip': 'application/zip',
            'rar': 'application/x-rar-compressed',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };
        return mimeMap[ext] || 'application/octet-stream';
    },

    // Write a Blob (any file/data) to a namespace (base64-encoded)
    async writeBlob(namespace, key, blob, filename) {
        // Convert Blob to base64 string
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        this.write(namespace, key, base64);
        // Store file metadata (filename and size)
        this.write(namespace, key + '_filemeta', {
            name: filename || (blob.name || 'unnamed'),
            size: blob.size
        });
    },

    // Read a Blob from a namespace (returns Blob or undefined)
    readBlob(namespace, key, mimeType = 'application/octet-stream') {
        const base64 = this.read(namespace, key);
        if (!base64) return undefined;
        // Convert base64 string back to Blob
        const byteString = atob(base64);
        const byteArray = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
            byteArray[i] = byteString.charCodeAt(i);
        }
        return new Blob([byteArray], { type: mimeType });
    },
    // Read a value from a namespace (returns undefined if not found)
    read(namespace, key) {
        const ns = this._getNamespace(namespace);
        return ns && key in ns.data ? ns.data[key] : undefined;
    },

    // Write a value to a namespace (increments version, updates metadata)
    write(namespace, key, value) {
        const ns = this._getNamespace(namespace, true);
        ns.data[key] = value;
        ns.version = (ns.version || 0) + 1;
        this._saveNamespace(namespace, ns);
        this.updateMetadata(true); // Mark as write operation
    },

    // Remove a key from a namespace (increments version)
    remove(namespace, key) {
        const ns = this._getNamespace(namespace);
        if (ns && key in ns.data) {
            delete ns.data[key];
            ns.version = (ns.version || 0) + 1;
            this._saveNamespace(namespace, ns);
            this.updateMetadata(true); // Mark as write operation
        }
    },

    // Get the current version number for a namespace
    getVersion(namespace) {
        const ns = this._getNamespace(namespace);
        return ns ? ns.version || 0 : 0;
    },

    // Clear all data in a namespace (resets version)
    clearNamespace(namespace) {
        this._saveNamespace(namespace, {version: 0, data: {}});
        this.updateMetadata(true); // Mark as write operation
    },

    // Reset all memory (all namespaces, including metadata)
    resetAll() {
        for (let k in localStorage) {
            if (k.startsWith(MEMORY_PREFIX)) localStorage.removeItem(k);
        }
    },

    // Get all keys in a namespace
    keys(namespace) {
        const ns = this._getNamespace(namespace);
        return ns ? Object.keys(ns.data) : [];
    },

    // Get all namespaces currently in use
    listNamespaces() {
        const out = [];
        for (let k in localStorage) {
            if (k.startsWith(MEMORY_PREFIX) && k !== MEMORY_PREFIX + META_NAMESPACE) {
                out.push(k.slice(MEMORY_PREFIX.length));
            }
        }
        return out;
    },

    // --- Metadata ---
    updateMetadata(isWrite = false) {
        const now = Date.now();
        let meta = this._getNamespace(META_NAMESPACE, true);
        // Update lastAccess for all operations
        meta.lastAccess = now;
        // Update lastWrite only for write operations
        if (isWrite) {
            meta.lastWrite = now;
        }
        this._saveNamespace(META_NAMESPACE, meta);
    },

    getMetadata() {
        return this._getNamespace(META_NAMESPACE) || {};
    },

    // Export all memory data as a blob for download
    exportBlob() {
        const exportData = {};
        for (let k in localStorage) {
            if (k.startsWith(MEMORY_PREFIX)) {
                const namespace = k.slice(MEMORY_PREFIX.length);
                try {
                    exportData[namespace] = JSON.parse(localStorage.getItem(k));
                } catch (e) {
                    exportData[namespace] = localStorage.getItem(k);
                }
            }
        }
        const jsonString = JSON.stringify(exportData, null, 2);
        return new Blob([jsonString], { type: 'application/json' });
    },

    // --- Internal helpers ---
    _getNamespace(namespace, createIfMissing = false) {
        let raw = localStorage.getItem(MEMORY_PREFIX + namespace);
        let ns;
        try {
            ns = raw ? JSON.parse(raw) : null;
        } catch { ns = null; }
        if (!ns && createIfMissing) {
            ns = {version: 0, data: {}};
        }
        return ns;
    },
    _saveNamespace(namespace, ns) {
        localStorage.setItem(MEMORY_PREFIX + namespace, JSON.stringify(ns));
    }
};

// Export for global use
window.memory = memory;

// Patch for memory.read and memory.write to update metadata
if (typeof memory === 'object') {
  // Patch read
  const origRead = memory.read;
  memory.read = function(ns, key) {
    const result = origRead.apply(this, arguments);
    this.updateMetadata(false); // Update lastAccess only
    return result;
  };

  // Patch write
  const origWrite = memory.write;
  memory.write = function(ns, key, value) {
    const result = origWrite.apply(this, arguments);
    // No need to call updateMetadata here since write() already calls it with isWrite=true
    return result;
  };

  // Patch writeBlob to update metadata
  const origWriteBlob = memory.writeBlob;
  memory.writeBlob = async function(ns, key, blob) {
    await origWriteBlob.apply(this, arguments);
    // writeBlob calls write, which already updates metadata
  };

  // Patch readBlob to update metadata
  const origReadBlob = memory.readBlob;
  memory.readBlob = function(ns, key, mimeType) {
    const result = origReadBlob.apply(this, arguments);
    this.updateMetadata(false); // Update lastAccess only
    return result;
  };
}
