export type SavedStudioProject = {
  projectName: string;
  youtubeUrl: string;
  analysis: unknown;
  assets: string[];
  assetNames: string[];
  videoName: string;
  renderFormat: "16:9" | "9:16";
  savedAt: string;
};

const DB_NAME = "manhwa-recreator-studio";
const STORE_NAME = "projects";
const ACTIVE_PROJECT = "active";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Este navegador não oferece armazenamento local de projetos (IndexedDB)."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir o armazenamento de projetos."));
  });
}

export async function saveStudioProject(project: SavedStudioProject): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ ...project, savedAt: new Date().toISOString() }, ACTIVE_PROJECT);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Falha ao salvar projeto."));
    transaction.onabort = () => reject(transaction.error || new Error("Salvamento cancelado."));
  });
  db.close();
}

export async function loadStudioProject(): Promise<SavedStudioProject | null> {
  const db = await openDatabase();
  const project = await new Promise<SavedStudioProject | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(ACTIVE_PROJECT);
    request.onsuccess = () => resolve((request.result as SavedStudioProject | undefined) ?? null);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir projeto salvo."));
  });
  db.close();
  return project;
}
