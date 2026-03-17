/**
 * PomoFlow — sync-push Edge Function
 * Receives outbox operations from a device, validates the JWT, and replays
 * each operation as an upsert/update/delete in Postgres.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        // Verify JWT and get user
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return respond(401, { error: 'Unauthorized' });

        const { data: { user }, error: authError } =
            await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
        if (authError || !user) return respond(401, { error: 'Unauthorized' });

        const { operations } = await req.json();
        if (!Array.isArray(operations) || operations.length === 0) {
            return respond(200, { ok: true, processed: 0 });
        }

        let processed = 0;
        const errors: { id: string; operation: string; error: string }[] = [];

        for (const op of operations) {
            try {
                const payload = typeof op.payload === 'string'
                    ? JSON.parse(op.payload) : op.payload;
                await replayOperation(supabase, user.id, op.operation, payload, op.changed_at);
                processed++;
            } catch (e: any) {
                console.error(`[sync-push] ${op.operation} failed:`, e.message);
                errors.push({ id: op.id, operation: op.operation, error: e.message });
            }
        }

        return respond(200, { ok: true, processed, errors });
    } catch (err: any) {
        console.error('[sync-push] unexpected error:', err);
        return respond(500, { ok: false, error: err.message });
    }
});

function respond(status: number, body: object) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

// deno-lint-ignore no-explicit-any
async function replayOperation(supabase: any, userId: string, operation: string, payload: any, changedAt: string) {
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
                .eq('id', payload.id).eq('user_id', userId).throwOnError();
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
                .eq('id', payload.id).eq('user_id', userId).throwOnError();
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
                .eq('id', payload.id).eq('user_id', userId).throwOnError();
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
                .delete()
                .eq('id', payload.id).eq('user_id', userId).throwOnError();
            break;

        case 'WALK_PLANNED_BLOCK':
            await supabase.from('planned_blocks')
                .update({ walked_session_id: payload.session_id, updated_at: changedAt })
                .eq('id', payload.block_id).eq('user_id', userId).throwOnError();
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
                .eq('id', payload.id).eq('user_id', userId).throwOnError();
            break;

        case 'DELETE_PATH':
            await supabase.from('paths')
                .delete()
                .eq('id', payload.id).eq('user_id', userId).throwOnError();
            break;

        default:
            console.warn('[sync-push] unknown operation:', operation);
    }
}
