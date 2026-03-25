class MusicEngine {
    constructor() {
        this.audioEl   = null;
        this.isPlaying = false;
        this.isLoading = false;
        this.currentTrack = null;
        this.targetVolume = 0.5;
        this.onPlayStateChange = null;
    }

    get isBusy() { return this.isLoading; }

    async play(url) {
        this.stop();
        this.isLoading = true;
        this.currentTrack = url;
        this.onPlayStateChange?.();
        try {
            const resp = await fetch(url, { mode: 'cors' });
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            const audio = new Audio(objUrl);
            audio.loop = true;
            audio.volume = this.targetVolume;
            audio._objUrl = objUrl;
            audio.addEventListener('play',  () => { this.isLoading = false; this.isPlaying = true;  this.onPlayStateChange?.(); });
            audio.addEventListener('pause', () => {                          this.isPlaying = false; this.onPlayStateChange?.(); });
            this.audioEl = audio;
            await audio.play();
        } catch (e) {
            this.isLoading = false;
            console.warn('[music] failed to load track', e);
            this.onPlayStateChange?.();
        }
    }

    pause()  { this.audioEl?.pause(); }
    resume() { this.audioEl?.play().catch(() => {}); }

    stop() {
        if (this.audioEl) {
            this.audioEl.pause();
            if (this.audioEl._objUrl) URL.revokeObjectURL(this.audioEl._objUrl);
            this.audioEl.src = '';
            this.audioEl = null;
        }
        this.isPlaying = false;
        this.isLoading = false;
        this.currentTrack = null;
        this.onPlayStateChange?.();
    }
}

export const musicEngine = new MusicEngine();
