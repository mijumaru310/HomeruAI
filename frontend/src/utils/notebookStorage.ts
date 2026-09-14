const DATABASE_NAME = "homeruai-notebook";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspace";
const DEFAULT_WORKSPACE_KEY = "current";

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
  experimentProgress?: {
    step: number;
    finished: boolean;
    optionalChosen: boolean | null;
  };
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

export async function loadWorkspace<TSections>(workspaceKey = DEFAULT_WORKSPACE_KEY): Promise<StoredWorkspace<TSections> | null> {
  if (typeof indexedDB === "undefined") return null;

  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(workspaceKey);
      request.onsuccess = () => resolve((request.result as StoredWorkspace<TSections> | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("保存済みノートを読み込めませんでした。"));
    });
  } finally {
    database.close();
  }
}

export async function saveWorkspace<TSections>(workspace: StoredWorkspace<TSections>, workspaceKey = DEFAULT_WORKSPACE_KEY): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(workspace, workspaceKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("ノートを保存できませんでした。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("ノートの保存が中断されました。"));
    });
  } finally {
    database.close();
  }
}

export async function deleteWorkspace(workspaceKey: string): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("このブラウザでは保存領域を削除できません。");
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(workspaceKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("ノートを削除できませんでした。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("ノートの削除が中断されました。"));
    });
  } finally {
    database.close();
  }
}
