/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

@customElement('audio-visualizer')
export class AudioVisualizer extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -2; /* Behind the gradient background */
      pointer-events: none;
    }
    canvas {
      width: 100%;
      height: 100%;
    }
  `;

  @property({ type: Object })
  frequencyData: Uint8Array | null = null;

  @query('canvas')
  private canvas!: HTMLCanvasElement;

  private canvasCtx!: CanvasRenderingContext2D;
  private isPlaying = false;

  override firstUpdated() {
    this.canvasCtx = this.canvas.getContext('2d')!;
    this.resizeCanvas();
    window.addEventListener('resize', this.resizeCanvas.bind(this));
  }

  private resizeCanvas() {
    this.canvas.width = this.canvas.offsetWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.offsetHeight * window.devicePixelRatio;
  }
  
  public play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.draw();
  }
  
  public stop() {
    this.isPlaying = false;
  }

  private draw() {
    if (!this.isPlaying || !this.canvasCtx) {
        if (this.canvasCtx) {
            this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        return;
    }

    requestAnimationFrame(() => this.draw());
    
    if (!this.frequencyData) return;

    const ctx = this.canvasCtx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.22; // Base radius
    const barCount = this.frequencyData.length / 3; // Use a subset for better visual effect
    const angleStep = (2 * Math.PI) / barCount;

    for (let i = 0; i < barCount; i++) {
      const value = this.frequencyData[i];
      const barHeight = (value / 255) * (radius * 0.6);
      const angle = i * angleStep - Math.PI / 2;

      const x1 = centerX + Math.cos(angle) * radius;
      const y1 = centerY + Math.sin(angle) * radius;
      const x2 = centerX + Math.cos(angle) * (radius + barHeight);
      const y2 = centerY + Math.sin(angle) * (radius + barHeight);

      ctx.beginPath();
      ctx.strokeStyle = `hsl(${i * 360 / barCount}, 100%, 75%)`;
      ctx.lineWidth = 3 * window.devicePixelRatio;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  override render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'audio-visualizer': AudioVisualizer;
  }
}
