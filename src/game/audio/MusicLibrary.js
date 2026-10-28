/**
 * 浏览器本地音乐库。
 *
 * 用户可以在设置里选择一首或多首本地音乐，文件会以 Blob 形式存进 IndexedDB，
 * 刷新页面后仍然存在。这样用户不需要把音乐放进项目目录，也不需要修改代码。
 *
 * 隐私模式/IndexedDB 被禁用时退化为内存音乐库：当前会话可用，刷新后丢失。
 */
const DB_NAME = 'arrowMazeAudio';
const STORE_NAME = 'tracks';
const DB_VERSION = 1;
const MAX_TRACKS = 20;
const MAX_FILE_SIZE = 30 * 1024 * 1024;

export class MusicLibrary {
  constructor() {
    this.db = null;
    this.memoryTracks = [];
    this.persistent = false;
  }

  async open() {
    if (this.db) return true;
    if (!('indexedDB' in window)) return false;

    try {
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      this.persistent = true;
      return true;
    } catch {
      this.db = null;
      this.persistent = false;
      return false;
    }
  }

  async addFiles(files) {
    await this.open();
    const audioFiles = [...files].filter(isAudioFile);
    const added = [];
    const rejected = [];
    let existingCount = await this.count();

    for (const file of audioFiles) {
      if (file.size > MAX_FILE_SIZE) {
        rejected.push({ name: file.name, reason: 'too-large' });
        continue;
      }
      if (existingCount >= MAX_TRACKS) {
        rejected.push({ name: file.name, reason: 'too-many' });
        continue;
      }

      const record = {
        id: createId(),
        name: file.name.replace(/\.[^.]+$/, '') || file.name,
        filename: file.name,
        type: file.type || 'audio/mpeg',
        size: file.size,
        addedAt: Date.now(),
        blob: file
      };

      try {
        if (this.db) await this.put(record);
        else this.memoryTracks.push(record);
      } catch {
        // 配额/隐私模式写入失败时，至少当前会话还能播放
        this.memoryTracks.push(record);
        this.persistent = false;
      }
      added.push(record);
      existingCount += 1;
    }

    return { added, rejected };
  }

  async getAll() {
    await this.open();
    if (!this.db) {
      return [...this.memoryTracks].sort((a, b) => a.addedAt - b.addedAt);
    }

    return new Promise((resolve) => {
      const transaction = this.db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        // 合并写入 IndexedDB 失败但当前会话可用的曲目
        const tracks = [...(request.result || []), ...this.memoryTracks];
        resolve(tracks.sort((a, b) => a.addedAt - b.addedAt));
      };
      request.onerror = () => resolve([...this.memoryTracks]);
    });
  }

  async remove(id) {
    await this.open();
    this.memoryTracks = this.memoryTracks.filter((track) => track.id !== id);
    if (!this.db) return;

    await new Promise((resolve) => {
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
  }

  async count() {
    if (!this.db) return this.memoryTracks.length;
    return new Promise((resolve) => {
      const transaction = this.db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).count();
      request.onsuccess = () =>
        resolve((request.result || 0) + this.memoryTracks.length);
      request.onerror = () => resolve(this.memoryTracks.length);
    });
  }

  put(record) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

function isAudioFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('audio/')) return true;
  return /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)$/i.test(file.name || '');
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `track-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
