export class LoopManager {
    lastTime: number = 0;
    animationFrameId: number | null = null;
    isRunning: boolean = false;

    constructor(
        private onUpdate: (dt: number) => void, 
        private onRender: () => void
    ) {}

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    private loop = (timestamp: number) => {
        if (!this.isRunning) return;

        let dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        
        // Cap dt to prevent huge jumps if tab is inactive
        if (dt > 0.1) dt = 0.1;
        if (dt < 0) dt = 0;

        this.onUpdate(dt);
        this.onRender();

        this.animationFrameId = requestAnimationFrame(this.loop);
    };
}