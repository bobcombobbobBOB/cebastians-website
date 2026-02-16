const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Configuration ---
// The Path (Points connected by lines)
const path = [
    {x: 0, y: 100}, {x: 200, y: 100}, {x: 200, y: 400}, 
    {x: 500, y: 400}, {x: 500, y: 200}, {x: 700, y: 200}, {x: 700, y: 500}
];
const pathWidth = 50; // How wide the road is

// The Crown (Yellow Box)
const crown = { x: 680, y: 480, w: 40, h: 40 };

// Enemy Definitions (7 Levels)
const enemyTypes = [
    { id: 1, color: '#ff7675', hp: 20, speed: 2.5, reward: 15 },   // Red (Fast/Weak)
    { id: 2, color: '#ffeaa7', hp: 40, speed: 3.0, reward: 20 },   // Yellow (Faster)
    { id: 3, color: '#55efc4', hp: 90, speed: 2.0, reward: 25 },   // Green (Tanky)
    { id: 4, color: '#a29bfe', hp: 150, speed: 3.5, reward: 35 },  // Purple (Boss Speed)
    { id: 5, color: '#d35400', hp: 300, speed: 1.5, reward: 45 },  // Brown (Armored)
    { id: 6, color: '#636e72', hp: 600, speed: 1.8, reward: 60 },  // Grey (Super Tank)
    { id: 7, color: '#000000', hp: 1200, speed: 1.0, reward: 100 } // Black (The End)
];

// --- Game State ---
let game = {
    running: false,
    money: 100,
    hp: 100,
    wave: 1,
    waveActive: false, // Strict locking variable
    frames: 0,
    difficulty: 'normal',
    enemies: [],
    towers: [],
    projectiles: [],
    spawnQueue: [], // Enemies waiting to enter map
    selection: null // 'basic' or 'sniper'
};

let settings = { diff: null, hpMode: null };

// --- Setup Functions ---
function setDifficulty(d) {
    settings.diff = d;
    document.getElementById('diff-status').innerText = "Selected: " + d.toUpperCase();
    checkReady();
}
function setHealthMode(h) {
    settings.hpMode = h;
    document.getElementById('hp-status').innerText = h ? "100 HP" : "1 Hit KO";
    checkReady();
}
function checkReady() {
    if (settings.diff && settings.hpMode !== null) {
        document.getElementById('start-game-btn').disabled = false;
    }
}

function startGame() {
    // Apply Settings
    game.hp = settings.hpMode ? 100 : 1;
    game.money = settings.diff === 'easy' ? 250 : (settings.diff === 'hard' ? 100 : 150);
    game.running = true;

    // UI Updates
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('stats-bar').classList.remove('hidden');
    document.getElementById('shop-bar').classList.remove('hidden');
    
    // Audio
    let audio = document.getElementById('bgm');
    audio.volume = 0.2;
    audio.play().catch(e => console.log("Audio waiting for interaction"));

    updateUI();
    gameLoop();
}

// --- Wave Logic ---
document.getElementById('next-wave-btn').addEventListener('click', () => {
    // STRICT CHECK: If wave is active, DO NOTHING.
    if (game.waveActive) return;

    startWave();
});

function startWave() {
    game.waveActive = true;
    updateUI(); // This will disable the button

    // Generate Enemies based on Wave Number
    let count = 5 + (game.wave * 2);
    game.spawnQueue = [];

    for (let i = 0; i < count; i++) {
        // Higher waves unlock higher tier enemies
        let maxTier = Math.min(Math.ceil(game.wave / 2), 7);
        let tier = Math.floor(Math.random() * maxTier);
        game.spawnQueue.push(tier);
    }
    // Sort weak to strong
    game.spawnQueue.sort((a,b) => a - b);
}

// --- Interaction Logic ---
function selectTower(type) {
    game.selection = type;
    // UI Feedback
    document.querySelectorAll('.shop-item').forEach(i => i.classList.remove('selected'));
    document.getElementById('shop-' + type).classList.add('selected');
    document.getElementById('info-msg').innerText = "Click map to place " + type;
}

