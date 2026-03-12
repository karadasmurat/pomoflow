import { state } from '../state/store.js';
import { HistoryService } from '../services/history.service.js';

export class DashboardView {
    static updateStats() {
        const data = HistoryService.getDashboardData();
        
        // Update Focus Time
        const h = Math.floor(data.todaySecs / 3600);
        const m = Math.floor((data.todaySecs % 3600) / 60);
        const todayTimeEl = document.getElementById('todayFocusTime');
        if (todayTimeEl) todayTimeEl.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;

        // Update Sessions
        const todaySessEl = document.getElementById('todaySessions');
        if (todaySessEl) todaySessEl.textContent = data.todaySessions.length;

        // Update Streak
        const streakEl = document.getElementById('currentStreak');
        if (streakEl) streakEl.textContent = data.streak > 0 ? `${data.streak} days` : '--';

        // Update Trends
        this._updateTrend('focusTimeTrend', data.todaySecs, data.yesterdaySecs);
        this._updateTrend('sessionsTrend', data.todaySessions.length, data.yesterdaySessions.length);
        
        const streakTrendEl = document.getElementById('streakTrend');
        if (streakTrendEl) {
            streakTrendEl.innerHTML = data.streak > 0 ? '<span class="trend-up">🔥 Active</span>' : '';
        }
    }

    static renderHistory(filter = 'today', options = {}) {
        const list = document.getElementById('historyList');
        if (!list) return;
        
        const headerHTML = `<div class="history-header-grid sticky-header"><div class="history-header-indicator"></div><div class="history-header-info"><div>FOCUS AREA</div><div>DURATION</div><div>FINISHED AT</div></div><div class="history-header-more"></div></div>`;
        let sessions = HistoryService.filterSessions(state.sessions, filter);
        
        this.renderChart(sessions);

        if (sessions.length === 0) {
            list.innerHTML = headerHTML + '<div class="empty-state"><p>No sessions found for this period.</p></div>';
            return;
        }
        
        sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        list.innerHTML = headerHTML;
        
        const showAll = options.showAllHistory || false;
        const displaySessions = showAll ? sessions : sessions.slice(0, 4);

        // Group by category
        const groups = {};
        displaySessions.forEach(s => {
            const cat = s.taskCategory || 'Uncategorized';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(s);
        });

        Object.entries(groups).forEach(([cat, groupSessions]) => {
            const catHeader = document.createElement('div');
            catHeader.className = 'activity-group-header';
            catHeader.textContent = cat;
            list.appendChild(catHeader);

            groupSessions.forEach(session => {
                list.appendChild(this._createHistoryItem(session, options.callbacks || {}));
            });
        });

        this._updateShowAllButton(sessions.length, showAll);
    }

    static renderChart(sessions) {
        const container = document.getElementById('historyChart');
        const heroContainer = document.getElementById('heroBadgeContainer');
        if (!container) return;
        container.innerHTML = '';
        if (heroContainer) heroContainer.innerHTML = '';

        if (sessions.length === 0) return;
        
        const data = {};
        sessions.forEach(s => {
            const name = s.taskName || 'Unknown';
            const duration = Number(s.duration) || 0;
            if (!data[name]) data[name] = { time: 0, color: s.taskColor || '#58a6ff' };
            data[name].time += duration;
        });
        
        const sorted = Object.entries(data).sort((a, b) => b[1].time - a[1].time);
        const top = sorted.slice(0, 5);
        const total = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
        if (total <= 0) return;

        this._renderHeroBadge(heroContainer, sorted, total);
        this._renderPieChart(container, top, total);
    }

