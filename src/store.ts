// One place to read and write saved progress. Today it is the browser's own storage;
// keeping it in one file means a sign-in that syncs online can slot in here later.
export const store = {
  getItem(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  removeItem(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};
