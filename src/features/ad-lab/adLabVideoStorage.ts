const DATABASE_NAME = "rclipper-studio-lab";
const STORE_NAME = "publishing-videos";
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("เปิดพื้นที่จัดเก็บวิดีโอไม่สำเร็จ"));
  });
}

/** Keep the selected video blob locally; localStorage only holds its metadata. */
export async function saveAdLabPublishingVideo(key: string, video: File): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(video, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("บันทึกวิดีโอไม่สำเร็จ"));
      transaction.onabort = () => reject(transaction.error ?? new Error("การบันทึกวิดีโอถูกยกเลิก"));
    });
  } finally {
    database.close();
  }
}

/** The video kept for an auto-saved publishing plan, or null when it is gone. */
export async function loadAdLabPublishingVideo(key: string): Promise<File | null> {
  const database = await openDatabase();
  try {
    return await new Promise<File | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result instanceof Blob ? (request.result as File) : null);
      request.onerror = () => reject(request.error ?? new Error("อ่านวิดีโอไม่สำเร็จ"));
    });
  } finally {
    database.close();
  }
}

/** Remove a plan's video from this browser (no-op when it is not there). */
export async function deleteAdLabPublishingVideo(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("ลบวิดีโอไม่สำเร็จ"));
    });
  } finally {
    database.close();
  }
}
