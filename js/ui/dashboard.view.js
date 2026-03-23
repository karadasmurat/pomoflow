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
            streakTrendEl.innerHTML = data.streak > 0 ? '<span class="trend-up">↑ Active</span>' : '';
        }
    }

    static renderHistory(filter = 'today', options = {}) {
        const { sort = 'newest', category = null, page = 0,
                pageSize = 20, callbacks = {} } = options;
        const list = document.getElementById('historyList');
        if (!list) return;

        // Full period sessions — used for chart and category dropdown
        const allPeriodSessions = HistoryService.filterSessions(state.sessions, filter);
        this.renderChart(allPeriodSessions);
        this._updateCategoryDropdown(allPeriodSessions, category);

        // Apply category filter
        let sessions = category
            ? allPeriodSessions.filter(s => s.taskCategory === category)
            : [...allPeriodSessions];

        // Sort
        sessions.sort((a, b) => {
            const d = new Date(b.timestamp) - new Date(a.timestamp);
            return sort === 'newest' ? d : -d;
        });

        const total = sessions.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages - 1);
        const displaySessions = sessions.slice(safePage * pageSize, (safePage + 1) * pageSize);

        if (displaySessions.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>No sessions found for this period.</p></div>';
            this._updatePagination(safePage, totalPages, total);
            this._updateSortBtn(sort);
            this._updateActivityLogCount(total);
            return;
        }

        // Build table for desktop, cards for mobile
        if (this._isMobile()) {
            // Mobile: render cards directly
            list.innerHTML = '';
            displaySessions.forEach(session => {
                list.appendChild(this._createHistoryCard(session, callbacks));
            });
        } else {
            // Desktop: render table
            const table = document.createElement('table');
            table.className = 'history-table';
            table.innerHTML = `
                <thead>
                    <tr>
                        <th class="col-indicator"></th>
                        <th class="col-area">Focus Area</th>
                        <th class="col-category">Category</th>
                        <th class="col-duration">Duration</th>
                        <th class="col-time">Finished</th>
                        <th class="col-actions"></th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;
            const tbody = table.querySelector('tbody');

            displaySessions.forEach(session => {
                tbody.appendChild(this._createHistoryRow(session, callbacks));
            });

            list.innerHTML = '';
            list.appendChild(table);
        }
        this._updatePagination(safePage, totalPages, total);
        this._updateSortBtn(sort);
        this._updateActivityLogCount(total);
    }

    static _updateCategoryDropdown(sessions, activeCategory) {
        const select = document.getElementById('historyCategoryFilter');
        if (!select) return;
        const categories = [...new Set(
            sessions.map(s => s.taskCategory).filter(Boolean)
        )].sort();
        select.innerHTML = '<option value="">All Categories</option>' +
            categories.map(c =>
                `<option value="${this._escapeHtml(c)}"${c === activeCategory ? ' selected' : ''}>${this._escapeHtml(c)}</option>`
            ).join('');
    }

    static _updatePagination(page, totalPages, total) {
        const pag = document.getElementById('historyPagination');
        const label = document.getElementById('historyPageLabel');
        const prevBtn = document.getElementById('historyPrevPage');
        const nextBtn = document.getElementById('historyNextPage');
        if (!pag) return;

        pag.style.display = totalPages <= 1 ? 'none' : 'flex';
        if (label) label.textContent = `Page ${page + 1} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = page === 0;
        if (nextBtn) nextBtn.disabled = page >= totalPages - 1;
    }

    static _updateSortBtn(sort) {
        const btn = document.getElementById('historySortBtn');
        if (btn) btn.textContent = sort === 'newest' ? 'Newest ↕' : 'Oldest ↕';
    }

    static _updateActivityLogCount(total) {
        const countEl = document.getElementById('activityLogCount');
        if (countEl) {
            countEl.textContent = total > 0 ? `${total}` : '';
        }
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

    static _isMobile() {
        return window.innerWidth <= 768;
    }

    static _createHistoryRow(session, callbacks) {
        if (this._isMobile()) {
            return this._createHistoryCard(session, callbacks);
        }

        const tr = document.createElement('tr');

        const timeStr = callbacks.formatTimestamp ? callbacks.formatTimestamp(new Date(session.timestamp)) : session.timestamp;
        const durationMin = Math.round(session.duration / 60);

        const moreIcon = '<i class="ph ph-dots-three-vertical"></i>';

        tr.innerHTML = `
            <td class="col-indicator">
                <div class="indicator-dot" style="background: ${session.taskColor || '#58a6ff'}"></div>
            </td>
            <td class="col-area" title="${this._escapeHtml(session.taskName)}">
                ${this._escapeHtml(session.taskName)}
            </td>
            <td class="col-category">
                ${session.taskCategory ? this._escapeHtml(session.taskCategory) : '—'}
            </td>
            <td class="col-duration">
                <i class="ph ph-timer" style="margin-right:4px;opacity:0.7"></i>${durationMin}m
            </td>
            <td class="col-time">
                <i class="ph ph-calendar-check" style="margin-right:4px;opacity:0.7"></i>${timeStr}
            </td>
            <td class="col-actions">
                <button class="action-btn more-btn" aria-label="More actions">
                    ${moreIcon}
                </button>
            </td>
        `;

        const moreBtn = tr.querySelector('.more-btn');
        moreBtn.onclick = (e) => {
            e.stopPropagation();
            this._showSessionPopover(moreBtn, session, callbacks);
        };

        return tr;
    }

    static _createHistoryCard(session, callbacks) {
        const timeStr = callbacks.formatTimestamp ? callbacks.formatTimestamp(new Date(session.timestamp)) : session.timestamp;
        const durationMin = Math.round(session.duration / 60);

        const card = document.createElement('div');
        card.className = 'activity-log-card';

        card.innerHTML = `
            <div class="activity-log-card-row activity-log-card-row-top">
                <div class="activity-log-card-left">
                    <div class="activity-log-card-dot" style="background: ${session.taskColor || '#58a6ff'}"></div>
                    <div class="activity-log-card-title" title="${this._escapeHtml(session.taskName)}">${this._escapeHtml(session.taskName)}</div>
                </div>
                <button class="activity-log-card-more" aria-label="More actions">
                    <i class="ph ph-dots-three-vertical"></i>
                </button>
            </div>
            <div class="activity-log-card-row activity-log-card-row-bottom">
                <span class="activity-log-card-category">
                    ${session.taskCategory ? this._escapeHtml(session.taskCategory) : 'No category'}
                </span>
                <div class="activity-log-card-meta">
                    <span class="activity-log-card-duration">
                        <i class="ph ph-timer"></i> ${durationMin}m
                    </span>
                    <span class="activity-log-card-time">
                        <i class="ph ph-calendar-check"></i> ${timeStr}
                    </span>
                </div>
            </div>
        `;

        const moreBtn = card.querySelector('.activity-log-card-more');
        moreBtn.onclick = (e) => {
            e.stopPropagation();
            this._showSessionPopover(moreBtn, session, callbacks);
        };

        return card;
    }

    static _showSessionPopover(anchorEl, session, callbacks) {
        document.querySelectorAll('.fa-popover').forEach(p => p.remove());

        const popover = document.createElement('div');
        popover.className = 'fa-popover';

        const editBtn = document.createElement('button');
        editBtn.className = 'fa-popover-item';
        editBtn.innerHTML = `<i class="ph ph-pencil"></i><span>Adjust Duration</span>`;
        editBtn.onclick = (e) => {
            e.stopPropagation();
            popover.remove();
            if (callbacks.onEdit) callbacks.onEdit(session);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'fa-popover-item danger';
        deleteBtn.innerHTML = `<i class="ph ph-trash"></i><span>Delete Session</span>`;
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            popover.remove();
            if (callbacks.onDelete) callbacks.onDelete(session.id);
        };

        popover.appendChild(editBtn);
        popover.appendChild(deleteBtn);
        document.body.appendChild(popover);

        const rect = anchorEl.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let top = rect.bottom + 5;
        let left = rect.right - popoverRect.width;

        if (top + popoverRect.height > viewportHeight) {
            top = rect.top - popoverRect.height - 5;
        }

        if (left < 0) {
            left = rect.left;
        }

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;

        const closePopover = (e) => {
            if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
                popover.remove();
                document.removeEventListener('mousedown', closePopover);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closePopover), 0);
    }

    static _updateTrend(elementId, today, yesterday) {
        const el = document.getElementById(elementId);
        if (!el) return;

        if (today === 0) {
            el.innerHTML = '';
            return;
        }

        if (yesterday === 0) {
            el.innerHTML = '<span class="trend-up">↑ 100%</span>';
            return;
        }

        const diff = today - yesterday;
        const percent = Math.abs(Math.round((diff / yesterday) * 100));
        const isUp = diff >= 0;

        if (diff === 0) {
            el.innerHTML = '';
        } else {
            el.innerHTML = `<span class="trend-${isUp ? 'up' : 'down'}">${isUp ? '↑' : '↓'} ${percent}%</span>`;
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

    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
