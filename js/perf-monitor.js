// ==================== 性能监控器 ====================

class PerfMonitor {
    constructor() {
        // FPS
        this.fps = 0;
        this._frameCount = 0;
        this._lastFpsTime = performance.now();
        this._fpsHistory = new Float32Array(60); // 滑动窗口
        this._fpsHistoryIdx = 0;
        this._fpsHistoryFilled = false;

        // 帧时间 (ms)
        this.frameTime = 0;
        this._frameTimeMin = Infinity;
        this._frameTimeMax = 0;

        // 音频延迟
        this.audioLatency = 0;
        this._audioLatencySamples = new Float32Array(30);
        this._audioLatencyIdx = 0;
        this._audioLatencyFilled = false;

        // 渲染统计
        this.visibleNotes = 0;
        this.totalNotes = 0;
        this.drawCalls = 0;

        // DOM 元素
        this._container = null;
        this._fpsEl = null;
        this._latencyEl = null;
        this._frameTimeEl = null;

        this._visible = true;
        this._createDOM();
    }

    _createDOM() {
        const container = document.createElement('div');
        container.id = 'perfMonitor';
        container.innerHTML = `
            <span class="perf-item" id="perfFps">FPS --</span>
            <span class="perf-item" id="perfFt">FT --ms</span>
            <span class="perf-item" id="perfLat">LAT --ms</span>
        `;
        document.body.appendChild(container);
        this._container = container;
        this._fpsEl = document.getElementById('perfFps');
        this._frameTimeEl = document.getElementById('perfFt');
        this._latencyEl = document.getElementById('perfLat');
    }

    /** 每帧开始时调用 */
    beginFrame() {
        this._frameStart = performance.now();
        this.drawCalls = 0;
    }

    /** 每帧结束时调用 */
    endFrame() {
        const now = performance.now();
        this.frameTime = now - this._frameStart;

        // 帧时间统计
        if (this.frameTime < this._frameTimeMin) this._frameTimeMin = this.frameTime;
        if (this.frameTime > this._frameTimeMax) this._frameTimeMax = this.frameTime;

        // FPS 采样
        this._frameCount++;
        const fpsElapsed = now - this._lastFpsTime;
        if (fpsElapsed >= 500) {
            this.fps = Math.round(this._frameCount / (fpsElapsed / 1000));
            this._frameCount = 0;
            this._lastFpsTime = now;

            this._fpsHistory[this._fpsHistoryIdx] = this.fps;
            this._fpsHistoryIdx = (this._fpsHistoryIdx + 1) % 60;
            if (this._fpsHistoryIdx === 0) this._fpsHistoryFilled = true;
        }

        // 每 500ms 更新一次显示
        if (this._fpsEl && fpsElapsed >= 500) {
            this._updateDisplay();
        }
    }

    _updateDisplay() {
        const fpsClass = this.fps >= 55 ? 'perf-good' : this.fps >= 30 ? 'perf-warn' : 'perf-bad';
        if (this._fpsEl) {
            this._fpsEl.textContent = `FPS ${this.fps}`;
            this._fpsEl.className = `perf-item ${fpsClass}`;
        }
        if (this._frameTimeEl) {
            const ft = this.frameTime.toFixed(1);
            const ftClass = this.frameTime < 18 ? 'perf-good' : this.frameTime < 33 ? 'perf-warn' : 'perf-bad';
            this._frameTimeEl.textContent = `FT ${ft}ms`;
            this._frameTimeEl.className = `perf-item ${ftClass}`;
        }
        if (this._latencyEl) {
            const lat = this.audioLatency.toFixed(1);
            const latClass = this.audioLatency < 30 ? 'perf-good' : this.audioLatency < 60 ? 'perf-warn' : 'perf-bad';
            this._latencyEl.textContent = `LAT ${lat}ms`;
            this._latencyEl.className = `perf-item ${latClass}`;
        }
    }

    /** 记录音频延迟采样 */
    recordAudioLatency(latencyMs) {
        if (latencyMs <= 0 || latencyMs > 500) return;
        this._audioLatencySamples[this._audioLatencyIdx] = latencyMs;
        this._audioLatencyIdx = (this._audioLatencyIdx + 1) % 30;
        if (this._audioLatencyIdx === 0) this._audioLatencyFilled = true;

        // 计算平均
        const count = this._audioLatencyFilled ? 30 : this._audioLatencyIdx;
        let sum = 0;
        for (let i = 0; i < count; i++) sum += this._audioLatencySamples[i];
        this.audioLatency = sum / count;
    }

    /** 获取平均 FPS */
    getAverageFps() {
        const count = this._fpsHistoryFilled ? 60 : this._fpsHistoryIdx;
        if (count === 0) return 0;
        let sum = 0;
        for (let i = 0; i < count; i++) sum += this._fpsHistory[i];
        return Math.round(sum / count);
    }

    toggle() {
        this._visible = !this._visible;
        if (this._container) {
            this._container.style.display = this._visible ? 'flex' : 'none';
        }
    }

    show() { this._visible = true; if (this._container) this._container.style.display = 'flex'; }
    hide() { this._visible = false; if (this._container) this._container.style.display = 'none'; }
}

const perfMonitor = new PerfMonitor();
