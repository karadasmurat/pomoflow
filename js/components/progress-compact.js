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
    }

    static get observedAttributes() {
        return ['value', 'max', 'color', 'label'];
    }

    attributeChangedCallback() {
        this.render();
    }

    connectedCallback() {
        this.render();
    }

    render() {
        const value = parseFloat(this.getAttribute('value')) || 0;
        const max = parseFloat(this.getAttribute('max')) || 100;
        const color = this.getAttribute('color') || 'var(--primary, #58a6ff)';
        const label = this.getAttribute('label') || '';
        
        const rawProgress = max > 0 ? (value / max) * 100 : 0;
        const percent = Math.min(100, Math.round(rawProgress));
        
        // Calculate blocks (10 block scale)
        const barLength = 10;
        const filledBlocks = Math.min(barLength, Math.round((rawProgress / 100) * barLength));
        const emptyBlocks = barLength - filledBlocks;
        
        const barFilled = '█'.repeat(filledBlocks);
        const barEmpty = '░'.repeat(emptyBlocks);

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

                .filled {
                    color: ${color};
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
                    [<span class="filled">${barFilled}</span>${barEmpty}]
                </div>
                <div class="stats">
                    <span class="percent">${percent}%</span>
                </div>
            </div>
        `;
    }
}

customElements.define('progress-compact', ProgressCompact);
