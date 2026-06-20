// Canvas Renderer - All drawing functions
class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.trackStartX = 0;
        this.resize();
    }
    
    resize() {
        this.canvasWidth = window.innerWidth;
        this.canvasHeight = window.innerHeight;
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        
        const totalTrackWidth = CONFIG.trackCount * CONFIG.trackWidth + (CONFIG.trackCount - 1) * 8;
        this.trackStartX = (this.canvasWidth - totalTrackWidth) / 2;
    }
    
    drawBackground(time) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(UI_SCALE, UI_SCALE);
        
        const w = this.canvasWidth / UI_SCALE;
        const h = this.canvasHeight / UI_SCALE;
        
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#1e1e2e');
        grad.addColorStop(1, '#2d2d44');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        
        // Stars/particles
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 30; i++) {
            const sx = (i * 137) % w;
            const sy = ((i * 251) % h) + (time * 0.01) % 20;
            const size = (i % 3 === 0) ? 2 : 1;
            ctx.fillRect(sx, sy, size, size);
        }
        
        ctx.restore();
    }
    
    drawTracks() {
        const ctx = this.ctx;
        const judgmentY = this.canvasHeight * CONFIG.judgmentLineY;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        
        for (let i = 0; i < CONFIG.trackCount; i++) {
            const x = this.trackStartX + i * (CONFIG.trackWidth + 8);
            
            // Track line
            ctx.beginPath();
            ctx.setLineDash([5, 10]);
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvasHeight);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Key indicator
            const keyY = this.canvasHeight - 60;
            const isPressed = gameState.pressedKeys.has(KEYS[i]);
            
            if (isPressed) {
                ctx.fillStyle = TRACK_COLORS[i];
                ctx.globalAlpha = 0.5;
                ctx.fillRect(x, keyY, CONFIG.trackWidth, 40);
                ctx.globalAlpha = 1.0;
            }
            
            ctx.strokeStyle = TRACK_COLORS[i];
            ctx.strokeRect(x, keyY, CONFIG.trackWidth, 40);
            
            // Key label
            ctx.save();
            ctx.translate(x + CONFIG.trackWidth / 2, keyY + 28);
            ctx.scale(UI_SCALE, UI_SCALE);
            ctx.fillStyle = isPressed ? '#000' : TRACK_COLORS[i];
            ctx.font = '20px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.fillText(TRACK_KEYS[i], 0, 0);
            ctx.restore();
        }
        
        // Judgment line
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(
            this.trackStartX - 10,
            judgmentY - 2,
            (CONFIG.trackWidth * 4) + (8 * 3) + 20,
            4
        );
    }
    
    drawNotes(currentTime) {
        const judgmentY = this.canvasHeight * CONFIG.judgmentLineY;
        const speedMultiplier = noteSpeed * 100;
        
        for (const note of gameState.notes) {
            if (note.hit) continue;
            
            const timeDiff = note.time - currentTime;
            const y = judgmentY - (timeDiff / 1000) * speedMultiplier;
            
            // Missed notes that went past screen
            if (y > this.canvasHeight + 100) {
                if (!note.missed) {
                    note.missed = true;
                    gameState.miss++;
                    gameState.intervalStats.miss++;
                    gameState.combo = 0;
                    gameState.health = Math.max(0, gameState.health - 10);
                    this.createMissEffect(judgmentY, note.track);
                    audioEngine.playHitSound('miss');
                }
                continue;
            }
            
            if (y < -50) continue;
            
            note.y = y;
            const x = this.trackStartX + note.track * (CONFIG.trackWidth + 8);
            
            if (noteStyle === 'orb') {
                this.drawOrbNote(x, y, TRACK_COLORS[note.track]);
            } else {
                this.drawPixelNote(x, y, TRACK_COLORS[note.track]);
            }
        }
    }
    
    drawPixelNote(x, y, color) {
        const ctx = this.ctx;
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = color;
        ctx.fillRect(x + 2, y, CONFIG.trackWidth - 4, 24);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(x + 2, y, CONFIG.trackWidth - 4, 4);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x + 2, y + 20, CONFIG.trackWidth - 4, 4);
    }
    
    drawOrbNote(x, y, color) {
        const ctx = this.ctx;
        ctx.imageSmoothingEnabled = true;
        const centerX = x + CONFIG.trackWidth / 2;
        const centerY = y + 12;
        const radiusX = 31.2;
        const radiusY = 28.6;
        
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.imageSmoothingEnabled = false;
    }
    
    drawLasers() {
        for (let i = gameState.lasers.length - 1; i >= 0; i--) {
            const laser = gameState.lasers[i];
            laser.height += 15;
            laser.alpha -= 0.05;
            
            if (laser.alpha <= 0) {
                gameState.lasers.splice(i, 1);
                continue;
            }
            
            this.ctx.globalAlpha = laser.alpha;
            this.ctx.fillStyle = laser.color;
            const startY = this.canvasHeight * CONFIG.judgmentLineY;
            this.ctx.fillRect(laser.x - laser.width / 2, startY - laser.height, laser.width, laser.height);
        }
        this.ctx.globalAlpha = 1.0;
    }
    
    drawParticles() {
        for (let i = gameState.particles.length - 1; i >= 0; i--) {
            const p = gameState.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.05;
            
            if (p.life <= 0) {
                gameState.particles.splice(i, 1);
                continue;
            }
            
            this.ctx.globalAlpha = p.life;
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(p.x, p.y, p.size, p.size);
        }
        this.ctx.globalAlpha = 1.0;
    }
    
    drawJudgments() {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(UI_SCALE, UI_SCALE);
        
        for (let i = gameState.judgments.length - 1; i >= 0; i--) {
            const j = gameState.judgments[i];
            const simpleY = j.y / UI_SCALE;
            
            j.y -= 1.5;
            j.alpha -= 0.02;
            if (j.bounce > 1.0) j.bounce -= 0.05;
            
            if (j.alpha <= 0) {
                gameState.judgments.splice(i, 1);
                continue;
            }
            
            const x = (this.trackStartX + j.track * (CONFIG.trackWidth + 8) + CONFIG.trackWidth / 2) / UI_SCALE;
            
            ctx.globalAlpha = j.alpha;
            ctx.font = `bold ${Math.round(12 * j.bounce)}px "Press Start 2P"`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#000000';
            ctx.fillText(j.text, x + 2, simpleY + 2);
            
            if (j.text === 'PERFECT') ctx.fillStyle = '#ffef5e';
            else if (j.text === 'GREAT') ctx.fillStyle = '#89d868';
            else ctx.fillStyle = '#ff77a9';
            
            ctx.fillText(j.text, x, simpleY);
            ctx.globalAlpha = 1.0;
        }
        
        ctx.restore();
    }
    
    drawHUD() {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(UI_SCALE, UI_SCALE);
        
        const w = this.canvasWidth / UI_SCALE;
        const h = this.canvasHeight / UI_SCALE;
        
        // Score
        ctx.fillStyle = '#fcfcfc';
        ctx.font = '12px "Press Start 2P"';
        ctx.textAlign = 'left';
        ctx.fillText('SCORE', 20, 30);
        ctx.font = '20px "Press Start 2P"';
        ctx.fillStyle = '#69b7eb';
        ctx.fillText(gameState.score.toLocaleString(), 20, 55);
        
        // Health bar
        const hX = w - 160;
        ctx.fillStyle = '#000';
        ctx.fillRect(hX, 20, 140, 20);
        
        const healthColor = gameState.health > 60 ? '#89d868' : 
                           gameState.health > 30 ? '#ffef5e' : '#ff77a9';
        ctx.fillStyle = healthColor;
        ctx.fillRect(hX + 2, 22, (134 * gameState.health / 100), 16);
        ctx.strokeStyle = '#fcfcfc';
        ctx.strokeRect(hX, 20, 140, 20);
        
        // Combo
        if (gameState.combo > 0) {
            ctx.font = 'bold 32px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff77a9';
            const scale = 1 + Math.sin(performance.now() * 0.01) * 0.05;
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(scale, scale);
            ctx.fillText(gameState.combo, 0, 0);
            ctx.restore();
            ctx.font = '10px "Press Start 2P"';
            ctx.fillStyle = '#fcfcfc';
            ctx.fillText('COMBO', w / 2, h / 2 + 25);
        }
        
        // Stats
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffef5e';
        ctx.fillText('P:' + gameState.perfect, 20, 90);
        ctx.fillStyle = '#89d868';
        ctx.fillText('G:' + gameState.great, 100, 90);
        ctx.fillStyle = '#ff77a9';
        ctx.fillText('M:' + gameState.miss, 180, 90);
        
        const acc = gameState.calculateTotalAcc();
        ctx.fillStyle = '#ffffff';
        ctx.fillText('ACC:' + acc.toFixed(2) + '%', 20, 110);
        
        ctx.restore();
    }
    
    drawLineChart(historyData) {
        const chartCanvas = document.getElementById('lineChartCanvas');
        const cCtx = chartCanvas.getContext('2d');
        const container = chartCanvas.parentElement;
        const w = container.clientWidth;
        const h = container.clientHeight;
        
        chartCanvas.width = w;
        chartCanvas.height = h;
        cCtx.imageSmoothingEnabled = false;
        cCtx.clearRect(0, 0, w, h);
        cCtx.fillStyle = '#2d2d44';
        cCtx.fillRect(0, 0, w, h);
        
        if (historyData.length === 0) return;
        
        const leftMargin = 40;
        const topMargin = 20;
        const rightMargin = 10;
        const bottomMargin = 20;
        const chartW = w - leftMargin - rightMargin;
        const chartH = h - topMargin - bottomMargin;
        
        // Y-axis labels
        cCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        cCtx.font = '10px "Press Start 2P"';
        cCtx.textAlign = 'right';
        cCtx.fillText('100%', leftMargin - 4, topMargin + 4);
        cCtx.fillText('50%', leftMargin - 4, topMargin + chartH / 2 + 3);
        cCtx.fillText('0%', leftMargin - 4, topMargin + chartH);
        
        // Grid lines
        cCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        cCtx.lineWidth = 1;
        for (let i = 0; i <= 2; i++) {
            const y = topMargin + (chartH / 2) * i;
            cCtx.beginPath();
            cCtx.moveTo(leftMargin, y);
            cCtx.lineTo(w - rightMargin, y);
            cCtx.stroke();
        }
        
        const pointSpacing = historyData.length > 1 ? chartW / (historyData.length - 1) : 0;
        
        // Interval accuracy bars
        historyData.forEach((data, index) => {
            const x = leftMargin + index * pointSpacing;
            const barW = pointSpacing > 0 ? Math.max(2, pointSpacing - 2) : 2;
            const barH = chartH * (data.intervalAcc / 100);
            cCtx.fillStyle = 'rgba(255, 239, 94, 0.2)';
            cCtx.fillRect(x - barW / 2, topMargin + chartH - barH, barW, barH);
        });
        
        // Total accuracy line
        cCtx.strokeStyle = '#ff77a9';
        cCtx.lineWidth = 2;
        cCtx.beginPath();
        historyData.forEach((data, index) => {
            const x = leftMargin + index * pointSpacing;
            const y = topMargin + chartH - (chartH * (data.totalAcc / 100));
            if (index === 0) cCtx.moveTo(x, y);
            else cCtx.lineTo(x, y);
        });
        cCtx.stroke();
        
        // Data points
        historyData.forEach((data, index) => {
            const x = leftMargin + index * pointSpacing;
            const y = topMargin + chartH - (chartH * (data.totalAcc / 100));
            cCtx.fillStyle = '#ff77a9';
            cCtx.fillRect(x - 2, y - 2, 4, 4);
        });
    }
    
    createMissEffect(y, track) {
        gameState.judgments.push({
            text: 'MISS',
            y: y - 50,
            track,
            alpha: 1,
            scale: 1.0,
            bounce: 1.0
        });
    }
    
    addJudgment(text, y, track) {
        gameState.judgments.push({
            text,
            y: y - 50,
            track,
            alpha: 1,
            scale: 1.0,
            bounce: 1.2
        });
    }
    
    createHitParticles(y, track, color) {
        const x = this.trackStartX + track * (CONFIG.trackWidth + 8) + CONFIG.trackWidth / 2;
        
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8;
            const speed = 5 + Math.random() * 3;
            gameState.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 6,
                color,
                life: 1.0
            });
        }
    }
    
    createLaser(track) {
        const x = this.trackStartX + track * (CONFIG.trackWidth + 8) + CONFIG.trackWidth / 2;
        gameState.lasers.push({
            x,
            width: CONFIG.trackWidth,
            height: 0,
            color: TRACK_COLORS[track],
            alpha: 0.5
        });
    }
}