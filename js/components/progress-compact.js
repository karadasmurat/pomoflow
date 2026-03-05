/**
 * ProgressCompact Web Component
 * A compact, text-based progress indicator using ASCII blocks.
 * 
 * Attributes:
 * - value: Current progress value (number)
 * - max: Target/Goal value (number)
 * - color: Accent color for the filled blocks and text (string)
 * - label: Target duration text (string), e.g. "10m"
 */
class ProgressCompact extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._displayValue = 0;
        this._animationFrame = null;
        
        // Initial structure
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-block;
                    font-family: var(--font-mono, 'JetBrains Mono', monospace);
                    font-size: 11px;
                    letter-spacing: 0.5px;
                    line-height: 1.2;
                }

                .wrapper {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    white-space: nowrap;
                }

                .bar-container {
                    color: var(--text-secondary, #8b949e);
                    display: flex;
                    align-items: center;
                }

                #filledPart {
                    color: var(--primary, #58a6ff);
                }

                .stats {
                    color: var(--text-secondary, #8b949e);
                }

                .percent {
                    font-weight: 700;
                    color: var(--text-primary, #f0f6fc);
                }
            </style>
            <div class="wrapper">
                <div class="bar-container">
                    [<span id="filledPart"></span><span id="emptyPart"></span>]
                </div>
                <div class="stats">
                    <span class="percent" id="percentDisplay">0%</span>
                </div>
            </div>
        `;
        
        this._filledPart = this.shadowRoot.getElementById('filledPart');
        this._emptyPart = this.shadowRoot.getElementById('emptyPart');
        this._percentDisplay = this.shadowRoot.getElementById('percentDisplay');
    }

    static get observedAttributes() {
        return ['value', 'max', 'color', 'label'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            if (name === 'value') {
                this.startAnimation();
            } else {
                this.render();
            }
        }
    }

    connectedCallback() {
        this.startAnimation();
    }

    startAnimation() {
        const targetValue = parseFloat(this.getAttribute('value')) || 0;
        
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
        }

        const duration = 800; // Animation duration in ms
        const startValue = this._displayValue;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function: easeOutCubic
            const ease = 1 - Math.pow(1 - progress, 3);
            
            this._displayValue = startValue + (targetValue - startValue) * ease;
            this.render();

            if (progress < 1) {
                this._animationFrame = requestAnimationFrame(animate);
            } else {
                this._displayValue = targetValue;
                this.render();
            }
        };

        this._animationFrame = requestAnimationFrame(animate);
    }

    render() {
        const value = this._displayValue;
        const max = parseFloat(this.getAttribute('max')) || 100;
        const color = this.getAttribute('color') || 'var(--primary, #58a6ff)';
        
        const rawProgress = max > 0 ? (value / max) * 100 : 0;
        const percent = Math.min(100, Math.round(rawProgress));
        
        // Calculate blocks (10 block scale)
        const barLength = 10;
        const clampedProgress = Math.max(0, Math.min(100, rawProgress));
        const filledCount = Math.max(0, Math.min(barLength, Math.round((clampedProgress / 100) * barLength)));
        const emptyCount = Math.max(0, barLength - filledCount);
        
        const barFilled = '█'.repeat(filledCount);
        const barEmpty = '░'.repeat(emptyCount);

        if (this._filledPart) {
            this._filledPart.textContent = barFilled;
            this._filledPart.style.color = color;
        }
        if (this._emptyPart) {
            this._emptyPart.textContent = barEmpty;
        }
        if (this._percentDisplay) {
            this._percentDisplay.textContent = `${percent}%`;
        }
    }
}

customElements.define('progress-compact', ProgressCompact);
