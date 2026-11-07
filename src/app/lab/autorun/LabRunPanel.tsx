"use client";

import { useState } from "react";
import { createPolledGuard } from "@/lib/lab/labLiveGuard";
import { createRemoteLedger, type LedgerRequest } from "@/lib/lab/labLedgerApi";
import { startLabRunFromScreen, type LabScreenView } from "@/lib/lab/labRunScreen";
import { buildLabScreenInput } from "@/lib/lab/labScreenDeps";
import { prepareLabSource } from "@/lib/lab/labMediaPrep";
import { probeVideo } from "@/features/device-render/editorState";

export interface LabPanelProps {
  /** Server-side values only: the page has already checked the lab identity. */
  identity: { userId: string; email: string; role: string };
  flagOn: boolean;
  providerOn: boolean;
  testPlace: { placeName: string; latitude: number; longitude: number } | null;
  fileNames: string[];
}

async function postLedger(body: LedgerRequest): Promise<{ status: number; body: unknown }> {
  const res = await fetch("/api/lab/autorun/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export function LabRunPanel(props: LabPanelProps) {
  const [view, setView] = useState<LabScreenView | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const ledger = createRemoteLedger(postLedger);
      const guard = createPolledGuard(async () => (await postLedger({ op: "usedToday" })).status === 200);
      await guard.refresh();
      const testPlaceEnv = props.testPlace
        ? { LAB_TEST_PLACE_NAME: props.testPlace.placeName, LAB_TEST_PLACE_LAT: String(props.testPlace.latitude), LAB_TEST_PLACE_LNG: String(props.testPlace.longitude) }
        : {};
      const input = buildLabScreenInput({
        env: { NEXT_PUBLIC_LAB_AUTORUN: props.flagOn ? "true" : undefined, ...testPlaceEnv },
        identity: {
          flagValue: props.flagOn ? "true" : undefined,
          labEmail: props.identity.email,
          requesterRole: props.identity.role,
          session: { user: { id: props.identity.userId, role: props.identity.role, email: props.identity.email } },
        },
        ledger,
        guard,
        runId: crypto.randomUUID(),
        prepareSource: (file) =>
          prepareLabSource(file, {
            probe: probeVideo,
            createObjectURL: (f) => URL.createObjectURL(f),
            revokeObjectURL: (u) => URL.revokeObjectURL(u),
            timeoutMs: 20_000,
            isCancelled: () => guard.isStopped(),
          }),
        fetchJson: async (url, init) => {
          const res = await fetch(url, init);
          return { ok: res.ok, status: res.status, json: () => res.json() };
        },
        fetchBlob: async (url) => (await fetch(url)).blob(),
        fileNames: props.fileNames,
      });
      setView(await startLabRunFromScreen({ ...input, providerExecutionEnabled: props.providerOn }));
    } catch {
      setView({ title: "Not started", detail: "The lab run could not start. Nothing was sent." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <button type="button" onClick={start} disabled={!props.providerOn || busy}>
        Start lab run
      </button>
      {!props.providerOn ? <p>Paid provider work is switched off in this build. Nothing will be sent.</p> : null}
      {!props.testPlace ? <p>No lab test place is configured.</p> : null}
      {view ? (
        <p>
          <strong>{view.title}:</strong> {view.detail}
        </p>
      ) : null}
    </section>
  );
}
