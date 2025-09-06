/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { throttle } from '../utils/throttle';

import './PromptController';
import './PlayPauseButton';
import type { PlaybackState, Prompt, Style } from '../types';
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
      justify-content: center;
      align-items: center;
      box-sizing: border-box;
      position: relative;
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
      margin-top: 8vmin;
    }
    prompt-controller {
      width: 100%;
    }
    play-pause-button {
      position: relative;
      width: 15vmin;
    }
    #buttons {
      position: absolute;
      top: 0;
      left: 0;
      padding: 5px;
      display: flex;
      gap: 5px;
      align-items: center;
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
  `;

  private prompts: Map<string, Prompt>;
  private midiDispatcher: MidiDispatcher;
  private readonly styles: Style[];

  @property({ type: Boolean }) private showMidi = false;
  @property({ type: String }) public playbackState: PlaybackState = 'stopped';
  @property({ type: Boolean }) public isDownloadable = false;
  @state() public audioLevel = 0;
  @state() private midiInputIds: string[] = [];
  @state() private activeMidiInputId: string | null = null;
  @state() private activeStyleName = '';

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
    const selectedStyle = this.styles.find(s => s.name === styleName);

    if (selectedStyle) {
      this.activeStyleName = selectedStyle.name;
      this.prompts = this.buildPromptsForStyle(selectedStyle);
      this.filteredPrompts.clear();
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

  override render() {
    const bg = styleMap({
      backgroundImage: this.makeBackground(),
    });
    return html`<div id="background" style=${bg}></div>
      <div id="buttons">
        <select @change=${this.handleLanguageChange} .value=${document.documentElement.lang || 'en'}>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="ja">日本語</option>
          <option value="de">Deutsch</option>
          <option value="fr">Français</option>
          <option value="ru">Русский</option>
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁體中文</option>
        </select>
        <select @change=${this.handleStyleChange} .value=${this.activeStyleName}>
          ${this.styles.map(style => html`<option value=${style.name}>${t(style.name)}</option>`)}
        </select>
        <button @click=${this.randomizePrompts}>${t('randomize')}</button>
        <button
          @click=${this.toggleShowMidi}
          class=${this.showMidi ? 'active' : ''}
          >${t('midi')}</button
        >
        <button @click=${this.requestDownload} ?disabled=${!this.isDownloadable}>
          ${t('download')}
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
      <div id="grid">${this.renderPrompts()}</div>
      <play-pause-button .playbackState=${this.playbackState} @click=${this.playPause}></play-pause-button>`;
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