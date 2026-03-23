import { state } from '../state/store.js';
import { NotificationService } from '../services/notification.service.js';

export class NotificationView {
    constructor() {
        this.panel = document.getElementById('notificationPanel');
        this.list = document.getElementById('notificationList');
        this.emptyState = document.getElementById('notificationEmpty');
        this.closeBtn = document.getElementById('closeNotifications');
        this.clearBtn = document.getElementById('clearNotifications');
        
        // Bell buttons (desktop and mobile)
        this.desktopBtn = document.getElementById('sidenavNotificationsBtn');
        this.mobileBtn = document.getElementById('mobileNotificationsBtn');
        
        // Badges
        this.desktopBadge = document.getElementById('desktopNotificationBadge');
        this.mobileBadge = document.getElementById('mobileNotificationBadge');

        this.init();
    }

    init() {
        if (!this.panel) {
            console.error('NotificationView: Panel not found');
            return;
        }

        // Toggle listeners
        if (this.desktopBtn) {
            this.desktopBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.togglePanel();
            });
        }

        if (this.mobileBtn) {
            this.mobileBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.togglePanel();
            });
        }

        // Close listener
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closePanel());
        }

        // Clear all listener
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clearAll());
        }

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (this.panel.classList.contains('open') && 
                !this.panel.contains(e.target) && 
                !e.target.closest('#sidenavNotificationsBtn') &&
                !e.target.closest('#mobileNotificationsBtn')) {
                this.closePanel();
            }
        });

        this.render();
    }

    togglePanel() {
        const isOpen = this.panel.classList.contains('open');
        if (isOpen) {
            this.closePanel();
        } else {
            this.openPanel();
        }
    }

    async openPanel() {
        this.panel.classList.add('open');
        await NotificationService.markAllAsRead();
        this.render();
    }

    closePanel() {
        this.panel.classList.remove('open');
    }

    async add(msg, type = 'info') {
        const notification = await NotificationService.add(msg, type);
        if (notification) {
            this.render();
            this.showToast(msg, type);
        }
    }

    async remove(id) {
        await NotificationService.dismiss(id);
        this.render();
    }

    async clearAll() {
        await NotificationService.clearAll();
        this.render();
    }

    updateBadge() {
        const unreadCount = state.notifications.filter(n => !n.read).length;
        const show = unreadCount > 0;
        
        if (this.desktopBadge) {
            this.desktopBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            this.desktopBadge.classList.toggle('show', show);
        }
        
        if (this.mobileBadge) {
            this.mobileBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            this.mobileBadge.classList.toggle('show', show);
        }
    }

    showToast(msg, type) {
        const toast = document.createElement('div');
        toast.className = `toast show ${type}`;
        toast.innerHTML = `
            <div class="toast-content">${msg}</div>
            <div class="toast-progress-container">
                <div class="toast-progress"></div>
            </div>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    render() {
        this.renderList();
        this.updateBadge();
    }

    renderList() {
        if (!this.list) return;

        this.list.innerHTML = '';

        if (state.notifications.length === 0) {
            this.list.style.display = 'none';
            this.emptyState.style.display = 'flex';
            return;
        }

        this.list.style.display = 'flex';
        this.emptyState.style.display = 'none';

        state.notifications.forEach(n => {
            const el = document.createElement('div');
            el.className = `notification-item ${n.type} ${n.read ? '' : 'unread'}`;
            
            const iconMap = {
                'success': 'ph-check-circle',
                'warning': 'ph-warning',
                'error': 'ph-x-circle',
                'info': 'ph-info'
            };
            const iconClass = iconMap[n.type] || 'ph-bell';

            const timeString = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            el.innerHTML = `
                <div class="notification-icon"><i class="ph ${iconClass}"></i></div>
                <div class="notification-content">
                    <div class="notification-message">${n.msg}</div>
                    <div class="notification-time">${timeString}</div>
                </div>
                <button class="notification-close" title="Dismiss">
                    <i class="ph ph-x"></i>
                </button>
            `;

            const closeBtn = el.querySelector('.notification-close');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.remove(n.id);
            });

            this.list.appendChild(el);
        });
    }
}