    static _createHistoryItem(session, callbacks) {
        const item = document.createElement('sliding-card');
        item.setAttribute('menu-width', '100px');
        item.setAttribute('variant', state.settings.cardVariant || 'glass');
        
        const timeStr = callbacks.formatTimestamp ? callbacks.formatTimestamp(new Date(session.timestamp)) : session.timestamp;
        const durationMin = Math.round(session.duration / 60);
        
        const editIcon = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108,148,64l24-24,44,44Zm-101,96H48V160l88-88,44,44Z"></path></svg>';
        const deleteIcon = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg>';

        item.innerHTML = `
            <button slot="menu" class="edit-btn">${editIcon}<span>Edit</span></button>
            <button slot="menu" class="danger delete-btn">${deleteIcon}<span>Delete</span></button>
            <div slot="indicator" class="history-type-indicator" style="background: ${session.taskColor || '#58a6ff'}"></div>
            <div class="history-info">
                <div class="history-focus-area" title="${this._escapeHtml(session.taskName)}">${this._escapeHtml(session.taskName)}</div>
                <div class="history-duration">${durationMin} min</div>
                <div class="history-time">${timeStr}</div>
            </div>
        `;
        
        item.querySelector('.edit-btn').onclick = () => {
            item.isOpen = false;
            if (callbacks.onEdit) callbacks.onEdit(session);
        };
        item.querySelector('.delete-btn').onclick = () => {
            item.isOpen = false;
            if (callbacks.onDelete) callbacks.onDelete(session.id);
        };
        
        return item;
    }

    static _updateTrend(elementId, today, yesterday) {
        const el = document.getElementById(elementId);
        if (!el) return;

        if (today === 0) {
            el.innerHTML = '<span class="trend-neutral">Ready to start?</span>';
            return;
        }

        if (yesterday === 0) {
            el.innerHTML = '<span class="trend-up">↑ 100% vs yesterday</span>';
            return;
        }

        const diff = today - yesterday;
        const percent = Math.abs(Math.round((diff / yesterday) * 100));
        const isUp = diff >= 0;

        if (diff === 0) {
            el.innerHTML = '<span class="trend-neutral">Same as yesterday</span>';
        } else {
            el.innerHTML = `<span class="trend-${isUp ? 'up' : 'down'}">${isUp ? '↑' : '↓'} ${percent}% vs yesterday</span>`;
        }
    }

    static _renderHeroBadge(container, sorted, total) {
        if (!container || sorted.length === 0) return;
        const hero = sorted[0];
        const percent = Math.round((hero[1].time / total) * 100);
        container.innerHTML = `
            <div class="hero-badge" style="border-color: ${hero[1].color}; color: ${hero[1].color}">
                <span class="hero-icon">🏆</span>
                <span class="hero-label">Focus Hero: ${this._escapeHtml(hero[0])} (${percent}%)</span>
            </div>
        `;
    }

    static _renderPieChart(container, top, total) {
        const chartSize = 140; const center = chartSize / 2; const radius = 60; let curAngle = 0;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${chartSize} ${chartSize}`);
        svg.classList.add('pie-chart');
        
        top.forEach(([name, d]) => {
            const slice = (d.time / total) * 360;
            if (isNaN(slice)) return;
            if (slice >= 359.9) {
                const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                c.setAttribute('cx', center); c.setAttribute('cy', center); c.setAttribute('r', radius); c.setAttribute('fill', d.color);
                svg.appendChild(c); return;
            }
            const x1 = center + radius * Math.cos(Math.PI * (curAngle - 90) / 180);
            const y1 = center + radius * Math.sin(Math.PI * (curAngle - 90) / 180);
            curAngle += slice;
            const x2 = center + radius * Math.cos(Math.PI * (curAngle - 90) / 180);
            const y2 = center + radius * Math.sin(Math.PI * (curAngle - 90) / 180);
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${slice > 180 ? 1 : 0} 1 ${x2} ${y2} Z`);
            p.setAttribute('fill', d.color); svg.appendChild(p);
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'pie-chart-container'; wrapper.appendChild(svg);
        const legend = document.createElement('div');
        legend.className = 'pie-legend';
        
        top.forEach(([name, d]) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<div class="legend-color" style="background: ${d.color}"></div><div class="legend-label">${this._escapeHtml(name)}</div><div class="legend-value">${Math.round(d.time/60)}m (${Math.round(d.time/total*100)}%)</div>`;
            legend.appendChild(item);
        });
        
        wrapper.appendChild(legend); container.appendChild(wrapper);
    }

    static _updateShowAllButton(totalCount, isShowingAll) {
        const showAllBtn = document.querySelector('.history-show-all-container .filter-btn');
        if (showAllBtn) {
            showAllBtn.style.display = totalCount > 4 ? 'flex' : 'none';
            showAllBtn.innerHTML = isShowingAll ? 'Show Less' : 'Show All';
        }
    }

    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
