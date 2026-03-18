/**
 * PomoFlow Sync Service — Phase 2 (direct Supabase table writes)
 *
 * Reads pending sync_log entries and replays them directly against Supabase
 * tables using the authenticated JS client. RLS ensures each user can only
 * write to their own rows — no Edge Function required.
 */

import { dbManager } from '../db.js';
import { supabase } from './supabase.js';

const POLL_INTERVAL_MS = 30_000;

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

            const synced = [];
            for (const op of pending) {
                try {
                    const payload = typeof op.payload === 'string'
                        ? JSON.parse(op.payload) : op.payload;
                    await replayOperation(session.user.id, op.operation, payload, op.changed_at);
                    synced.push(op.id);
                } catch (e) {
                    console.warn(`[Sync] ${op.operation} failed:`, e.message);
                }
            }

            if (synced.length > 0) {
                await dbManager.markSynced(synced);
                console.log(`[Sync] ${synced.length} operation(s) synced ✓`);
            }
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

async function replayOperation(userId, operation, payload, changedAt) {
    switch (operation) {

        case 'UPSERT_FOCUS_AREA':
            await supabase.from('focus_areas').upsert({
                id: payload.id, user_id: userId,
                name: payload.name, color: payload.color,
                category: payload.category, is_active: payload.is_active,
                is_deleted: payload.is_deleted ?? false,
                updated_at: changedAt,
            }, { onConflict: 'id' }).throwOnError();
            break;

        case 'DELETE_FOCUS_AREA':
            await supabase.from('focus_areas')
                .update({ is_deleted: true, updated_at: changedAt })
                .eq('id', payload.id).throwOnError();
            break;

        case 'UPSERT_SESSION':
            await supabase.from('sessions').upsert({
                id: payload.id, user_id: userId,
                focus_area_id: payload.focus_area_id || null,
                task_name: payload.task_name, task_color: payload.task_color,
                duration_seconds: payload.duration_seconds,
                xp_earned: payload.xp_earned || 0,
                timestamp: payload.timestamp,
                updated_at: changedAt,
            }, { onConflict: 'id' }).throwOnError();
            break;

        case 'DELETE_SESSION':
            await supabase.from('sessions')
                .update({ is_deleted: true, updated_at: changedAt })
                .eq('id', payload.id).throwOnError();
            break;

        case 'UPSERT_AIM':
            await supabase.from('aims').upsert({
                id: payload.id, user_id: userId,
                focus_area_id: payload.focus_area_id,
                target_minutes: payload.target_minutes,
                target_date: payload.target_date || null,
                is_completed: payload.is_completed ?? false,
                updated_at: changedAt,
            }, { onConflict: 'id' }).throwOnError();
            break;

        case 'DELETE_AIM':
            await supabase.from('aims')
                .update({ is_deleted: true, updated_at: changedAt })
                .eq('id', payload.id).throwOnError();
            break;

        case 'UPSERT_PLANNED_BLOCK':
            await supabase.from('planned_blocks').upsert({
                id: payload.id, user_id: userId,
                focus_area_id: payload.focus_area_id,
                path_id: payload.path_id || null,
                planned_date: payload.planned_date,
                start_minutes: payload.start_minutes,
                duration_minutes: payload.duration_minutes,
                notes: payload.notes || null,
                updated_at: changedAt,
            }, { onConflict: 'id' }).throwOnError();
            break;

        case 'DELETE_PLANNED_BLOCK':
            await supabase.from('planned_blocks')
                .delete().eq('id', payload.id).throwOnError();
            break;

        case 'WALK_PLANNED_BLOCK':
            await supabase.from('planned_blocks')
                .update({ walked_session_id: payload.session_id, updated_at: changedAt })
                .eq('id', payload.block_id).throwOnError();
            break;

        case 'UPSERT_PATH':
            await supabase.from('paths').upsert({
                id: payload.id, user_id: userId,
                name: payload.name,
                description: payload.description || null,
                color: payload.color || '#3D8F5A',
                deadline: payload.deadline || null,
                status: payload.status || 'active',
                updated_at: changedAt,
            }, { onConflict: 'id' }).throwOnError();
            break;

        case 'ARCHIVE_PATH':
            await supabase.from('paths')
                .update({ status: 'archived', updated_at: changedAt })
                .eq('id', payload.id).throwOnError();
            break;

        case 'DELETE_PATH':
            await supabase.from('paths')
                .delete().eq('id', payload.id).throwOnError();
            break;

        default:
            console.warn('[Sync] unknown operation:', operation);
    }
}

export const syncService = new SyncService();
