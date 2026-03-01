/**
 * ProgressPill Web Component
 * A reusable, encapsulated progress indicator with an overflowing handle.
 * 
 * Attributes:
 * - value: Current progress value (number)
 * - max: Target/Goal value (number)
 * - color: Accent color for the bar and handle (string)
 * - label: Optional text label to display next to the pill (string)
 * 
 * CSS Variables for Theming:
 * - --pill-height: Height of the pill (default: 20px)
 * - --pill-bg: Background of the pill track (default: var(--surface-elevated))
 * - --pill-border: Border of the pill track (default: 1px solid var(--border))
 * - --pill-handle-size: Diameter of the handle (default: 32px)
 * - --pill-track-height: Height of the internal track line (default: 6px)
 */
class ProgressPill extends HTMLElement {
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
        const color = this.getAttribute('color') || '#58a6ff';
        const label = this.getAttribute('label') || '';
        
        const rawProgress = max > 0 ? (value / max) * 100 : 0;
        const displayProgress = Math.min(100, rawProgress);
        const percent = Math.round(rawProgress);

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    --height: var(--pill-height, 20px);
                    --radius: calc(var(--height) / 2);
                    --handle-size: var(--pill-handle-size, 32px);
                    --margin: calc(var(--handle-size) / 2);
                }

                .container {
                    display: flex;
                    align-items: center;
                    width: 100%;
                }

                .track-wrapper {
                    flex: 1;
                    position: relative;
                    height: var(--height);
                    display: flex;
                    align-items: center;
                }

                .slider-area {
                    width: 100%;
                    height: var(--height);
                    background: var(--pill-bg, #21262d);
                    border-radius: var(--radius);
                    position: relative;
                    display: flex;
                    align-items: center;
                    border: var(--pill-border, 1px solid #30363d);
                    overflow: visible;
                }

                .pill-fill {
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    border-radius: var(--radius);
                    pointer-events: none;
                    z-index: 1;
                    opacity: 0.25;
                    width: ${displayProgress}%;
                    background-color: ${color};
                }

                .slider-section {
                    flex: 1;
                    height: 100%;
                    position: relative;
                    display: flex;
                    align-items: center;
                }

                .slider-inner {
                    position: relative;
                    flex: 1;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    margin: 0 var(--margin);
                }

                .track {
                    flex: 1;
                    height: var(--pill-track-height, 6px);
                    background: var(--pill-track-bg, #30363d);
                    border-radius: 3px;
                    overflow: hidden;
                    position: relative;
                }

                .bar {
                    height: 100%;
                    background: ${color};
                    border-radius: 3px;
                    transition: width 0.3s ease;
                    width: ${displayProgress}%;
                }

                .handle {
                    position: absolute;
                    left: ${displayProgress}%;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    width: var(--handle-size);
                    height: var(--handle-size);
                    background: color-mix(in srgb, ${color} 15%, #0d1117);
                    border: 2px solid ${color};
                    border-radius: 50%;
                    z-index: 4;
                    transition: left 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                    color: ${color};
                }

                .percent {
                    font-size: 9px;
                    font-weight: 800;
                    font-family: 'JetBrains Mono', monospace;
                    white-space: nowrap;
                    line-height: 1;
                    letter-spacing: -0.2px;
                }

                .label {
                    font-size: 11px;
                    font-family: 'Roboto', sans-serif;
                    font-weight: 700;
                    color: #8b949e;
                    white-space: nowrap;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    padding-left: 12px;
                    min-width: 45px;
                    letter-spacing: 0.2px;
                }
            </style>
            <div class="container">
                <div class="track-wrapper">
                    <div class="slider-area">
                        <div class="pill-fill"></div>
                        <div class="slider-section">
                            <div class="slider-inner">
                                <div class="track">
                                    <div class="bar"></div>
                                </div>
                                <div class="handle">
                                    <div class="percent">${percent}%</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ${label ? `<span class="label">${label}</span>` : ''}
            </div>
        `;
    }
}

customElements.define('progress-pill', ProgressPill);
