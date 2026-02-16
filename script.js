const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Game Configuration ---
const path = [
    {x: 0, y: 100}, {x: 200, y: 100}, {x: 200, y: 400}, 
    {x: 500, y: 400}, {x: 500, y: 200}, {x: 700, y: 200}, {x: 700, y: 500}
];
const crownRect = { x: 680, y: 480, w: 40, h: 40 }; // Yellow Box Crown
const pathWidth = 40; 

// 7 Enemy Levels
const enemyTypes = [
    { color: '#FF0000', hp: 20, speed: 2, reward: 10 },    // 1: Red
    { color: '#FFFF00', hp: 40, speed: 3, reward: 15 },    // 2: Yellow
    { color: '#00FF00', hp: 80, speed: 1.5, reward: 20 },  // 3: Green
    { color: '#800080', hp: 150, speed: 2.5, reward: 30 }, // 4: Purple
    { color: '#8B4513', hp: 300, speed: 1, reward: 40 },   // 5: Brown
    { color: '#808080', hp: 500, speed: 1.2, reward: 50 }, // 6: Grey
    { color: '#000000', hp: 1000, speed: 0.8, reward: 100 }// 7: Black
];

let gameState = {
    money: 100,
    lives: 100,
    wave: 1,
    gameActive: false,
    waveActive: false, // Is a wave currently running?
    spawnQueue: [],    // List of enemies waiting to spawn this wave
    enemies: [],
    towers: [],
    projectiles: [],
    frames: 0,
    selectedTowerType: null // 'basic' or 'sniper'
};

// --- Setup ---
let selectedDiff = null;
let healthModeSet = null;

function setDifficulty(diff) {
    selectedDiff = diff;
    document.getElementById('selected-diff').innerText = "Selected: " + diff.toUpperCase();
    checkStart();
}
function setHealthMode(mode) {
    healthModeSet = mode;
    document.getElementById('selected-health').innerText = mode ? "Selected: 100 HP" : "Selected: 1 HIT DEATH";
    checkStart();
}
function checkStart() {
    if(selectedDiff && healthModeSet !== null) document.getElementById('start-btn').disabled = false;
}

function startGame() {
    gameState.lives = healthModeSet ? 100 : 1;
    gameState.money = selectedDiff === 'easy' ? 250 : (selectedDiff === 'hard' ? 100 : 150);
    gameState.gameActive = true;
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('stats-bar').classList.remove('hidden');
    document.getElementById('shop-bar').classList.remove('hidden');
    
    // Try play audio
    document.getElementById('bgm').volume = 0.2;
    document.getElementById('bgm').play().catch(() => {});
    
    updateUI();
    gameLoop();
}

// --- Classes ---
class Enemy {
    constructor(levelIndex) {
        // Clamp level index 0-6
        let idx = Math.min(levelIndex, 6);
        let type = enemyTypes[idx];
        
        // Difficulty scaling multiplier
        let diffMult = selectedDiff === 'hard' ? 1.5 : (selectedDiff === 'easy' ? 0.7 : 1.0);

        this.wpIndex = 0;
        this.x = path[0].x;
        this.y = path[0].y;
        this.color = type.color;
        this.radius = 12 + idx; // Harder enemies are slightly bigger
        this.speed = type.speed; 
        this.hp = type.hp * diffMult;
        this.maxHp = this.hp;
        this.reward = type.reward;
    }

    update() {
        let target = path[this.wpIndex + 1];
        if(!target) return; 

        let dx = target.x - this.x;
        let dy = target.y - this.y;
        let dist = Math.hypot(dx, dy);

        if (dist < this.speed) {
            this.x = target.x;
            this.y = target.y;
            this.wpIndex++;
            // Reached Crown
            if (this.wpIndex >= path.length - 1) {
                this.hp = 0;
                gameState.lives--;
                if(gameState.lives <= 0) endGame();
            }
        } else {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.stroke(); // Outline to see black units
    }
}

class Tower {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.level = 1;
        this.cooldown = 0;

