/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { throttle } from '../utils/throttle';

import './PromptController';
import './PlayPauseButton';
import './AudioVisualizer';
import type { AudioVisualizer } from './AudioVisualizer';
import type { AnalysisResponse, PlaybackState, Prompt, Style } from '../types';
import { MidiDispatcher } from '../utils/MidiDispatcher';
import { t, setLanguage } from '../utils/i18n';

/** The grid of prompt inputs. */
@customElement('prompt-dj-midi')
export class PromptDjMidi extends LitElement {
  static override styles = css`
    :host {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      box-sizing: border-box;
      position: relative;
      padding-top: 8vmin;
    }
    #background {
      will-change: background-image;
      position: absolute;
      height: 100%;
      width: 100%;
      z-index: -1;
      background: #111;
    }
    #grid {
      width: 80vmin;
      height: 80vmin;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2.5vmin;
      position: relative;
    }
    prompt-controller {
      width: 100%;
    }
    play-pause-button {
      position: absolute;
      width: 15vmin;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10;
    }
    #buttons {
      position: absolute;
      top: 0;
      left: 0;
      padding: 5px;
      display: flex;
      gap: 5px;
      align-items: center;
      flex-wrap: wrap;
    }
    button {
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      background: #0002;
      -webkit-font-smoothing: antialiased;
      border: 1.5px solid #fff;
      border-radius: 4px;
      user-select: none;
      padding: 3px 6px;
      &.active {
        background-color: #fff;
        color: #000;
      }
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
    select {
      font: inherit;
      padding: 5px;
      background: #fff;
      color: #000;
      border-radius: 4px;
      border: none;
      outline: none;
      cursor: pointer;
      -webkit-font-smoothing: antialiased;
      font-weight: 600;
    }
    #image-controls, #audio-controls {
      display: flex;
      gap: 5px;
      align-items: center;
    }
    #image-preview {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      object-fit: cover;
      border: 1px solid #fff8;
    }
    #image-upload-input, #audio-upload-input {
      display: none;
    }
    .clear-btn {
      padding: 0;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      line-height: 1;
      font-size: 14px;
      font-weight: bold;
    }
    #footer-controls {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-top: auto;
      padding-bottom: 2vmin;
      width: 100%;
    }
    #chat-container {
      display: flex;
      gap: 10px;
      width: 80%;
      max-width: 600px;
      padding: 10px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    }
    #chat-input {
      flex-grow: 1;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 5px;
      color: white;
      padding: 8px 12px;
      font-size: 1.8vmin;
      outline: none;
    }
    #chat-input::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }
  `;

  private prompts: Map<string, Prompt>;
  private midiDispatcher: MidiDispatcher;
  private readonly styles: Style[];
  private readonly allPromptsMap: Map<string, { color: string, text: string }>;

  @property({ type: Boolean }) private showMidi = false;
  @property({ type: String }) public playbackState: PlaybackState = 'stopped';
  @property({ type: Boolean }) public isDownloadable = false;
  @state() public audioLevel = 0;
  @state() private midiInputIds: string[] = [];
  @state() private activeMidiInputId: string | null = null;
  @state() private activeStyleName = '';
  @state() private isAnalyzing = false;
  @state() private imagePreviewUrl: string | null = null;
  @state() private isDownloadingLoop = false;
  @state() private chatPrompt = '';
  @state() private isProcessingChat = false;
  
  @property({ type: Object }) public frequencyData: Uint8Array | null = null;
  @query('audio-visualizer') private visualizer!: AudioVisualizer;

  @property({ attribute: false }) 
  analyzeImage!: (imageData: {data: string, mimeType: string}, styles: Style[]) => Promise<AnalysisResponse>;

  @property({ attribute: false }) 
  analyzeAudio!: (audioData: {data: string, mimeType: string}, styles: Style[]) => Promise<AnalysisResponse>;

  @property({ attribute: false })
  generatePromptsFromText!: (userPrompt: string, styles: Style[]) => Promise<AnalysisResponse>;

  @property({ type: Object })
  private filteredPrompts = new Set<string>();
  
  private readonly rerender = () => this.requestUpdate();

  constructor(
    initialPrompts: Map<string, Prompt>,
    styles: Style[],
  ) {
    super();
    this.prompts = initialPrompts;
    this.midiDispatcher = new MidiDispatcher();
    this.styles = styles;
    if (this.styles.length > 0) {
      this.activeStyleName = this.styles[0].name;
    }

    this.allPromptsMap = new Map();
    styles.forEach(style => {
        style.prompts.forEach(prompt => {
            this.allPromptsMap.set(prompt.text, prompt);
        });
    });
  }

