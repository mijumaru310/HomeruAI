const DATABASE_NAME = "homeruai-notebook";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspace";
const WORKSPACE_KEY = "current";

export interface StoredWorkspace<TSections> {
  schemaVersion: 1;
  savedAt: string;
  sections: TSections;
  activeSectionId: string;
  activePageId: string;
  selectedPreset: string;
  selectedModel?: "gemini"; // 古い保存データとの互換用。分析経路はGeminiのみ。
  praiseMode: "super_praise" | "support" | "challenge";
  pageTransforms: Record<string, { pan: { x: number; y: number }; zoom: number }>;
}

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("ノート保存領域を開けませんでした。"));
  });

export async function loadWorkspace<TSections>(): Promise<StoredWorkspace<TSections> | null> {
  if (typeof indexedDB === "undefined") return null;

  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(WORKSPACE_KEY);
      request.onsuccess = () => resolve((request.result as StoredWorkspace<TSections> | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("保存済みノートを読み込めませんでした。"));
    });
  } finally {
    database.close();
  }
}

export async function saveWorkspace<TSections>(workspace: StoredWorkspace<TSections>): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(workspace, WORKSPACE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("ノートを保存できませんでした。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("ノートの保存が中断されました。"));
    });
  } finally {
    database.close();
  }
}