        if (type === 'basic') {
            this.range = 120;
            this.damage = 15;
            this.maxCooldown = 40;
            this.color = 'blue';
            this.size = 20;
        } else if (type === 'sniper') {
            this.range = 300;
            this.damage = 100;
            this.maxCooldown = 120; // Slow fire
            this.color = 'yellow';
            this.size = 25;
        }
    }

    upgrade() {
        let cost = this.type === 'sniper' ? 500 : 100; // Expensive upgrade for sniper
        if (gameState.money >= cost) {
            gameState.money -= cost;
            this.level++;
            this.damage *= 1.5;
            // Upgrade fire rate
            if(this.maxCooldown > 10) this.maxCooldown *= 0.85; 
            updateUI();
        }
    }

    update() {
        if (this.cooldown > 0) this.cooldown--;
        else {
            const target = gameState.enemies.find(e => Math.hypot(e.x - this.x, e.y - this.y) <= this.range);
            if (target) {
                gameState.projectiles.push(new Projectile(this.x, this.y, target, this.damage, this.type));
                this.cooldown = this.maxCooldown;
            }
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.size/2, this.y - this.size/2, this.size, this.size);
        ctx.fillStyle = 'white';
        ctx.font = '10px Arial';
        ctx.fillText("Lvl " + this.level, this.x - 10, this.y - 15);
    }
}

class Projectile {
    constructor(x, y, target, dmg, type) {
        this.x = x;
        this.y = y;
        this.target = target;
        this.damage = dmg;
        this.hit = false;
        
        if (type === 'sniper') {
            this.speed = 15;
            this.radius = 8;
            this.color = 'yellow';
        } else {
            this.speed = 8;
            this.radius = 4;
            this.color = 'cyan';
        }
    }

