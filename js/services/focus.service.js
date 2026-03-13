import { state, mutations } from '../state/store.js';
import { uuidv7 } from '../utils/uuid.js';

export class FocusService {
    static addFocusArea(name, category, color) {
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
        return task;
    }

    static deleteFocusArea(id) {
        const index = state.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            state.tasks.splice(index, 1);
            // Also clean up sessions or keep them? 
            // Current app logic seems to keep sessions but they lose the link.
            return true;
        }
        return false;
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