canvas.addEventListener('mousedown', (e) => {
    if (!game.running) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1. Check for Upgrade (Clicking existing tower)
    let clickedTower = game.towers.find(t => Math.hypot(t.x - x, t.y - y) < 20);
    if (clickedTower) {
        clickedTower.upgrade();
        return;
    }

    // 2. Placement Logic
    if (game.selection) {
        // STRICT CHECK: Can't build during wave
        if (game.waveActive) {
            alert("⚠️ Wait for the wave to end!");
            return;
        }

        let cost = game.selection === 'basic' ? 50 : 500;
        if (game.money < cost) {
            alert("💸 Not enough money!");
            return;
        }

        // STRICT CHECK: Collision
        if (checkPlacementCollision(x, y)) {
            alert("🚫 Invalid Position! (Path, Crown, or Overlap)");
            return;
        }

        // Success - Build Tower
        game.towers.push(new Tower(x, y, game.selection));
        game.money -= cost;
        game.selection = null; // Deselect
        document.querySelectorAll('.shop-item').forEach(i => i.classList.remove('selected'));
        document.getElementById('info-msg').innerText = "Tower placed!";
        updateUI();
    }
});

// --- THE HARD MATH: COLLISION ---
function checkPlacementCollision(x, y) {
    const towerRadius = 20; // Assume tower size

    // 1. Check Canvas Bounds
    if (x < 20 || x > 780 || y < 20 || y > 580) return true;

    // 2. Check Crown (Rectangle Overlap)
    // Expand crown rect by tower radius to ensure no touching
    if (x > crown.x - towerRadius && x < crown.x + crown.w + towerRadius &&
        y > crown.y - towerRadius && y < crown.y + crown.h + towerRadius) {
        return true;
    }

    // 3. Check Other Towers (Distance)
    for (let t of game.towers) {
        if (Math.hypot(t.x - x, t.y - y) < 40) return true; // 40 = 2 * radius (touching)
    }

    // 4. Check Path (Point to Line Segment Distance)
    for (let i = 0; i < path.length - 1; i++) {
        let A = path[i];
        let B = path[i+1];
        
        let dist = distToSegment(x, y, A.x, A.y, B.x, B.y);
        
        // If distance is less than (RoadWidth/2 + TowerRadius), it touches the road
        if (dist < (pathWidth / 2) + 15) return true;
    }

    return false; // Safe
}

// Math Helper: Distance from Point(px,py) to Line Segment(x1,y1)-(x2,y2)
function distToSegment(px, py, x1, y1, x2, y2) {
    let l2 = (x2 - x1)**2 + (y2 - y1)**2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t)); // Clamp t to segment
    
    let projX = x1 + t * (x2 - x1);
    let projY = y1 + t * (y2 - y1);
    
    return Math.hypot(px - projX, py - projY);
}


// --- Game Classes ---
class Enemy {
    constructor(tierIdx) {
        let type = enemyTypes[tierIdx];
        this.tier = tierIdx;
        this.wpIndex = 0;
        this.x = path[0].x;
        this.y = path[0].y;
        this.hp = type.hp * (settings.diff === 'hard' ? 1.5 : 1);
        this.maxHp = this.hp;
        this.speed = type.speed;
        this.color = type.color;
        this.reward = type.reward;
        this.radius = 12 + tierIdx; // Higher tier = slightly bigger
    }

    update() {
        let target = path[this.wpIndex + 1];
        if (!target) return; // Should catch end of path

        let dx = target.x - this.x;
        let dy = target.y - this.y;
        let dist = Math.hypot(dx, dy);

        if (dist < this.speed) {
            this.x = target.x;
            this.y = target.y;
            this.wpIndex++;
            
            // Reached the end (Crown)
            if (this.wpIndex >= path.length - 1) {
                this.hp = 0; // Die
                takeDamage();
            }
        } else {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
    }
}

class Tower {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.level = 1;
        this.timer = 0;
        
        if (type === 'basic') {
            this.range = 130;
            this.dmg = 10;
            this.cooldown = 40;
            this.color = '#0984e3';
        } else {
            this.range = 300;
            this.dmg = 80;
            this.cooldown = 120;
            this.color = '#fdcb6e';
        }
    }