    update() {
        if (!gameState.enemies.includes(this.target)) { this.hit = true; return; }
        let dx = this.target.x - this.x;
        let dy = this.target.y - this.y;
        let dist = Math.hypot(dx, dy);

        if (dist < this.speed) {
            this.target.hp -= this.damage;
            if (this.target.hp <= 0) gameState.money += this.target.reward;
            this.hit = true;
        } else {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// --- Logic ---
function selectTower(type) {
    if (gameState.waveActive) return; // Cannot select during wave
    gameState.selectedTowerType = type;
    
    // Highlight UI
    document.querySelectorAll('.shop-item').forEach(el => el.classList.remove('selected'));
    if(type === 'basic') document.querySelectorAll('.shop-item')[0].classList.add('selected');
    if(type === 'sniper') document.querySelectorAll('.shop-item')[1].classList.add('selected');
}

function startNextWave() {
    if (gameState.waveActive) return;
    
    gameState.waveActive = true;
    gameState.spawnQueue = [];
    
    // Generate Wave Enemies
    // Logic: Wave 1 = Level 0 enemies. Wave 10 = Mix of level 0,1,2 etc.
    let count = 5 + Math.floor(gameState.wave * 1.5);
    for(let i=0; i<count; i++) {
        // Simple logic: higher wave allows higher level enemy types
        let maxEnemyLevel = Math.min(Math.floor(gameState.wave / 3), 6); 
        let enemyLvl = Math.floor(Math.random() * (maxEnemyLevel + 1));
        gameState.spawnQueue.push(enemyLvl);
    }
    
    // Sort so weaker ones come first usually, or random
    gameState.spawnQueue.sort((a,b) => a - b);
    
    updateUI();
    document.getElementById('shop-bar').classList.add('shop-disabled');
}

function update() {
    if (!gameState.gameActive) return;
    gameState.frames++;

    // Spawning
    if (gameState.waveActive && gameState.spawnQueue.length > 0 && gameState.frames % 60 === 0) {
        let lvl = gameState.spawnQueue.shift();
        gameState.enemies.push(new Enemy(lvl));
    }

    // Check Wave End
    if (gameState.waveActive && gameState.spawnQueue.length === 0 && gameState.enemies.length === 0) {
        gameState.waveActive = false;
        gameState.wave++;
        document.getElementById('shop-bar').classList.remove('shop-disabled');
        updateUI();
    }

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
    ctx.strokeStyle = '#444';
    ctx.lineWidth = pathWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    path.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Draw Crown (Yellow Box)
    ctx.fillStyle = 'gold';
    ctx.fillRect(crownRect.x, crownRect.y, crownRect.w, crownRect.h);
    ctx.strokeStyle = 'orange';
    ctx.lineWidth = 2;
    ctx.strokeRect(crownRect.x, crownRect.y, crownRect.w, crownRect.h);

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
}

function updateUI() {
    document.getElementById('hp-display').innerText = gameState.lives;
    document.getElementById('money-display').innerText = Math.floor(gameState.money);
    document.getElementById('wave-display').innerText = gameState.wave;
    
    const btn = document.getElementById('next-wave-btn');
    const status = document.getElementById('wave-status');
    
    if (gameState.waveActive) {
        btn.disabled = true;
        status.innerText = "ATTACKING!";
        status.style.color = "red";
    } else {
        btn.disabled = false;
        status.innerText = "SAFE";
        status.style.color = "lime";
    }
}

// --- Interaction & Collision ---

// Check if a point collides with the path (rectangle segments)
function isMsgOnPath(x, y, buffer) {
    for (let i = 0; i < path.length - 1; i++) {
        let p1 = path[i];
        let p2 = path[i+1];
        
        // Define bounding box of segment
        let minX = Math.min(p1.x, p2.x) - (pathWidth/2 + buffer);
        let maxX = Math.max(p1.x, p2.x) + (pathWidth/2 + buffer);
        let minY = Math.min(p1.y, p2.y) - (pathWidth/2 + buffer);
        let maxY = Math.max(p1.y, p2.y) + (pathWidth/2 + buffer);

        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
    }
    return false;
}

// Check Crown Collision
function isMsgOnCrown(x, y) {
    return (x > crownRect.x - 20 && x < crownRect.x + crownRect.w + 20 &&
            y > crownRect.y - 20 && y < crownRect.y + crownRect.h + 20);
}

document.getElementById('next-wave-btn').addEventListener('click', startNextWave);

canvas.addEventListener('mousedown', (e) => {
    if (!gameState.gameActive) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1. Check if clicking existing tower (Upgrade)
    // Only allow upgrades if NOT in placement mode, OR if we click on a tower while in placement mode
    const clickedTower = gameState.towers.find(t => Math.hypot(t.x - x, t.y - y) < 25);
    
    if (clickedTower) {
        clickedTower.upgrade();
        gameState.selectedTowerType = null; // Cancel build mode if we clicked a tower
        document.querySelectorAll('.shop-item').forEach(el => el.classList.remove('selected'));
        return;
    }

    // 2. Try Place Tower
    if (gameState.selectedTowerType) {
        if (gameState.waveActive) {
            alert("Cannot build during waves!");
            return;
        }

        let cost = gameState.selectedTowerType === 'basic' ? 50 : 500;
        
        if (gameState.money < cost) {
            alert("Not enough money!");
            return;
        }

        // Collision Checks
        if (isMsgOnPath(x, y, 10)) {
            alert("Cannot build on the path!");
            return;
        }
        if (isMsgOnCrown(x, y)) {
            alert("Cannot build on the Crown!");
            return;
        }

        // Check distance to other towers
        let tooClose = gameState.towers.some(t => Math.hypot(t.x - x, t.y - y) < 45); // 45px buffer
        if (tooClose) {
            alert("Too close to another tower!");
            return;
        }

        // Place it
        gameState.towers.push(new Tower(x, y, gameState.selectedTowerType));
        gameState.money -= cost;
        
        // Deselect
        gameState.selectedTowerType = null;
        document.querySelectorAll('.shop-item').forEach(el => el.classList.remove('selected'));
        updateUI();
    }
});
