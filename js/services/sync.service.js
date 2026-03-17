/**
 * PomoFlow Sync Service — Phase 1 (Outbox foundation)
 *
 * Reads pending sync_log entries and will push them to Supabase in Phase 2.
 * Currently a no-op on the network side: it reads the outbox and logs pending
 * operations so the infrastructure is exercised and ready for Phase 2 wiring.
 */

import { dbManager } from '../db.js';

const POLL_INTERVAL_MS = 30_000;

class SyncService {
    constructor() {
        this._timer = null;
        this._flushing = false;
    }

    /**
     * Read all pending sync_log rows and attempt to push them.
     * Phase 1: logs only. Phase 2: calls Supabase Edge Function.
     */
    async flush() {
        if (this._flushing) return;
        this._flushing = true;
        try {
            const pending = await dbManager.getPendingSyncLog();
            if (!pending || pending.length === 0) return;

            // ── Phase 2: replace this block with Supabase push ───────────────
            // const { error } = await supabase.functions.invoke('sync-push', {
            //     body: { device_id: dbManager.deviceId, operations: pending }
            // });
            // if (error) throw error;
            // ─────────────────────────────────────────────────────────────────

            console.log(`[Sync] ${pending.length} pending operation(s) queued — cloud sync not yet enabled`);
        } catch (err) {
            console.warn('[Sync] flush error:', err);
        } finally {
            this._flushing = false;
        }
    }

    startPolling(intervalMs = POLL_INTERVAL_MS) {
        this.stopPolling();
        this.flush(); // immediate check on start
        this._timer = setInterval(() => this.flush(), intervalMs);
    }

    stopPolling() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }
}

export const syncService = new SyncService();
