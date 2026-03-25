import { state } from '../state/store.js';

const TRACK_URLS = {
    shwn: 'https://ejnkxrogljlbyxmxeasw.supabase.co/storage/v1/object/public/sounds/ambientPiano.mp3'
};

class MusicEngine {
    constructor() {
        this.audioCtx = null;
        this.masterGain = null;
        this.activeNodes = [];
        this.isPlaying = false;
        this.currentTrack = null;
        this.youtubeIframe = null;
        this.audioEl = null;
        this.targetVolume = 0.35;
    }

    _initAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = this.targetVolume;
            this.masterGain.connect(this.audioCtx.destination);
        }
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    }

    _stopNodes() {
        this.activeNodes.forEach(n => { try { n.stop(); } catch (e) {} });
        this.activeNodes = [];
    }

    _createWhiteNoiseBuffer() {
        const sr = this.audioCtx.sampleRate;
        const buf = this.audioCtx.createBuffer(1, sr * 2, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return buf;
    }

    _createBrownNoiseBuffer() {
        const sr = this.audioCtx.sampleRate;
        const buf = this.audioCtx.createBuffer(1, sr * 2, sr);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
            const w = Math.random() * 2 - 1;
            data[i] = (last + 0.02 * w) / 1.02;
            last = data[i];
            data[i] *= 3.5;
        }
        return buf;
    }

    _loopBuffer(buffer, ...chain) {
        const src = this.audioCtx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        let node = src;
        for (const next of chain) { node.connect(next); node = next; }
        node.connect(this.masterGain);
        src.start();
        this.activeNodes.push(src);
        return src;
    }

    _playWhite() {
        const buf = this._createWhiteNoiseBuffer();
        const lp = this.audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        this._loopBuffer(buf, lp);
    }

    _playBrown() {
        const buf = this._createBrownNoiseBuffer();
        this._loopBuffer(buf);
    }

    _playRain() {
        // Deep brown layer
        const buf1 = this._createBrownNoiseBuffer();
        const bp1 = this.audioCtx.createBiquadFilter();
        bp1.type = 'bandpass'; bp1.frequency.value = 350; bp1.Q.value = 0.6;
        this._loopBuffer(buf1, bp1);

        // High crackle layer
        const buf2 = this._createWhiteNoiseBuffer();
        const bp2 = this.audioCtx.createBiquadFilter();
        bp2.type = 'bandpass'; bp2.frequency.value = 3200; bp2.Q.value = 1.5;
        const g = this.audioCtx.createGain(); g.gain.value = 0.25;
        this._loopBuffer(buf2, bp2, g);
    }

    _playBinaural() {
        // 40Hz gamma: 200Hz left ear, 240Hz right ear — needs headphones
        const merger = this.audioCtx.createChannelMerger(2);
        merger.connect(this.masterGain);

        [[200, 0], [240, 1]].forEach(([freq, ch]) => {
            const osc = this.audioCtx.createOscillator();
            const g = this.audioCtx.createGain();
            osc.frequency.value = freq;
            g.gain.value = 0.08;
            osc.connect(g);
            g.connect(merger, 0, ch);
            osc.start();
            this.activeNodes.push(osc);
        });
    }

    _playBuiltin(track) {
        this._initAudio();
        this._stopNodes();
        if (track === 'white')    this._playWhite();
        else if (track === 'brown')    this._playBrown();
        else if (track === 'rain')     this._playRain();
        else if (track === 'binaural') this._playBinaural();
    }

    // ── Hosted MP3 ───────────────────────────────────────────────────────────

    _playUrl(url) {
        this._stopUrl();
        const audio = new Audio(url);
        audio.loop = true;
        audio.volume = this.targetVolume;
        audio.play().catch(() => {});
        this.audioEl = audio;
    }

    _stopUrl() {
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.src = '';
            this.audioEl = null;
        }
    }

    // ── YouTube ──────────────────────────────────────────────────────────────

    _extractIds(url) {
        const vid = url.match(/(?:v=|youtu\.be\/)([^&?/]{11})/)?.[1] ?? null;
        const list = url.match(/[?&]list=([^&]+)/)?.[1] ?? null;
        return { vid, list };
    }

    _buildEmbedSrc(url) {
        const { vid, list } = this._extractIds(url);
        if (!vid && !list) return null;
        const base = vid
            ? `https://www.youtube.com/embed/${vid}`
            : `https://www.youtube.com/embed/videoseries`;
        const params = new URLSearchParams({ autoplay: 1, enablejsapi: 1 });
        if (list) params.set('list', list);
        return `${base}?${params}`;
    }

    _postYT(fn) {
        this.youtubeIframe?.contentWindow?.postMessage(
            JSON.stringify({ event: 'command', func: fn, args: [] }), '*'
        );
    }

    playYoutube(url, container) {
        this._stopBuiltin();
        const src = this._buildEmbedSrc(url);
        if (!src) return false;

        if (!this.youtubeIframe) {
            const iframe = document.createElement('iframe');
            iframe.allow = 'autoplay';
            iframe.className = 'music-yt-embed';
            container.appendChild(iframe);
            this.youtubeIframe = iframe;
        }
        this.youtubeIframe.src = src;
        this.isPlaying = true;
        return true;
    }

    _stopYoutube() {
        if (this.youtubeIframe) {
            this.youtubeIframe.src = '';
            this.youtubeIframe.remove();
            this.youtubeIframe = null;
        }
    }

    _stopBuiltin() {
        this._stopNodes();
        if (this.masterGain && this.audioCtx) {
            this.masterGain.gain.cancelScheduledValues(this.audioCtx.currentTime);
            this.masterGain.gain.value = this.targetVolume;
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    play(track) {
        this.currentTrack = track;
        if (!track || track === 'off') return;
        this._stopYoutube();
        this._stopUrl();
        if (TRACK_URLS[track]) {
            this._stopBuiltin();
            this._playUrl(TRACK_URLS[track]);
        } else {
            this._playBuiltin(track);
        }
        this.isPlaying = true;
    }

    pause() {
        if (this.masterGain && this.audioCtx) {
            this.masterGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.8);
        }
        if (this.audioEl) this.audioEl.pause();
        this._postYT('pauseVideo');
        this.isPlaying = false;
    }

    resume() {
        if (this.masterGain && this.audioCtx) {
            this.masterGain.gain.setTargetAtTime(this.targetVolume, this.audioCtx.currentTime, 0.8);
        }
        if (this.audioEl) this.audioEl.play().catch(() => {});
        this._postYT('playVideo');
        this.isPlaying = true;
    }

    stop() {
        this._stopBuiltin();
        this._stopYoutube();
        this._stopUrl();
        this.isPlaying = false;
        this.currentTrack = null;
    }
}

export const musicEngine = new MusicEngine();