    upgrade() {
        if (game.waveActive) return; // Optional: Can disable upgrade during wave if desired

        let cost = this.type === 'basic' ? 100 : 500;
        if (game.money >= cost) {
            game.money -= cost;
            this.level++;
            this.dmg *= 1.4;
            this.range += 10;
            if (this.cooldown > 10) this.cooldown *= 0.9;
            updateUI();
        }
    }

    update() {
        if (this.timer > 0) this.timer--;
        else {
            let target = game.enemies.find(e => Math.hypot(e.x - this.x, e.y - this.y) < this.range);
            if (target) {
                game.projectiles.push(new Projectile(this.x, this.y, target, this.dmg, this.type));
                this.timer = this.cooldown;
            }
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - 15, this.y - 15, 30, 30);
        
        // Draw Range if selected? No, simple logic for now.
        // Level Text
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(this.level, this.x - 4, this.y + 5);
    }
}

class Projectile {
    constructor(x, y, target, dmg, type) {
        this.x = x;
        this.y = y;
        this.target = target;
        this.damage = dmg;
        this.type = type;
        this.hit = false;
        this.speed = type === 'sniper' ? 12 : 6;
    }

    update() {
        if (!game.enemies.includes(this.target)) {
            this.hit = true; 
            return;
        }

        let dx = this.target.x - this.x;
        let dy = this.target.y - this.y;
        let dist = Math.hypot(dx, dy);

        if (dist < this.speed) {
            this.target.hp -= this.damage;
            if (this.target.hp <= 0) {
                game.money += this.target.reward;
            }
            this.hit = true;
        } else {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }

    draw() {
        ctx.fillStyle = this.type === 'sniper' ? 'yellow' : 'cyan';
        let size = this.type === 'sniper' ? 6 : 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, size, 0, Math.PI*2);
        ctx.fill();
    }
}

// --- Main Loop ---
function update() {
    if (!game.running) return;
    game.frames++;

    // Spawning Logic
    if (game.waveActive && game.frames % 60 === 0 && game.spawnQueue.length > 0) {
        let tier = game.spawnQueue.shift();
        game.enemies.push(new Enemy(tier));
    }

    // End Wave Logic
    if (game.waveActive && game.spawnQueue.length === 0 && game.enemies.length === 0) {
        game.waveActive = false;
        game.wave++;
        updateUI(); // Re-enable button
    }

    // Entities
    game.enemies.forEach(e => e.update());
    game.enemies = game.enemies.filter(e => e.hp > 0);
    game.towers.forEach(t => t.update());
    game.projectiles.forEach(p => p.update());
    game.projectiles = game.projectiles.filter(p => !p.hit);
    
    updateUI();
}

function draw() {
    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(0,0, canvas.width, canvas.height);

    // Draw Path
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = pathWidth;
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    path.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Draw Crown (Yellow Box)
    ctx.fillStyle = '#f1c40f'; // Gold
    ctx.fillRect(crown.x, crown.y, crown.w, crown.h);
    // Crown Detail (Box outline)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(crown.x, crown.y, crown.w, crown.h);

    // Entities
    game.towers.forEach(t => t.draw());
    game.enemies.forEach(e => e.draw());
    game.projectiles.forEach(p => p.draw());
}

function gameLoop() {
    update();
    draw();
    if (game.running) requestAnimationFrame(gameLoop);
}

function takeDamage() {
    game.hp--;
    updateUI();
    if (game.hp <= 0) {
        game.running = false;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }
}

function updateUI() {
    document.getElementById('hp-display').innerText = game.hp;
    document.getElementById('money-display').innerText = Math.floor(game.money);
    document.getElementById('wave-display').innerText = game.wave;

    // Handle Button State
    const btn = document.getElementById('next-wave-btn');
    if (game.waveActive) {
        btn.disabled = true;
        btn.innerText = "⚠️ DEFEND! ⚠️";
        btn.classList.add('disabled'); // Ensure CSS style applies
    } else {
        btn.disabled = false;
        btn.innerText = "⚔️ START WAVE";
        btn.classList.remove('disabled');
    }
}
