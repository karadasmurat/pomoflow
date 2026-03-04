/**
 * SlidingCard Web Component
 * A reusable card that slides to reveal a menu of actions.
 * Supports click-to-toggle and swipe-to-reveal.
 * 
 * Attributes:
 * - menu-width: Width of the hidden menu (default: 120px)
 * - active: Highlighted state (for active focus areas)
 */
class SlidingCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._isOpen = false;
        this._startX = 0;
        this._currentX = 0;
        this._isDragging = false;
    }

    static get observedAttributes() {
        return ['menu-width', 'active'];
    }

    get isOpen() { return this._isOpen; }
    set isOpen(val) {
        this._isOpen = !!val;
        this.updateState();
    }

    attributeChangedCallback() {
        this.render();
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const wrapper = this.shadowRoot.getElementById('wrapper');
        const moreBtn = this.shadowRoot.getElementById('moreBtn');

        moreBtn.onclick = (e) => {
            e.stopPropagation();
            this.isOpen = !this.isOpen;
            this.dispatchEvent(new CustomEvent('toggle', { detail: { isOpen: this.isOpen } }));
        };

        // Touch support
        wrapper.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        wrapper.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        wrapper.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        
        // Close if clicking elsewhere in the component's content (optional behavior)
        wrapper.onclick = (e) => {
            if (this.isOpen && e.target !== moreBtn) {
                this.isOpen = false;
            }
        };
    }

    handleTouchStart(e) {
        this._startX = e.touches[0].clientX;
        this._isDragging = true;
        this.shadowRoot.getElementById('wrapper').style.transition = 'none';
    }

    handleTouchMove(e) {
        if (!this._isDragging) return;
        const x = e.touches[0].clientX;
        const diff = x - this._startX;
        const menuWidth = parseInt(this.getAttribute('menu-width') || '120');
        
        // Only allow dragging to the left
        let translate = this.isOpen ? -menuWidth + diff : diff;
        translate = Math.max(-menuWidth - 20, Math.min(0, translate)); // Add some resistance
        
        this._currentX = translate;
        this.shadowRoot.getElementById('wrapper').style.transform = `translateX(${translate}px)`;
        
        // Prevent vertical scroll if swiping horizontally
        if (Math.abs(diff) > 5) {
            e.preventDefault();
        }
    }

    handleTouchEnd() {
        if (!this._isDragging) return;
        this._isDragging = false;
        const wrapper = this.shadowRoot.getElementById('wrapper');
        const menuWidth = parseInt(this.getAttribute('menu-width') || '120');
        wrapper.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

        const threshold = menuWidth / 2;
        if (this.isOpen) {
            // If open, close if swiped right enough
            this.isOpen = this._currentX < -threshold;
        } else {
            // If closed, open if swiped left enough
            this.isOpen = this._currentX < -threshold;
        }
        this.updateState();
    }

    updateState() {
        const wrapper = this.shadowRoot.getElementById('wrapper');
        const menuWidth = this.getAttribute('menu-width') || '120px';
        const widthVal = menuWidth.includes('px') ? menuWidth : `${menuWidth}px`;
        
        if (this._isOpen) {
            wrapper.style.transform = `translateX(-${widthVal})`;
            this.setAttribute('open', '');
        } else {
            wrapper.style.transform = 'translateX(0)';
            this.removeAttribute('open');
        }
    }

    render() {
        const menuWidth = this.getAttribute('menu-width') || '120px';
        const isActive = this.hasAttribute('active');

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    position: relative;
                    --card-bg: var(--bg, #0d1117);
                    --card-border: var(--border, #30363d);
                    --card-radius: 12px;
                    --active-color: var(--primary, #58a6ff);
                }

                .container {
                    position: relative;
                    min-height: 64px;
                    background: var(--surface-elevated, #161b22);
                    border-radius: var(--card-radius);
                    overflow: hidden;
                    display: flex;
                    align-items: stretch;
                }

                .menu-container {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    right: 0;
                    width: ${menuWidth};
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    z-index: 1;
                    padding: 0 2px;
                    box-sizing: border-box;
                    gap: 2px;
                }

                .slide-wrapper {
                    position: relative;
                    width: 100%;
                    background: var(--card-bg);
                    border: 1px solid transparent;
                    border-radius: var(--card-radius);
                    display: flex;
                    align-items: center;
                    padding: 10px 12px;
                    gap: 12px;
                    z-index: 2;
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s ease, box-shadow 0.2s ease;
                    box-sizing: border-box;
                    touch-action: pan-y;
                }

                :host([active]) .slide-wrapper {
                    /* Removed border and shadow that caused vertical line artifact */
                }

                .slide-wrapper:hover {
                    border-color: var(--text-secondary, #8b949e);
                }

                .main-content {
                    flex: 1;
                    min-width: 0;
                }

                .more-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary, #8b949e);
                    cursor: pointer;
                    padding: 8px;
                    border-radius: 4px;
                    opacity: 0.7;
                    transition: opacity 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    flex-shrink: 0;
                }

                .more-btn:hover {
                    opacity: 1;
                    background: var(--surface-elevated, #161b22);
                }

                /* Slot specific styles - Decisive Reset & Precision */
                ::slotted([slot="menu"]) {
                    /* Reset & Layout */
                    margin: 0 !important;
                    padding: 0 !important;
                    border: none !important;
                    outline: none !important;
                    background: transparent !important;
                    box-shadow: none !important;
                    flex: 1 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    justify-content: center !important;
                    gap: 2px !important;
                    cursor: pointer !important;
                    transition: all 0.2s ease !important;
                    border-radius: 10px !important;
                }

                ::slotted([slot="menu"]:hover) {
                    background: var(--surface-elevated, #161b22) !important;
                }

                ::slotted([slot="menu"].danger:hover) {
                    background: rgba(248, 81, 73, 0.1) !important;
                }

                ::slotted([slot="indicator"]) {
                    flex-shrink: 0;
                }
            </style>
            <div class="container">
                <div class="menu-container">
                    <slot name="menu"></slot>
                </div>
                <div class="slide-wrapper" id="wrapper">
                    <slot name="indicator"></slot>
                    <div class="main-content">
                        <slot></slot>
                    </div>
                    <button class="more-btn" id="moreBtn" aria-label="Toggle menu">⋮</button>
                </div>
            </div>
        `;
        this.updateState();
    }
}

customElements.define('sliding-card', SlidingCard);
