import { state } from '../state/store.js';
import { dbManager } from '../db.js';
import { uuidv7 } from '../utils/uuid.js';

export class NotificationService {
    static async add(msg, type = 'info', options = {}) {
        // 1. Deduplication logic
        const isDuplicate = state.notifications.some(n => !n.read && n.msg === msg);
        if (isDuplicate) return null;

        // 2. Create object
        const notification = {
            id: uuidv7(),
            msg,
            type,
            timestamp: new Date().toISOString(),
            read: false
        };

        // 3. Update State
        state.notifications.unshift(notification);

        // 4. Update DB
        if (dbManager.initialized) {
            await dbManager.insertNotification({
                ...notification,
                skipSync: options.skipSync || false
            });
        }

        return notification;
    }

    /**
     * Centralized factory for CRUD and system notifications
     */
    static notifyAction(action, data = {}) {
        const templates = {
            'TASK_CREATED': (d) => ({ msg: `Added: ${d.name} ✨`, type: 'success' }),
            'TASK_UPDATED': (d) => ({ msg: `Updated: ${d.name} ✅`, type: 'success' }),
            'TASK_DELETED': (d) => ({ msg: `Deleted: ${d.name} 🗑️`, type: 'warning' }),
            'TASK_COMPLETED': (d) => ({ msg: `Focus area completed! ✅`, type: 'success' }),
            'TASK_REACTIVATED': (d) => ({ msg: `Focus area reactivated 🔄`, type: 'info' }),
            'SESSION_DELETED': (d) => ({ msg: `Session deleted 🗑️`, type: 'warning' }),
            'SESSION_UPDATED': (d) => ({ msg: `Session updated ✅`, type: 'success' }),
            'AIM_ADDED': (d) => ({ msg: `Aim added 🎯`, type: 'success' }),
            'AIM_REMOVED': (d) => ({ msg: `Aim removed 🗑️`, type: 'warning' }),
            'AIM_RENEWED': (d) => ({ msg: `Aim renewed! 🎯`, type: 'success' }),
            'CATEGORY_UPDATED': (d) => ({ msg: `Category updated: ${d.name} ✅`, type: 'success' }),
            'CATEGORY_DELETED': (d) => ({ msg: `Category "${d.name}" deleted 🗑️`, type: 'warning' }),
            'MOVED_TO_CATEGORY': (d) => ({ msg: `Moved to ${d.name} 📦`, type: 'info' }),
            'SETTINGS_SAVED': (d) => ({ msg: `Settings saved ⚙️`, type: 'success' }),
            'TIMER_RESET': (d) => ({ msg: `Timer reset 🔄`, type: 'info' }),
            'PERSONA_CHANGED': (d) => ({ msg: `Persona changed to ${d.mood} ${d.avatar} ✨`, type: 'success' }),
        };

        if (templates[action]) {
            const { msg, type } = templates[action](data);
            return this.add(msg, type);
        }
        
        // Fallback for unknown actions
        return this.add(action, data.type || 'info');
    }

    static async dismiss(id) {
        // 1. Update State
        state.notifications = state.notifications.filter(n => n.id !== id);

        // 2. Update DB
        if (dbManager.initialized) {
            await dbManager.deleteNotification(id);
        }
    }

    static async markAllAsRead() {
        const hasUnread = state.notifications.some(n => !n.read);
        if (!hasUnread) return;

        // 1. Update State
        state.notifications.forEach(n => n.read = true);

        // 2. Update DB
        if (dbManager.initialized) {
            await dbManager.markNotificationsRead();
        }
    }

    static async clearAll() {
        if (state.notifications.length === 0) return;

        // 1. Update State
        state.notifications = [];

        // 2. Update DB
        if (dbManager.initialized) {
            await dbManager.clearAllNotifications();
        }
    }
}
