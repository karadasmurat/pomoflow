/**
 * PomoFlow Sync Service — Phase 2 (Auth + cloud push)
 *
 * Reads pending sync_log entries and pushes them to the sync-push Edge Function.
 * Only runs when the user is signed in. Marks entries synced after a successful push.
 */

import { dbManager } from '../db.js';
import { supabase } from './supabase.js';

const POLL_INTERVAL_MS = 30_000;
const EDGE_FN = 'sync-push';

class SyncService {
    constructor() {
        this._timer = null;
        this._flushing = false;
    }

    async flush() {
        if (this._flushing) return;
        this._flushing = true;
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const pending = await dbManager.getPendingSyncLog();
            if (!pending || pending.length === 0) return;

            console.log(`[Sync] pushing ${pending.length} operation(s)…`);

            const { data, error } = await supabase.functions.invoke(EDGE_FN, {
                body: {
                    device_id: dbManager.deviceId,
                    operations: pending,
                },
            });

            if (error) {
                console.warn('[Sync] edge function error:', error, data);
                throw error;
            }

            await dbManager.markSynced(pending.map(op => op.id));
            console.log(`[Sync] ${pending.length} operation(s) synced ✓`);
        } catch (err) {
            console.warn('[Sync] flush error:', err);
        } finally {
            this._flushing = false;
        }
    }

    startPolling(intervalMs = POLL_INTERVAL_MS) {
        this.stopPolling();
        this.flush();
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
