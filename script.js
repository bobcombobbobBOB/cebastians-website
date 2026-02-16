const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Game State ---
let gameState = {
    money: 100,
    lives: 100,
    wave: 1,
    difficulty: 'normal', // easy, normal, hard
    gameActive: false,
    enemies: [],
    towers: [],
    projectiles: [],
    waveInProgress: false,
    frames: 0
};

const path = [
    {x: 0, y: 100}, {x: 200, y: 100}, {x: 200, y: 400}, 
    {x: 500, y: 400}, {x: 500, y: 200}, {x: 700, y: 200}, {x: 700, y: 500}
];
const crownPos = {x: 700, y: 500};

// --- Settings ---
let difficultyMultipliers = {
    'easy': { hp: 0.7, speed: 0.8, reward: 1.5 },
    'normal': { hp: 1.0, speed: 1.0, reward: 1.0 },
    'hard': { hp: 1.5, speed: 1.3, reward: 0.8 }
};
let selectedDiff = null;
let healthModeSet = null;

// --- Setup Functions ---
function setDifficulty(diff) {
    selectedDiff = diff;
    document.getElementById('selected-diff').innerText = "Selected: " + diff.toUpperCase();
    checkStartReady();
}

function setHealthMode(hasHealth) {
    healthModeSet = hasHealth;
    document.getElementById('selected-health').innerText = hasHealth ? "Selected: 100 HP" : "Selected: 1 HIT DEATH";
    checkStartReady();
}

function checkStartReady() {
    if (selectedDiff && healthModeSet !== null) {
        document.getElementById('start-btn').disabled = false;
    }
}

function startGame() {
    gameState.difficulty = selectedDiff;
    gameState.lives = healthModeSet ? 100 : 1;
    gameState.money = selectedDiff === 'easy' ? 150 : 100;
    
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('stats-bar').classList.remove('hidden');
    document.getElementById('shop-bar').classList.remove('hidden');
    gameState.gameActive = true;
    
    // Attempt to play sound
    const audio = document.getElementById('bgm');
    audio.volume = 0.3;
    audio.play().catch(e => console.log("Audio play failed (user interaction needed)"));

    updateUI();
    gameLoop();
}

// --- Classes ---
class Enemy {
    constructor(wave) {
        let mult = difficultyMultipliers[gameState.difficulty];
        this.wpIndex = 0;
        this.x = path[0].x;
        this.y = path[0].y;
        this.radius = 15;
        this.speed = (1 + (wave * 0.1)) * mult.speed;
        this.hp = (20 + (wave * 10)) * mult.hp;
        this.maxHp = this.hp;
        this.reward = Math.floor((10 + wave) * mult.reward);
    }

    update() {
        let target = path[this.wpIndex + 1];
        if(!target) return; // At end

        let dx = target.x - this.x;
        let dy = target.y - this.y;
        let dist = Math.hypot(dx, dy);

        if (dist < this.speed) {
            this.x = target.x;
            this.y = target.y;
            this.wpIndex++;
            if (this.wpIndex >= path.length - 1) {
                this.hp = 0; // Remove enemy
                gameState.lives--;
                if(gameState.lives <= 0) endGame();
            }
        } else {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }

    draw() {
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        // HP Bar
        ctx.fillStyle = 'black';
        ctx.fillRect(this.x - 15, this.y - 25, 30, 5);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(this.x - 15, this.y - 25, 30 * (this.hp / this.maxHp), 5);
    }
}

class Tower {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.range = 100;
        this.damage = 10;
        this.cooldown = 0;
        this.maxCooldown = 30; // Frames
        this.level = 1;
    }

    upgrade() {
        if (gameState.money >= 100) {
            gameState.money -= 100;
            this.level++;
            this.damage += 10;
            this.range += 15;
            this.maxCooldown = Math.max(5, this.maxCooldown - 2);
            updateUI();
        }
    }

    update() {
        if (this.cooldown > 0) this.cooldown--;
        else {
            // Find target
            const target = gameState.enemies.find(e => {
                return Math.hypot(e.x - this.x, e.y - this.y) <= this.range;
            });
            if (target) {
                gameState.projectiles.push(new Projectile(this.x, this.y, target, this.damage));
                this.cooldown = this.maxCooldown;
            }
        }
    }

    draw() {
        ctx.fillStyle = 'blue';
        ctx.fillRect(this.x - 15, this.y - 15, 30, 30);
        // Draw Level
        ctx.fillStyle = 'white';
        ctx.font = '10px Arial';
        ctx.fillText("Lvl " + this.level, this.x - 12, this.y + 4);
    }
}

class Projectile {
    constructor(x, y, target, dmg) {
        this.x = x;
        this.y = y;
        this.target = target;
        this.damage = dmg;
        this.speed = 10;
        this.hit = false;
    }

    update() {
        if (!gameState.enemies.includes(this.target)) {
            this.hit = true; // Target died before hit
            return;
        }
        let dx = this.target.x - this.x;
        let dy = this.target.y - this.y;
        let dist = Math.hypot(dx, dy);

        if (dist < this.speed) {
            this.target.hp -= this.damage;
            if (this.target.hp <= 0) {
                gameState.money += this.target.reward;
                // Remove enemy (will be filtered in main loop)
            }
            this.hit = true;
        } else {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }

    draw() {
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// --- Core Logic ---
function update() {
    if (!gameState.gameActive || gameState.lives <= 0) return;
    gameState.frames++;

    // Spawn Logic (Simple)
    if (gameState.waveInProgress && gameState.frames % 60 === 0) {
        if (Math.random() > 0.1) gameState.enemies.push(new Enemy(gameState.wave));
    }

    // Entities
    gameState.enemies.forEach(e => e.update());
    gameState.enemies = gameState.enemies.filter(e => e.hp > 0);
    
    gameState.towers.forEach(t => t.update());
    
    gameState.projectiles.forEach(p => p.update());
    gameState.projectiles = gameState.projectiles.filter(p => !p.hit);

    updateUI();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Path
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 40;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    path.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Draw Crown
    ctx.fillStyle = 'gold';
    ctx.font = '40px Arial';
    ctx.fillText("👑", crownPos.x - 20, crownPos.y + 10);

    gameState.towers.forEach(t => t.draw());
    gameState.enemies.forEach(e => e.draw());
    gameState.projectiles.forEach(p => p.draw());
}

function gameLoop() {
    update();
    draw();
    if (gameState.gameActive) requestAnimationFrame(gameLoop);
}

function endGame() {
    gameState.gameActive = false;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('final-wave').innerText = gameState.wave;
}

function updateUI() {
    document.getElementById('hp-display').innerText = gameState.lives;
    document.getElementById('money-display').innerText = gameState.money;
    document.getElementById('wave-display').innerText = gameState.wave;
}

// --- Interaction ---
document.getElementById('next-wave-btn').addEventListener('click', () => {
    gameState.waveInProgress = true;
    gameState.wave++;
});

canvas.addEventListener('mousedown', (e) => {
    if (!gameState.gameActive) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicked on existing tower (Upgrade)
    const clickedTower = gameState.towers.find(t => Math.hypot(t.x - x, t.y - y) < 20);
    if (clickedTower) {
        clickedTower.upgrade();
        return;
    }

    // Place new Tower
    if (gameState.money >= 50) {
        // Simple collision check to not place on path
        let onPath = false;
        // In a real game, you'd check polygon collision, here we just check distance to waypoints roughly
        // or just allow it anywhere for this demo.
        
        gameState.towers.push(new Tower(x, y));
        gameState.money -= 50;
    }
});
