import { state } from '../state/store.js';

export class HistoryService {
    static getLogicalDate(date = new Date()) {
        try {
            const d = (date instanceof Date) ? date : new Date(date);
            if (isNaN(d.getTime())) {
                return new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString().split('T')[0];
            }
            const shifted = new Date(d.getTime() - (4 * 60 * 60 * 1000));
            return shifted.toISOString().split('T')[0];
        } catch (e) {
            return new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString().split('T')[0];
        }
    }

    static filterSessions(sessions, filter) {
        const now = new Date();
        if (filter === 'today') {
            const today = this.getLogicalDate(now);
            return sessions.filter(s => this.getLogicalDate(new Date(s.timestamp)) === today);
        } else if (filter === 'week') {
            const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (7 * 24 * 60 * 60 * 1000);
            return sessions.filter(s => new Date(s.timestamp).getTime() >= weekAgo);
        }
        return sessions;
    }

    static calculateStreak(sessions) {
        if (sessions.length === 0) return 0;
        const dates = [...new Set(sessions.map(s => this.getLogicalDate(new Date(s.timestamp))))].map(d => new Date(d)).sort((a, b) => b - a);
        let streak = 0; 
        let cur = new Date(this.getLogicalDate());
        
        if (Math.floor((cur - dates[0]) / 86400000) > 1) return 0;
        
        for (let i = 0; i < dates.length; i++) {
            if (i === 0) { streak = 1; continue; }
            if (Math.floor((dates[i-1] - dates[i]) / 86400000) === 1) streak++;
            else break;
        }
        return streak;
    }

    static getDashboardData() {
        const today = this.getLogicalDate();
        const now = new Date();
        const yesterdayDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        const yesterday = this.getLogicalDate(yesterdayDate);

        const todaySessions = state.sessions.filter(s => this.getLogicalDate(new Date(s.timestamp)) === today);
        const yesterdaySessions = state.sessions.filter(s => this.getLogicalDate(new Date(s.timestamp)) === yesterday);

        const todaySecs = todaySessions.reduce((acc, s) => acc + s.duration, 0);
        const yesterdaySecs = yesterdaySessions.reduce((acc, s) => acc + s.duration, 0);

        return {
            todaySessions,
            yesterdaySessions,
            todaySecs,
            yesterdaySecs,
            streak: this.calculateStreak(state.sessions)
        };
    }
}
