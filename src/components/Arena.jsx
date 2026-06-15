import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://eurrfbiavliahmhdxybp.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1cnJmYmlhdmxpYWhtaGR4eWJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDYyMTUsImV4cCI6MjA5Njc4MjIxNX0.hW7E5Z-02WTBiezSjUzjIBjfMc3OgYexFlvzlgJO3p0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAP_WIDTH = 3000;
const MAP_HEIGHT = 3000;
const START_RADIUS = 20;
const FOOD_RADIUS = 5;
const EMPIRE_COIN_RADIUS = 12;
const MAX_FOOD = 300;

const getRandomColor = () => {
  const colors = [0x00f3ff, 0xff003c, 0x00ffaa, 0xf7931a, 0xff00ff, 0xffff00, 0xffffff];
  return colors[Math.floor(Math.random() * colors.length)];
};

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    init(data) {
        this.playerId = data.playerId;
        this.session = data.session;
        this.playerName = data.playerName;
        
        this.myState = {
            radius: START_RADIUS,
            color: getRandomColor(),
            score: 0
        };
        
        this.otherPlayersData = {};
        this.otherPlayersSprites = {};
        this.foods = {};
        this.empireCoins = {};
        
        this.lastPresenceSync = 0;
        this.lastFoodSpawn = 0;
        this.isDead = false;
    }

    create() {
        // Create textures for sprites
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 1);
        g.fillCircle(50, 50, 50);
        g.generateTexture('circle', 100, 100);
        g.destroy();

        // World Bounds & Camera
        this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
        this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
        
        // Grid Background
        this.add.grid(MAP_WIDTH/2, MAP_HEIGHT/2, MAP_WIDTH, MAP_HEIGHT, 50, 50, 0x0f172a, 1, 0x1e293b, 1);

        // Map Border
        const border = this.add.graphics();
        border.lineStyle(10, 0xef4444, 1);
        border.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

        // Player Sprite
        const startX = Phaser.Math.Between(100, MAP_WIDTH - 100);
        const startY = Phaser.Math.Between(100, MAP_HEIGHT - 100);
        
        this.player = this.physics.add.sprite(startX, startY, 'circle');
        this.player.setTint(this.myState.color);
        this.player.setDisplaySize(START_RADIUS * 2, START_RADIUS * 2);
        this.player.setCircle(50); // The original texture is 100x100, so radius is 50
        this.player.setCollideWorldBounds(true);
        
        // Name Text
        this.nameText = this.add.text(startX, startY - START_RADIUS - 10, this.playerName, { fontSize: '14px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        this.scoreText = this.add.text(startX, startY + START_RADIUS + 10, '0', { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);

        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

        // Particle Manager
        this.particles = this.add.particles('circle');

        // Setup Realtime
        this.setupRealtime();
        
        // UI overlay (fixed to camera)
        this.leaderboardText = this.add.text(this.cameras.main.width - 200, 20, 'Leaderboard\n...', {
            fontSize: '16px', fill: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 10, y: 10 }
        }).setScrollFactor(0);
        
        this.deathText = this.add.text(this.cameras.main.width/2, this.cameras.main.height/2, 'YOU WERE EATEN\nClick to Respawn', {
            fontSize: '40px', fill: '#ff003c', align: 'center', backgroundColor: 'rgba(0,0,0,0.8)', padding: { x: 20, y: 20 }
        }).setOrigin(0.5).setScrollFactor(0).setVisible(false).setInteractive();
        
        this.deathText.on('pointerdown', () => this.respawn());

        // Fix resize issue with leaderboard
        this.scale.on('resize', (gameSize) => {
            this.leaderboardText.setPosition(gameSize.width - 200, 20);
            this.deathText.setPosition(gameSize.width/2, gameSize.height/2);
        });
    }

    setupRealtime() {
        this.channel = supabase.channel('empire_phaser', {
            config: { presence: { key: this.playerId } }
        });

        this.channel.on('presence', { event: 'sync' }, () => {
            const state = this.channel.presenceState();
            this.otherPlayersData = {};
            for (const [key, presences] of Object.entries(state)) {
                if (key !== this.playerId && presences.length > 0) {
                    this.otherPlayersData[key] = presences[0];
                }
            }
        });

        this.channel.on('broadcast', { event: 'food_spawn' }, (payload) => {
            this.spawnFoodSprite(payload.payload.food);
        });

        this.channel.on('broadcast', { event: 'food_eaten' }, (payload) => {
            const id = payload.payload.id;
            if (this.foods[id]) {
                this.foods[id].destroy();
                delete this.foods[id];
            }
        });

        this.channel.on('broadcast', { event: 'coin_spawn' }, (payload) => {
            this.spawnCoinSprite(payload.payload.coin);
        });

        this.channel.on('broadcast', { event: 'coin_eaten' }, (payload) => {
            const id = payload.payload.id;
            if (this.empireCoins[id]) {
                this.empireCoins[id].destroy();
                delete this.empireCoins[id];
            }
        });

        this.channel.on('broadcast', { event: 'player_eaten' }, (payload) => {
            if (payload.payload.victimId === this.playerId) {
                this.die();
            } else {
                // If another player was eaten, trigger explosion at their location
                const p = this.otherPlayersData[payload.payload.victimId];
                if (p) this.explode(p.x, p.y, p.color);
            }
        });

        this.channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await this.syncPresence();
                // Spawn initial foods if leader
                if (Object.keys(this.foods).length === 0) {
                    for(let i=0; i<50; i++) {
                        const f = { id: Phaser.Math.RND.uuid(), x: Phaser.Math.Between(0, MAP_WIDTH), y: Phaser.Math.Between(0, MAP_HEIGHT), color: getRandomColor() };
                        this.spawnFoodSprite(f);
                        this.channel.send({ type: 'broadcast', event: 'food_spawn', payload: { food: f } });
                    }
                    const c = { id: Phaser.Math.RND.uuid(), x: Phaser.Math.Between(0, MAP_WIDTH), y: Phaser.Math.Between(0, MAP_HEIGHT) };
                    this.spawnCoinSprite(c);
                    this.channel.send({ type: 'broadcast', event: 'coin_spawn', payload: { coin: c } });
                }
            }
        });
    }

    spawnFoodSprite(data) {
        const sprite = this.add.sprite(data.x, data.y, 'circle');
        sprite.setTint(data.color);
        sprite.setDisplaySize(FOOD_RADIUS*2, FOOD_RADIUS*2);
        this.foods[data.id] = sprite;
    }

    spawnCoinSprite(data) {
        const sprite = this.add.sprite(data.x, data.y, 'circle');
        sprite.setTint(0xfbbf24);
        sprite.setDisplaySize(EMPIRE_COIN_RADIUS*2, EMPIRE_COIN_RADIUS*2);
        
        this.tweens.add({
            targets: sprite,
            scaleX: 1.5,
            scaleY: 1.5,
            yoyo: true,
            repeat: -1,
            duration: 500
        });
        
        this.empireCoins[data.id] = sprite;
    }

    explode(x, y, color) {
        const emitter = this.particles.createEmitter({
            x: x,
            y: y,
            speed: { min: -200, max: 200 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.2, end: 0 },
            tint: color,
            lifespan: 800,
            gravityY: 0
        });
        emitter.explode(20);
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.explode(this.player.x, this.player.y, this.myState.color);
        this.player.setVisible(false);
        this.player.body.stop();
        this.nameText.setVisible(false);
        this.scoreText.setVisible(false);
        this.deathText.setVisible(true);
        this.cameras.main.shake(300, 0.05);
    }

    respawn() {
        this.isDead = false;
        this.myState.radius = START_RADIUS;
        this.myState.score = 0;
        this.player.x = Phaser.Math.Between(100, MAP_WIDTH-100);
        this.player.y = Phaser.Math.Between(100, MAP_HEIGHT-100);
        this.player.setDisplaySize(START_RADIUS*2, START_RADIUS*2);
        this.player.setVisible(true);
        this.nameText.setVisible(true);
        this.scoreText.setVisible(true);
        this.deathText.setVisible(false);
        this.syncPresence();
    }

    syncPresence() {
        if (!this.channel || this.isDead) return;
        this.channel.track({
            x: this.player.x,
            y: this.player.y,
            radius: this.myState.radius,
            color: this.myState.color,
            name: this.playerName,
            score: this.myState.score
        });
    }

    update(time, delta) {
        if (this.isDead) return;

        // Mouse Follow Physics
        const pointer = this.input.activePointer;
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y);
        
        if (dist > 10) {
            const speed = Math.max(100, 6000 / this.myState.radius); // Decrease speed as radius grows
            this.physics.moveTo(this.player, worldPoint.x, worldPoint.y, speed);
        } else {
            this.player.body.stop();
        }

        // Keep Text attached to player
        this.nameText.setPosition(this.player.x, this.player.y - this.myState.radius - 15);
        this.scoreText.setPosition(this.player.x, this.player.y + this.myState.radius + 15);
        this.scoreText.setText(Math.floor(this.myState.score));

        // Network Sync (Throttle to 10 FPS)
        if (time - this.lastPresenceSync > 100) {
            this.syncPresence();
            this.lastPresenceSync = time;
        }

        // Auto Spawn Food if leader
        if (time - this.lastFoodSpawn > 1000 && Object.keys(this.foods).length < MAX_FOOD) {
            const f = { id: Phaser.Math.RND.uuid(), x: Phaser.Math.Between(0, MAP_WIDTH), y: Phaser.Math.Between(0, MAP_HEIGHT), color: getRandomColor() };
            this.spawnFoodSprite(f);
            this.channel.send({ type: 'broadcast', event: 'food_spawn', payload: { food: f } });
            this.lastFoodSpawn = time;
        }

        this.checkCollisions();
        this.updateOtherPlayers();
        this.updateLeaderboard();
    }

    checkCollisions() {
        // Food Collision
        for (const [id, f] of Object.entries(this.foods)) {
            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, f.x, f.y);
            if (dist < this.myState.radius) {
                f.destroy();
                delete this.foods[id];
                this.myState.radius = Math.sqrt(this.myState.radius**2 + FOOD_RADIUS**2);
                this.player.setDisplaySize(this.myState.radius*2, this.myState.radius*2);
                this.myState.score += 1;
                this.channel.send({ type: 'broadcast', event: 'food_eaten', payload: { id } });
            }
        }

        // Coin Collision
        for (const [id, c] of Object.entries(this.empireCoins)) {
            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y);
            if (dist < this.myState.radius) {
                c.destroy();
                delete this.empireCoins[id];
                this.myState.radius = Math.sqrt(this.myState.radius**2 + (EMPIRE_COIN_RADIUS*2)**2);
                this.player.setDisplaySize(this.myState.radius*2, this.myState.radius*2);
                this.myState.score += 50;
                this.channel.send({ type: 'broadcast', event: 'coin_eaten', payload: { id } });
                this.explode(this.player.x, this.player.y, 0xfbbf24);
                
                if (this.session) {
                    supabase.rpc('grant_points', { amount: 50 }).then(console.log).catch(console.error);
                }
            }
        }

        // Player PvP Collision
        for (const [id, pData] of Object.entries(this.otherPlayersData)) {
            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, pData.x, pData.y);
            if (dist < this.myState.radius && this.myState.radius > pData.radius * 1.15) {
                // I ATE THEM
                this.myState.radius = Math.sqrt(this.myState.radius**2 + pData.radius**2);
                this.player.setDisplaySize(this.myState.radius*2, this.myState.radius*2);
                this.myState.score += Math.max(10, pData.score);
                this.channel.send({ type: 'broadcast', event: 'player_eaten', payload: { victimId: id } });
                this.explode(pData.x, pData.y, pData.color);
                this.cameras.main.shake(200, 0.02);
                
                // Immediately clean up locally to avoid double eat
                delete this.otherPlayersData[id];
                if (this.otherPlayersSprites[id]) {
                    this.otherPlayersSprites[id].destroy();
                    this.otherPlayersSprites[id].nameText.destroy();
                    this.otherPlayersSprites[id].scoreText.destroy();
                    delete this.otherPlayersSprites[id];
                }
            }
        }
    }

    updateOtherPlayers() {
        // Remove disconnected
        for (const id in this.otherPlayersSprites) {
            if (!this.otherPlayersData[id]) {
                this.otherPlayersSprites[id].destroy();
                this.otherPlayersSprites[id].nameText.destroy();
                this.otherPlayersSprites[id].scoreText.destroy();
                delete this.otherPlayersSprites[id];
            }
        }

        // Add/Update existing
        for (const [id, pData] of Object.entries(this.otherPlayersData)) {
            if (!this.otherPlayersSprites[id]) {
                const s = this.add.sprite(pData.x, pData.y, 'circle');
                s.setTint(pData.color);
                
                const nt = this.add.text(pData.x, pData.y, pData.name, { fontSize: '14px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
                const st = this.add.text(pData.x, pData.y, pData.score, { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
                
                s.nameText = nt;
                s.scoreText = st;
                this.otherPlayersSprites[id] = s;
            }

            const sprite = this.otherPlayersSprites[id];
            sprite.x = Phaser.Math.Linear(sprite.x, pData.x, 0.3);
            sprite.y = Phaser.Math.Linear(sprite.y, pData.y, 0.3);
            sprite.setDisplaySize(pData.radius*2, pData.radius*2);
            
            sprite.nameText.setPosition(sprite.x, sprite.y - pData.radius - 15);
            sprite.scoreText.setPosition(sprite.x, sprite.y + pData.radius + 15);
            sprite.scoreText.setText(Math.floor(pData.score));
        }
    }

    updateLeaderboard() {
        const allPlayers = [
            { name: this.playerName, score: this.myState.score },
            ...Object.values(this.otherPlayersData).map(p => ({ name: p.name, score: p.score }))
        ];
        allPlayers.sort((a, b) => b.score - a.score);
        const top5 = allPlayers.slice(0, 5);

        let lbText = '🏆 Leaderboard\n\n';
        top5.forEach((p, i) => {
            lbText += `${i+1}. ${p.name} - ${Math.floor(p.score)}\n`;
        });
        this.leaderboardText.setText(lbText);
    }
}

const Arena = () => {
  const gameContainer = useRef(null);
  const gameInstance = useRef(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initGame = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      
      const playerId = session?.user?.id || crypto.randomUUID();
      const playerName = session?.user?.email?.split('@')[0] || `Guest_${Math.floor(Math.random()*1000)}`;

      if (gameInstance.current) return;

      const config = {
          type: Phaser.AUTO,
          width: window.innerWidth,
          height: window.innerHeight,
          parent: gameContainer.current,
          physics: {
              default: 'arcade',
              arcade: { debug: false }
          },
          scene: [MainScene]
      };

      const game = new Phaser.Game(config);
      game.scene.start('MainScene', { playerId, session, playerName });
      gameInstance.current = game;
      setLoading(false);
    };

    initGame();

    const handleResize = () => {
      if (gameInstance.current) {
          gameInstance.current.scale.resize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (gameInstance.current) {
          gameInstance.current.destroy(true);
          gameInstance.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>
      {!session && !loading && (
        <div style={{ position: 'absolute', top: 20, left: 20, background: '#330000', color: '#ff003c', padding: '10px 20px', borderRadius: '4px', border: '1px solid #ff003c', zIndex: 10 }}>
          <strong>Warning:</strong> Guest Mode. Sign in via Headquarters to save Empire Points.
        </div>
      )}
      <div ref={gameContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Arena;