  override connectedCallback() {
    super.connectedCallback();
    this.midiDispatcher.addEventListener('midi-devices-changed', this.refreshMidiDevices);
    window.addEventListener('language-changed', this.rerender);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.midiDispatcher.removeEventListener('midi-devices-changed', this.refreshMidiDevices);
    window.removeEventListener('language-changed', this.rerender);
  }

  override updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has('playbackState')) {
      if (this.playbackState === 'playing') {
        this.visualizer?.play();
      } else {
        this.visualizer?.stop();
      }
    }
  }

  private handlePromptChanged(e: CustomEvent<Prompt>) {
    const { promptId, text, weight, cc } = e.detail;
    const prompt = this.prompts.get(promptId);

    if (!prompt) {
      console.error('prompt not found', promptId);
      return;
    }

    // The text from the prompt controller will be translated. We need to find the key.
    // This is a bit of a hack, but for now we assume if the text doesn't match a translation
    // it's a custom prompt. In that case, the text itself is the key.
    // A better solution would be a reverse lookup map. For now, this works for editing.
    // The main flow uses keys, which is robust.
    const currentTranslatedText = t(prompt.text);
    if (text !== currentTranslatedText) {
      prompt.text = text; // The text is now a custom string, not a key
    }
    
    prompt.weight = weight;
    prompt.cc = cc;

    const newPrompts = new Map(this.prompts);
    newPrompts.set(promptId, prompt);

    this.prompts = newPrompts;
    this.requestUpdate();

    this.dispatchEvent(
      new CustomEvent('prompts-changed', { detail: this.prompts }),
    );
  }

  /** Generates radial gradients for each prompt based on weight and color. */
  private readonly makeBackground = throttle(
    () => {
      const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

      const MAX_WEIGHT = 0.5;
      const MAX_ALPHA = 0.6;

      const bg: string[] = [];

      [...this.prompts.values()].forEach((p, i) => {
        const alphaPct = clamp01(p.weight / MAX_WEIGHT) * MAX_ALPHA;
        const alpha = Math.round(alphaPct * 0xff)
          .toString(16)
          .padStart(2, '0');

        const stop = p.weight / 2;
        const x = (i % 4) / 3;
        const y = Math.floor(i / 4) / 3;
        const s = `radial-gradient(circle at ${x * 100}% ${y * 100}%, ${p.color}${alpha} 0px, ${p.color}00 ${stop * 100}%)`;

        bg.push(s);
      });

      return bg.join(', ');
    },
    30, // don't re-render more than once every XXms
  );

  private toggleShowMidi() {
    return this.setShowMidi(!this.showMidi);
  }

  public async setShowMidi(show: boolean) {
    this.showMidi = show;
    if (!this.showMidi) return;
    await this.refreshMidiDevices();
  }

  private readonly refreshMidiDevices = async () => {
    try {
      const inputIds = await this.midiDispatcher.getMidiAccess();
      this.midiInputIds = inputIds;
      this.activeMidiInputId = this.midiDispatcher.activeMidiInputId;
    } catch (e: any) {
      this.showMidi = false;
      this.dispatchEvent(new CustomEvent('error', {detail: e.message}));
    }
  }

  private handleMidiInputChange(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const newMidiId = selectElement.value;
    this.activeMidiInputId = newMidiId;
    this.midiDispatcher.activeMidiInputId = newMidiId;
  }

  private buildPromptsForStyle(style: Style): Map<string, Prompt> {
    const defaultPrompts = style.prompts;
    const startOn = [...defaultPrompts]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    const prompts = new Map<string, Prompt>();
    for (let i = 0; i < defaultPrompts.length; i++) {
      const promptId = `prompt-${i}`;
      const prompt = defaultPrompts[i];
      const { text, color } = prompt;
      prompts.set(promptId, {
        promptId,
        text,
        weight: startOn.includes(prompt) ? 1 : 0,
        cc: i,
        color,
      });
    }
    return prompts;
  }
  
  private handleStyleChange(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const styleName = selectElement.value;
    
    if (styleName === 'style_analysis_mix') return;

    const selectedStyle = this.styles.find(s => s.name === styleName);

    if (selectedStyle) {
      this.activeStyleName = selectedStyle.name;
      this.prompts = this.buildPromptsForStyle(selectedStyle);
      this.filteredPrompts.clear();
      this.clearImage();
      this.requestUpdate();
      this.dispatchEvent(
        new CustomEvent('prompts-changed', { detail: this.prompts }),
      );
    }
  }

  private handleLanguageChange(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    setLanguage(selectElement.value);
  }

  private randomizePrompts() {
    const newPrompts = new Map(this.prompts);
    this.clearImage();
  
    // Reset all weights to 0
    newPrompts.forEach((prompt) => {
      prompt.weight = 0;
    });
  
    // Pick 2 to 4 prompts to activate
    const numToActivate = Math.floor(Math.random() * 3) + 2;
    const promptsToActivate = [...newPrompts.values()]
      .sort(() => 0.5 - Math.random())
      .slice(0, numToActivate);
  
    // Set a random weight for each chosen prompt
    promptsToActivate.forEach((prompt) => {
      // Random weight between 0.5 and 1.5 to ensure it's audible
      prompt.weight = 0.5 + Math.random();
    });
  
    this.prompts = newPrompts;
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent('prompts-changed', { detail: this.prompts }),
    );
  }

  private playPause() {
    this.dispatchEvent(new CustomEvent('play-pause'));
  }

  private requestDownload() {
    this.dispatchEvent(new CustomEvent('download-requested'));
  }

  public addFilteredPrompt(promptKey: string) {
    this.filteredPrompts = new Set([...this.filteredPrompts, promptKey]);
  }

  private triggerImageUpload() {
    this.shadowRoot?.getElementById('image-upload-input')?.click();
  }

  private async handleImageSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const file = input.files[0];
    
    if (this.imagePreviewUrl) {
      URL.revokeObjectURL(this.imagePreviewUrl);
    }
    this.imagePreviewUrl = URL.createObjectURL(file);

    this.isAnalyzing = true;
    try {
      const base64Data = await this.blobToBase64(file);
      const analysisResult = await this.analyzeImage(
        { data: base64Data, mimeType: file.type },
        this.styles
      );

      this.updatePromptsFromAnalysis(analysisResult);

    } catch (err) {
      console.error(err);
      this.dispatchEvent(new CustomEvent('error', { detail: 'analysisFailedError' }));
    } finally {
      this.isAnalyzing = false;
      input.value = '';
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private updatePromptsFromAnalysis(result: AnalysisResponse) {
    if (!result.prompts || result.prompts.length === 0) {
        console.warn('Analysis returned no prompts.');
        this.dispatchEvent(new CustomEvent('error', { detail: 'analysisFailedError' }));
        return;
    }

    const newPrompts = new Map<string, Prompt>();
    const usedPromptKeys = new Set<string>();

    // Add prompts from analysis result
    result.prompts.slice(0, 16).forEach(p => {
        const promptDef = this.allPromptsMap.get(p.text);
        if (promptDef) {
            const promptId = `prompt-${newPrompts.size}`;
            newPrompts.set(promptId, {
                promptId,
                text: promptDef.text,
                weight: p.weight,
                cc: newPrompts.size,
                color: promptDef.color,
            });
            usedPromptKeys.add(promptDef.text);
        }
    });

    // Fill remaining slots if necessary
    if (newPrompts.size < 16) {
        for (const promptDef of this.allPromptsMap.values()) {
            if (!usedPromptKeys.has(promptDef.text)) {
                const promptId = `prompt-${newPrompts.size}`;
                 newPrompts.set(promptId, {
                    promptId,
                    text: promptDef.text,
                    weight: 0,
                    cc: newPrompts.size,
                    color: promptDef.color,
                });
                if (newPrompts.size >= 16) break;
            }
        }
    }

    this.activeStyleName = 'style_analysis_mix';
    this.prompts = newPrompts;
    this.filteredPrompts.clear();
    this.requestUpdate();
    this.dispatchEvent(new CustomEvent('prompts-changed', { detail: this.prompts }));
  }

  private clearImage() {
    if (this.imagePreviewUrl) {
      URL.revokeObjectURL(this.imagePreviewUrl);
    }
    this.imagePreviewUrl = null;
  }

  private triggerAudioUpload() {
    this.shadowRoot?.getElementById('audio-upload-input')?.click();
  }

  private async handleAudioFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const file = input.files[0];
    
    this.isAnalyzing = true;
    try {
      const base64Data = await this.blobToBase64(file);
      const analysisResult = await this.analyzeAudio(
        { data: base64Data, mimeType: file.type },
        this.styles
      );
      this.updatePromptsFromAnalysis(analysisResult);
    } catch (err) {
      console.error(err);
      this.dispatchEvent(new CustomEvent('error', { detail: 'audioAnalysisFailedError' }));
    } finally {
      this.isAnalyzing = false;
      input.value = '';
    }
  }

  private get hasActivePrompts(): boolean {
    return [...this.prompts.values()].some(p => p.weight > 0);
  }

  private requestLoopDownload() {
    if (this.isDownloadingLoop) return;
    this.dispatchEvent(new CustomEvent('loop-download-requested'));
  }

  public startLoopDownload() {
    this.isDownloadingLoop = true;
  }

  public finishLoopDownload() {
    this.isDownloadingLoop = false;
  }

  private handleChatKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.handleChatSubmit();
    }
  }

  private async handleChatSubmit() {
    if (this.isProcessingChat || !this.chatPrompt.trim()) return;

    this.isProcessingChat = true;
    try {
      const analysisResult = await this.generatePromptsFromText(this.chatPrompt, this.styles);
      this.updatePromptsFromAnalysis(analysisResult);
      this.chatPrompt = '';
    } catch (err) {
      console.error(err);
      this.dispatchEvent(new CustomEvent('error', { detail: 'chatRequestFailedError' }));
    } finally {
      this.isProcessingChat = false;
    }
  }

  override render() {
    const bg = styleMap({
      backgroundImage: this.makeBackground(),
    });
    return html`
      <audio-visualizer .frequencyData=${this.frequencyData}></audio-visualizer>
      <div id="background" style=${bg}></div>
      <div id="buttons">
        <select @change=${this.handleLanguageChange} .value=${document.documentElement.lang || 'en'}>
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
        <select @change=${this.handleStyleChange} .value=${this.activeStyleName}>
          ${this.activeStyleName === 'style_analysis_mix' ? html`<option value="style_analysis_mix">${t('style_analysis_mix')}</option>`: ''}
          ${this.styles.map(style => html`<option value=${style.name}>${t(style.name)}</option>`)}
        </select>
        <button @click=${this.randomizePrompts}>${t('randomize')}</button>
        <div id="audio-controls">
          <input type="file" id="audio-upload-input" accept="audio/*" @change=${this.handleAudioFileSelected}>
          <button @click=${this.triggerAudioUpload} ?disabled=${this.isAnalyzing}>
            ${this.isAnalyzing ? t('analyzing') : t('analyzeAudio')}
          </button>
        </div>
        <div id="image-controls">
          <input type="file" id="image-upload-input" accept="image/*" @change=${this.handleImageSelected}>
          <button @click=${this.triggerImageUpload} ?disabled=${this.isAnalyzing}>
            ${this.isAnalyzing ? t('analyzing') : t('analyzeImage')}
          </button>
          ${this.imagePreviewUrl ? html`
            <img id="image-preview" src=${this.imagePreviewUrl} alt="Image preview"/>
            <button @click=${this.clearImage} class="clear-btn" title=${t('clearImage')}>✕</button>
          ` : ''}
        </div>
        <button
          @click=${this.toggleShowMidi}
          class=${this.showMidi ? 'active' : ''}
          >${t('midi')}</button
        >
        <button @click=${this.requestDownload} ?disabled=${!this.isDownloadable}>
          ${t('download')}
        </button>
        <button @click=${this.requestLoopDownload} ?disabled=${this.isDownloadingLoop || !this.hasActivePrompts}>
          ${this.isDownloadingLoop ? t('downloadingLoop') : t('downloadLoop')}
        </button>
        <select
          @change=${this.handleMidiInputChange}
          .value=${this.activeMidiInputId || ''}
          style=${this.showMidi ? '' : 'visibility: hidden'}>
          ${this.midiInputIds.length > 0
        ? this.midiInputIds.map(
          (id) =>
            html`<option value=${id}>
                    ${this.midiDispatcher.getDeviceName(id)}
                  </option>`,
        )
        : html`<option value="">${t('noMidiDevices')}</option>`}
        </select>
      </div>
      <div id="grid">
        ${this.renderPrompts()}
        <play-pause-button .playbackState=${this.playbackState} @click=${this.playPause}></play-pause-button>
      </div>
      <div id="footer-controls">
        <div id="chat-container">
          <input
            id="chat-input"
            type="text"
            placeholder=${t('chatPlaceholder')}
            .value=${this.chatPrompt}
            @input=${(e: Event) => this.chatPrompt = (e.target as HTMLInputElement).value}
            @keydown=${this.handleChatKeyDown}
            ?disabled=${this.isProcessingChat}
          />
          <button
            id="chat-submit"
            @click=${this.handleChatSubmit}
            ?disabled=${this.isProcessingChat || !this.chatPrompt.trim()}
          >
            ${this.isProcessingChat ? t('chatSubmitLoading') : t('chatSubmit')}
          </button>
        </div>
      </div>
      `;
  }

  private renderPrompts() {
    return [...this.prompts.values()].map((prompt) => {
      return html`<prompt-controller
        promptId=${prompt.promptId}
        ?filtered=${this.filteredPrompts.has(prompt.text)}
        cc=${prompt.cc}
        text=${t(prompt.text)}
        weight=${prompt.weight}
        color=${prompt.color}
        .midiDispatcher=${this.midiDispatcher}
        .showCC=${this.showMidi}
        audioLevel=${this.audioLevel}
        @prompt-changed=${this.handlePromptChanged}>
      </prompt-controller>`;
    });
  }
}