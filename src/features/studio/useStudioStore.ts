"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  StudioStore,
} from "@/domain/models/Studio";

const STORAGE_KEY = "rclipper-studio-lab-v1";
export type StudioClientPersistence = "database" | "local" | "browser";
interface WorkspaceApiPayload {
  store: StudioStore | null;
  persistence: "postgresql" | "local";
  pendingSync: boolean;
}
export const EMPTY_STUDIO_STORE: StudioStore = {
  brands: [],
  drafts: [],
  results: [],
  publishingPlans: [],
  socialAccounts: [],
  selectedBrandId: "",
};

/**
 * A workspace saved before a slice existed comes back without it. Spreading the
 * empty store keeps every list defined so components can map over them safely.
 */
function normalizeStore(store: StudioStore | null): StudioStore | null {
  return store ? { ...EMPTY_STUDIO_STORE, ...store } : store;
}

let initialWorkspaceRequest: Promise<WorkspaceApiPayload> | null = null;

function loadInitialWorkspace() {
  if (!initialWorkspaceRequest) {
    const request = fetch("/api/studio/workspace")
      .then(async (response) => {
        if (!response.ok) throw new Error("Database unavailable");
        return response.json() as Promise<WorkspaceApiPayload>;
      })
      .catch((error) => {
        // A later mount must be able to try again after a genuine outage.
        initialWorkspaceRequest = null;
        throw error;
      });
    initialWorkspaceRequest = request;
    void request.then(() => {
      // Dedupe only concurrent development-mode mounts; later page visits
      // must fetch fresh data written by another Studio section or browser.
      if (initialWorkspaceRequest === request) initialWorkspaceRequest = null;
    }, () => undefined);
  }
  return initialWorkspaceRequest;
}

export function useStudioStore() {
  const [store, setStore] = useState<StudioStore>(EMPTY_STUDIO_STORE);
  const [ready, setReady] = useState(false);
  const [persistence, setPersistence] = useState<StudioClientPersistence>("browser");
  const [syncPending, setSyncPending] = useState(false);
  const storeRef = useRef<StudioStore>(EMPTY_STUDIO_STORE);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    let browserStore: StudioStore | null = null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) browserStore = { ...EMPTY_STUDIO_STORE, ...JSON.parse(saved) };
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    async function load() {
      try {
        const payload = await loadInitialWorkspace();
        let resolved = normalizeStore(payload.store);
        let resolvedPersistence: StudioClientPersistence = payload.persistence === "postgresql" ? "database" : "local";

        // One-time migration: if the database is empty, preserve any workspace
        // still present in this browser by uploading it before using the DB.
        let migratedFromBrowser = false;
        if (!resolved && browserStore) {
          migratedFromBrowser = true;
          const migrated = await fetch("/api/studio/workspace", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(browserStore),
          });
          if (!migrated.ok) throw new Error("Database migration failed");
          const migratedPayload = await migrated.json() as WorkspaceApiPayload;
          resolved = normalizeStore(migratedPayload.store);
          resolvedPersistence = migratedPayload.persistence === "postgresql" ? "database" : "local";
        }

        if (!cancelled) {
          const next = resolved ?? EMPTY_STUDIO_STORE;
          storeRef.current = next;
          setStore(next);
          setPersistence(resolvedPersistence);
          setSyncPending(resolvedPersistence === "local" && (
            migratedFromBrowser ? true : payload.pendingSync
          ));
        }
      } catch {
        if (!cancelled) {
          const next = browserStore ?? EMPTY_STUDIO_STORE;
          storeRef.current = next;
          setStore(next);
          setPersistence("browser");
          setSyncPending(false);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((recipe: (current: StudioStore) => StudioStore): Promise<StudioClientPersistence> => {
    const next = recipe(storeRef.current);
    storeRef.current = next;
    setStore(next);
    // Retain a browser copy for offline resilience and one-time migration,
    // while PostgreSQL remains the authoritative cross-restart store.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    const persisted = persistQueue.current
      .then(async () => {
        const response = await fetch("/api/studio/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error("Studio database save failed");
        const payload = await response.json() as WorkspaceApiPayload;
        const destination: StudioClientPersistence = payload.persistence === "postgresql" ? "database" : "local";
        setPersistence(destination);
        setSyncPending(payload.pendingSync);
        return destination;
      })
      .catch(() => {
        setPersistence("browser");
        setSyncPending(false);
        return "browser" as const;
      });
    persistQueue.current = persisted.then(() => undefined);
    return persisted;
  }, []);

  return { store, ready, update, persistence, syncPending };
}
