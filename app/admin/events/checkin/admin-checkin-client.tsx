"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type CheckInRecord = {
  pk: string;
  sk: string;
  checkedInAt: string;
  checkedInBy: string;
  method: "qr" | "manual";
  notes?: string | null;
  ownerAddress: string;
};

type EventOption = {
  lockAddress: string;
  title: string;
};

export default function AdminCheckinClient() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedLock, setSelectedLock] = useState<string>("");
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Manual check-in form
  const [manualTokenId, setManualTokenId] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [qrTokenInput, setQrTokenInput] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const res = await fetch("/api/admin/events", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(payload?.events)) {
        setEvents(
          payload.events.map((e: any) => ({
            lockAddress: e.lockAddress,
            title: e.title || e.lockAddress,
          })),
        );
      }
    } catch {
      // silent
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const fetchCheckIns = useCallback(async () => {
    if (!selectedLock) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/checkin?lockAddress=${encodeURIComponent(selectedLock)}`,
        { cache: "no-store" },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to load check-ins.");
      setCheckIns(Array.isArray(payload?.checkIns) ? payload.checkIns : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load check-ins.");
    } finally {
      setLoading(false);
    }
  }, [selectedLock]);

  useEffect(() => {
    void fetchCheckIns();
  }, [fetchCheckIns]);

  const handleManualCheckIn = async () => {
    if (!selectedLock || !manualTokenId.trim()) return;
    setCheckingIn(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/events/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockAddress: selectedLock,
          tokenId: manualTokenId.trim(),
          method: "manual",
          notes: manualNotes.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Check-in failed.");
      setNotice(`Checked in token #${manualTokenId.trim()}`);
      setManualTokenId("");
      setManualNotes("");
      await fetchCheckIns();
    } catch (err: any) {
      setError(err?.message || "Check-in failed.");
    } finally {
      setCheckingIn(false);
    }
  };

  const handleQrCheckIn = async () => {
    if (!selectedLock || !qrTokenInput.trim()) return;
    setCheckingIn(true);
    setError(null);
    setNotice(null);
    try {
      // Extract token from URL if pasted as full URL
      let token = qrTokenInput.trim();
      try {
        const url = new URL(token);
        const t = url.searchParams.get("t");
        if (t) token = t;
      } catch {
        // not a URL, use as-is
      }
      const res = await fetch("/api/events/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockAddress: selectedLock,
          qrToken: token,
          method: "qr",
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "QR check-in failed.");
      setNotice("QR check-in successful.");
      setQrTokenInput("");
      await fetchCheckIns();
    } catch (err: any) {
      setError(err?.message || "QR check-in failed.");
    } finally {
      setCheckingIn(false);
    }
  };

  const handleUndo = async (tokenId: string) => {
    if (!selectedLock) return;
    setError(null);
    setNotice(null);
    try {
      const sk = `TOKEN#${tokenId}`;
      const match = checkIns.find((ci) => ci.sk === sk);
      const tid = match ? tokenId : tokenId;
      const res = await fetch(
        `/api/events/checkin?lockAddress=${encodeURIComponent(selectedLock)}&tokenId=${encodeURIComponent(tid)}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Undo failed.");
      setNotice(`Undid check-in for token #${tid}`);
      await fetchCheckIns();
    } catch (err: any) {
      setError(err?.message || "Undo failed.");
    }
  };

  const extractTokenId = (sk: string) => sk.replace(/^TOKEN#/, "");

  return (
    <div className="space-y-5">
      <div className="glass-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-eyebrow text-[var(--brand-denim)]">Events</p>
            <h2 className="text-2xl font-semibold text-[#0b0b43]">Check-in management</h2>
            <p className="text-sm text-muted-foreground">
              Check in attendees manually or via QR code scan.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" asChild>
              <Link href="/admin/events">Back to events</Link>
            </Button>
            <Button variant="ghost" onClick={fetchCheckIns} disabled={loading || !selectedLock}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
              Select event
            </span>
            {eventsLoading ? (
              <div className="text-sm text-[var(--muted-ink)]">Loading events...</div>
            ) : (
              <select
                value={selectedLock}
                onChange={(e) => setSelectedLock(e.target.value)}
                className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
              >
                <option value="">Choose an event...</option>
                {events.map((e) => (
                  <option key={e.lockAddress} value={e.lockAddress}>
                    {e.title} ({e.lockAddress.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      </div>

      {selectedLock ? (
        <>
          {/* Manual check-in */}
          <div className="glass-item p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
              Manual check-in
            </h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex-1 space-y-1">
                <span className="text-xs text-[var(--muted-ink)]">Token ID</span>
                <input
                  value={manualTokenId}
                  onChange={(e) => setManualTokenId(e.target.value)}
                  placeholder="e.g. 1"
                  className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
                />
              </label>
              <label className="flex-1 space-y-1">
                <span className="text-xs text-[var(--muted-ink)]">Notes (optional)</span>
                <input
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Optional notes"
                  className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
                />
              </label>
              <Button onClick={handleManualCheckIn} disabled={checkingIn || !manualTokenId.trim()}>
                Check in
              </Button>
            </div>
          </div>

          {/* QR scan check-in */}
          <div className="glass-item p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
              QR code check-in
            </h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex-1 space-y-1">
                <span className="text-xs text-[var(--muted-ink)]">Scan or paste QR content / URL</span>
                <input
                  value={qrTokenInput}
                  onChange={(e) => setQrTokenInput(e.target.value)}
                  placeholder="Paste QR code content or URL"
                  className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
                />
              </label>
              <Button onClick={handleQrCheckIn} disabled={checkingIn || !qrTokenInput.trim()}>
                Validate & check in
              </Button>
            </div>
          </div>

          {error ? (
            <div className="glass-item border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="glass-item border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          {/* Attendee list */}
          <div className="glass-item p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
              Checked-in attendees ({checkIns.length})
            </h3>
            {loading ? (
              <div className="mt-3 text-sm text-[var(--muted-ink)]">Loading...</div>
            ) : checkIns.length === 0 ? (
              <div className="mt-3 text-sm text-[var(--muted-ink)]">No check-ins yet.</div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(11,11,67,0.08)] text-left text-xs uppercase tracking-[0.15em] text-[var(--muted-ink)]">
                      <th className="pb-2 pr-4">Token ID</th>
                      <th className="pb-2 pr-4">Owner</th>
                      <th className="pb-2 pr-4">Method</th>
                      <th className="pb-2 pr-4">Checked in at</th>
                      <th className="pb-2 pr-4">Notes</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkIns.map((ci) => {
                      const tid = extractTokenId(ci.sk);
                      return (
                        <tr
                          key={ci.sk}
                          className="border-b border-[rgba(11,11,67,0.05)]"
                        >
                          <td className="py-2 pr-4 font-mono">{tid}</td>
                          <td className="py-2 pr-4 font-mono text-xs">
                            {ci.ownerAddress.slice(0, 6)}...{ci.ownerAddress.slice(-4)}
                          </td>
                          <td className="py-2 pr-4">{ci.method}</td>
                          <td className="py-2 pr-4 text-xs">
                            {new Date(ci.checkedInAt).toLocaleString()}
                          </td>
                          <td className="py-2 pr-4 text-xs text-[var(--muted-ink)]">
                            {ci.notes || "—"}
                          </td>
                          <td className="py-2">
                            <Button
                              variant="ghost"
                              className="text-xs text-rose-600"
                              onClick={() => handleUndo(tid)}
                            >
                              Undo
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
