import { state, mutations } from '../state/store.js';
import { dbManager } from '../db.js';
import { uuidv7 } from '../utils/uuid.js';
import { NotificationService } from './notification.service.js';

export class FocusService {
    static async addFocusArea(name, category, color) {
        if (!name) return null;

        const now = new Date().toISOString();
        const task = {
            id: uuidv7(),
            name,
            category: category || 'Uncategorized',
            color: color || state.selectedTaskColor,
            completed: false,
            created_at: now,
            updated_at: now,
            totalTime: 0
        };
        state.tasks.push(task);
        state.lastTaskId = task.id;

        if (dbManager.initialized) {
            await dbManager.insertFocusArea(task);
        }

        NotificationService.notifyAction('TASK_CREATED', { name });
        return task;
    }

    static async updateFocusArea(id, updates) {
        const task = state.tasks.find(t => t.id === id);
        if (!task) return null;

        Object.assign(task, updates);
        task.updated_at = new Date().toISOString();

        if (dbManager.initialized) {
            await dbManager.insertFocusArea(task);
        }

        NotificationService.notifyAction('TASK_UPDATED', { name: task.name });
        return task;
    }

    static async deleteFocusArea(id) {
        const index = state.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            const name = state.tasks[index].name;
            state.tasks.splice(index, 1);
            
            if (dbManager.initialized) {
                await dbManager.deleteFocusArea(id);
            }

            NotificationService.notifyAction('TASK_DELETED', { name });
            return true;
        }
        return false;
    }

    static async toggleComplete(id) {
        const t = state.tasks.find(x => x.id === id);
        if (!t) return false;

        t.completed = !t.completed;
        t.updated_at = new Date().toISOString();

        if (dbManager.initialized) {
            await dbManager.insertFocusArea(t);
        }

        NotificationService.notifyAction(t.completed ? 'TASK_COMPLETED' : 'TASK_REACTIVATED', { name: t.name });
        return true;
    }

    static addXP(amt) {
        const oldTotalXp = state.totalXp;
        state.xp += amt;
        state.totalXp += amt;
        
        let leveledUp = false;
        if (state.xp >= state.level * 1000) {
            state.xp -= state.level * 1000;
            state.level++;
            leveledUp = true;
        }
        
        return {
            leveledUp,
            level: state.level,
            oldTotalXp,
            newTotalXp: state.totalXp,
            amtEarned: amt
        };
    }

    static getRank(level) {
        const ranks = [
            { min: 1, name: 'Novice' }, 
            { min: 5, name: 'Focused' }, 
            { min: 10, name: 'Deep Worker' }, 
            { min: 20, name: 'Flow State' }, 
            { min: 35, name: 'Master' }, 
            { min: 50, name: 'Zen Architect' }
        ];
        const currentRank = [...ranks].reverse().find(r => level >= r.min);
        return currentRank ? currentRank.name : 'Novice';
    }
}
