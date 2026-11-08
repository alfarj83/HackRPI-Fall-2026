// Daily totals are separate from the 20-minute / 20-second UI timers.
// Call tick once per animation frame while an up-to-date prediction exists.
const BREAK_MS = 20_000;
const MAX_GAP_MS = 500;

export class HeadCloudStats {
    constructor() {
        this.date = this.today();
        this.data = this.emptyData();
        this.lastTime = null;
        this.lastState = 'unknown';
        this.screenStreak = 0;
        this.awayStreak = 0;
        this.breakRecorded = false;
        this.ready = false;
        this.saving = Promise.resolve();
        this.rollingOver = false;
    }

    today() {
        const d = new Date();
        return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
    }

    emptyData() {
        return { screenMs: 0, awayMs: 0, breaks: 0, longestScreenMs: 0 };
    }

    storageKey(date = this.date) {
        return `headcloud-stats-${date}`;
    }

    async load() {
        const record = await chrome.storage.local.get(this.storageKey());
        this.data = { ...this.emptyData(), ...(record[this.storageKey()] || {}) };
        this.ready = true;
    }

    // Queue writes in order; snapshot at call time so later updates aren't lost.
    save() {
        if (!this.ready) return Promise.resolve();
        const key = this.storageKey();
        const snapshot = { ...this.data };
        this.saving = this.saving.catch(() => {}).then(() =>
            chrome.storage.local.set({ [key]: snapshot })
        );
        return this.saving;
    }

    async rollover() {
        if (this.rollingOver) return;
        this.rollingOver = true;
        this.pause();
        try {
            await this.save();
            this.date = this.today();
            const key = this.storageKey();
            const existing = await chrome.storage.local.get(key);
            this.data = { ...this.emptyData(), ...(existing[key] || {}) };
        } finally {
            this.rollingOver = false;
        }
    }

    tick(state, now = performance.now()) {
        if (!this.ready || this.rollingOver) return;
        if (this.today() !== this.date) {
            void this.rollover().catch(console.error);
            return;
        }

        if (this.lastTime === null) {
            this.lastTime = now;
            this.lastState = state;
            return;
        }

        const elapsed = now - this.lastTime;
        const previous = this.lastState;
        this.lastTime = now;
        this.lastState = state;

        // Only count bounded gaps with the same confirmed state on both ends.
        if (elapsed < 0 || elapsed > MAX_GAP_MS || previous !== state) {
            this.screenStreak = 0;
            this.awayStreak = 0;
            this.breakRecorded = false;
            return;
        }

        if (state === 'likely-screen') {
            this.data.screenMs += elapsed;
            this.screenStreak += elapsed;
            this.awayStreak = 0;
            this.breakRecorded = false;
            this.data.longestScreenMs = Math.max(
                this.data.longestScreenMs, this.screenStreak
            );
        } else if (state === 'likely-away') {
            this.data.awayMs += elapsed;
            this.awayStreak += elapsed;
            this.screenStreak = 0;
            if (this.awayStreak >= BREAK_MS && !this.breakRecorded) {
                this.data.breaks += 1;
                this.breakRecorded = true;
            }
        } else {
            this.screenStreak = 0;
            this.awayStreak = 0;
            this.breakRecorded = false;
        }
    }

    pause() {
        this.lastTime = null;
        this.lastState = 'unknown';
        this.screenStreak = 0;
        this.awayStreak = 0;
        this.breakRecorded = false;
    }

    snapshot() { return { ...this.data }; }
}