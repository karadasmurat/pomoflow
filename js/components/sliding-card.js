/**
 * SlidingCard Web Component
 * A premium, multi-variant card that slides to reveal actions.
 */
class SlidingCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._isOpen = false;
        this._startX = 0;
        this._currentX = 0;
        this._isDragging = false;
        this._dragStartTime = 0;
    }

    static get observedAttributes() {
        return ['menu-width', 'active', 'variant', 'locked'];
    }

    get isOpen() { return this._isOpen; }
    set isOpen(val) {
        this._isOpen = !!val;
        this.updateState();
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal !== newVal) {
            this.updateVariant();
            this.updateState();
        }
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
        this.updateVariant();
        this.updateState();
    }

    setupEventListeners() {
        const wrapper = this.shadowRoot.getElementById('wrapper');
        const moreBtn = this.shadowRoot.getElementById('moreBtn');

        moreBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleMenu();
        };

        wrapper.addEventListener('pointerdown', (e) => {
            // Ignore all internal slide logic if the card is locked (Management Mode)
            if (this.hasAttribute('locked')) return;
            
            if (e.target.closest('.more-btn') || (e.button !== 0 && e.pointerType === 'mouse')) return;
            this.handleDragStart(e.clientX);
            const onMove = (me) => this.handleDragMove(me.clientX, me);
            const onUp = () => {
                this.handleDragEnd();
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });

        wrapper.addEventListener('click', (e) => {
            const dragDist = Math.abs(this._currentX - (this.isOpen ? -parseInt(this.getAttribute('menu-width') || '120') : 0));
            if (dragDist > 10) { e.stopPropagation(); return; }
            if (this.isOpen && !e.target.closest('.more-btn')) {
                this.isOpen = false;
                e.stopPropagation();
            }
        });
    }

    handleDragStart(clientX) {
        this._startX = clientX;
        this._isDragging = true;
        this._dragStartTime = Date.now();
        const wrapper = this.shadowRoot.getElementById('wrapper');
        wrapper.style.transition = 'none';
        wrapper.classList.add('pressing');
        if (wrapper.setPointerCapture) wrapper.setPointerCapture(1);
    }

    handleDragMove(clientX, e) {
        if (!this._isDragging) return;
        const diff = clientX - this._startX;
        const menuWidth = parseInt(this.getAttribute('menu-width') || '120');
        let translate = this.isOpen ? -menuWidth + diff : diff;
        if (translate < -menuWidth) translate = -menuWidth + ((translate + menuWidth) * 0.3);
        else if (translate > 0) translate = translate * 0.3;
        this._currentX = translate;
        this.shadowRoot.getElementById('wrapper').style.transform = `translateX(${translate}px)`;
    }

    handleDragEnd() {
        if (!this._isDragging) return;
        this._isDragging = false;
        const wrapper = this.shadowRoot.getElementById('wrapper');
        wrapper.classList.remove('pressing');
        const menuWidth = parseInt(this.getAttribute('menu-width') || '120');
        const dragDuration = Date.now() - this._dragStartTime;
        const dragDistance = this._currentX - (this.isOpen ? -menuWidth : 0);
        const velocity = dragDistance / Math.max(dragDuration, 1);
        if (Math.abs(velocity) > 0.3 && Math.abs(dragDistance) > 10) this.isOpen = velocity < 0;
        else this.isOpen = this._currentX < -(menuWidth / 2);
        this.updateState();
    }

    updateVariant() {
        const variant = this.getAttribute('variant') || 'glass';
        const container = this.shadowRoot.querySelector('.container');
        if (container) container.className = `container variant-${variant}`;
    }

    toggleMenu() {
        this.isOpen = !this.isOpen;
        this.dispatchEvent(new CustomEvent('toggle', { detail: { isOpen: this.isOpen }, bubbles: true, composed: true }));
    }

    updateState() {
        const wrapper = this.shadowRoot.getElementById('wrapper');
        const moreBtn = this.shadowRoot.getElementById('moreBtn');
        if (!wrapper || !moreBtn) return;
        const menuWidth = this.getAttribute('menu-width') || '120px';
        const widthVal = menuWidth.includes('px') ? menuWidth : `${menuWidth}px`;
        wrapper.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
        if (this._isOpen) {
            wrapper.style.transform = `translateX(-${widthVal})`;
            this.setAttribute('open', '');
            moreBtn.setAttribute('aria-expanded', 'true');
        } else {
            wrapper.style.transform = 'translateX(0)';
            this.removeAttribute('open');
            moreBtn.setAttribute('aria-expanded', 'false');
        }
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block; width: 100%; position: relative;
                    --sc-radius: var(--radius, 12px);
                    --sc-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
                    contain: layout; transform: translateZ(0);
                }
                :host(:hover) { z-index: 100; }
                
                .container {
                    position: relative; border-radius: var(--sc-radius);
                    overflow: visible !important; display: flex; align-items: stretch;
                    margin: 4px 4px;
                    background: transparent; will-change: transform;
                    padding: 2px;
                }

                @media (min-width: 768px) {
                    .container { margin: 8px 12px; }
                }

                .slide-wrapper {
                    position: relative; width: 100%; height: auto; z-index: 2;
                    min-height: 48px;
                    display: flex; align-items: center; padding: 8px 16px; gap: 16px;
                    box-sizing: border-box; cursor: pointer; touch-action: none;
                    user-select: none; -webkit-user-select: none;
                    background: var(--surface, #161b22);
                    border: none !important;
                    border-radius: var(--sc-radius) !important;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
                    transition: transform 0.5s var(--sc-spring), scale 0.2s ease, background-color 0.2s ease;
                }

                /* LOCKED STATE FOR DRAG & DROP */
                :host([locked]) {
                    pointer-events: auto !important;
                }
                :host([locked]) .slide-wrapper {
                    cursor: grab !important;
                    user-select: auto !important;
                    -webkit-user-select: auto !important;
                    touch-action: auto !important;
                }
                :host([locked]) .slide-wrapper:active {
                    cursor: grabbing !important;
                }

                .container.variant-glass .slide-wrapper { background: rgba(255, 255, 255, 0.08) !important; backdrop-filter: blur(20px); }
                .container.variant-bento .slide-wrapper { background: var(--surface-elevated, #21262d) !important; border-radius: calc(var(--sc-radius) * 1.5) !important; }
                .container.variant-skeuo { 
                    background: var(--skeuo-trench, #0f172a) !important; 
                    border: 1px solid var(--border, #30363d) !important;
                    box-shadow: inset 0 2px 8px -4px rgba(0, 0, 0, 0.3) !important; 
                    overflow: hidden !important; 
                }
                .container.variant-skeuo .slide-wrapper { background: var(--skeuo-face, #1c2128) !important; }

                .slide-wrapper:hover { transform: translateY(-2px); }
                .slide-wrapper.pressing { transform: translateY(0); scale: 0.985; }
                :host([active]) .slide-wrapper { background: var(--primary-muted, rgba(88, 166, 255, 0.08)) !important; }

                .menu-container { 
                    position: absolute; top: 0; bottom: 0; right: 0; width: auto; 
                    display: flex; align-items: center; justify-content: flex-end; 
                    z-index: 1; 
                    padding: 0 12px;
                    gap: 6px;
                    opacity: 0; transition: opacity 0.3s ease; 
                }
                :host([open]) .menu-container { opacity: 1; }
                .main-content { flex: 1; min-width: 0; pointer-events: auto; }
                .more-btn { background: rgba(255, 255, 255, 0.05); border: none; color: var(--text-secondary, #8b949e); cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease; pointer-events: auto; }
                .more-btn:hover { background: rgba(255, 255, 255, 0.1); color: var(--text-primary, #ffffff); transform: rotate(90deg); }
                
                ::slotted([slot="menu"]) {
                    margin: 0 !important;
                    padding: 2px 1px !important;
                    border: none !important;
                    background: rgba(255, 255, 255, 0.03) !important;
                    width: 44px !important;
                    height: 44px !important;
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    justify-content: center !important;
                    border-radius: 8px !important;
                    color: var(--text-secondary) !important;
                    font-size: 7px !important;
                    font-weight: 600 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 0.1px !important;
                    transition: all 0.2s var(--sc-fast) !important;
                    cursor: pointer !important;
                    flex-shrink: 0 !important;
                    pointer-events: auto;
                }
                ::slotted([slot="menu"]:hover) { color: var(--primary, #58a6ff) !important; background: rgba(88, 166, 255, 0.15) !important; transform: translateY(-1px) !important; }
                ::slotted([slot="menu"].danger:hover) { color: #ff7b72 !important; background: rgba(248, 81, 73, 0.15) !important; }
                ::slotted([slot="indicator"]) { flex-shrink: 0; }
            </style>
            <div class="container">
                <div class="menu-container" aria-hidden="true"><slot name="menu"></slot></div>
                <div class="slide-wrapper" id="wrapper" role="button" tabindex="0">
                    <slot name="indicator"></slot>
                    <div class="main-content"><slot></slot></div>
                    <button class="more-btn" id="moreBtn" aria-label="Toggle actions" aria-haspopup="true" aria-expanded="false">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM1.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm13 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>
                    </button>
                </div>
            </div>
        `;
    }
}
customElements.define('sliding-card', SlidingCard);
