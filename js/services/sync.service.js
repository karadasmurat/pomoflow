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

    /**
     * Pull records from Supabase into local DB.
     * Uses last_pulled_at for delta sync — only fetches records changed since last pull.
     * On first call (no timestamp), fetches everything.
     * Safe to call on every init — all writes are upserts.
     * Returns number of focus areas pulled (>0 means data exists in cloud).
     */
    async pullFromCloud() {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return 0;

            const LAST_PULLED_KEY = 'pf_last_pulled_at';
            const since = localStorage.getItem(LAST_PULLED_KEY);
            const pullStart = new Date().toISOString();

            console.log(`[Sync] pulling from cloud${since ? ` (since ${since})` : ' (full)'}…`);

            const filter = (q) => since ? q.gt('updated_at', since) : q;

            const [
                { data: focusAreas },
                { data: paths },
                { data: plannedBlocks },
                { data: sessions },
                { data: aims },
            ] = await Promise.all([
                filter(supabase.from('focus_areas').select('*')),
                filter(supabase.from('paths').select('*')),
                filter(supabase.from('planned_blocks').select('*')),
                filter(supabase.from('sessions').select('*').order('timestamp', { ascending: false }).limit(500)),
                filter(supabase.from('aims').select('*')),
            ]);

            // Upsert in dependency order: paths before planned_blocks
            for (const fa of focusAreas || []) {
                await dbManager.insertFocusArea({
                    id: fa.id, name: fa.name, color: fa.color,
                    category: fa.category,
                    completed: fa.is_active === false,
                    created_at: fa.created_at, updated_at: fa.updated_at,
                    skipSync: true,
                });
            }
            for (const p of paths || []) {
                await dbManager.insertPath({ ...p, skipSync: true });
            }
            for (const b of plannedBlocks || []) {
                await dbManager.insertPlannedBlock({
                    id: b.id,
                    focusAreaId: b.focus_area_id,
                    plannedDate: b.planned_date,
                    startMinutes: b.start_minutes,
                    durationMinutes: b.duration_minutes,
                    notes: b.notes,
                    pathId: b.path_id,
                    skipSync: true,
                });
            }
            for (const s of sessions || []) {
                await dbManager.insertSession({
                    id: s.id,
                    taskId: s.focus_area_id,
                    taskName: s.task_name,
                    taskColor: s.task_color,
                    duration: s.duration_seconds,
                    xp: s.xp_earned,
                    timestamp: s.timestamp,
                    created_at: s.created_at,
                    updated_at: s.updated_at,
                    skipSync: true,
                });
            }
            for (const a of aims || []) {
                await dbManager.insertAim({
                    id: a.id,
                    focusAreaId: a.focus_area_id,
                    targetMinutes: a.target_minutes,
                    deadline: a.target_date,
                    completed: a.is_completed,
                    created_at: a.created_at,
                    updated_at: a.updated_at,
                    skipSync: true,
                });
            }

            const total = (focusAreas?.length || 0) + (paths?.length || 0) + (plannedBlocks?.length || 0) + (sessions?.length || 0) + (aims?.length || 0);
            if (total > 0) console.log(`[Sync] pulled ${total} record(s) from cloud ✓`);

            localStorage.setItem(LAST_PULLED_KEY, pullStart);
            return focusAreas?.length || 0;
        } catch (err) {
            console.warn('[Sync] pullFromCloud error:', err);
            return 0;
        }
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
