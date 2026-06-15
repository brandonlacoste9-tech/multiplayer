import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://eurrfbiavliahmhdxybp.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1cnJmYmlhdmxpYWhtaGR4eWJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDYyMTUsImV4cCI6MjA5Njc4MjIxNX0.hW7E5Z-02WTBiezSjUzjIBjfMc3OgYexFlvzlgJO3p0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAP_WIDTH = 4000;
const MAP_HEIGHT = 4000;
const MAX_COINS = 50;

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    init(data) {
        this.playerId = data.playerId;
        this.session = data.session;
        this.playerName = data.playerName;
        
        this.myState = {
            hp: 100,
            score: 0,
            x: 0,
            y: 0,
            rotation: 0
        };
        
        this.otherPlayersData = {};
        this.otherPlayersSprites = {};
        this.otherPlayersLasers = {};
        this.empireCoins = {};
        
        this.lastPresenceSync = 0;
        this.lastCoinSpawn = 0;
        this.isDead = false;
    }

    preload() {
        // Load the scraped assets from the public folder
        this.load.image('bg', '/assets/images/foozle/bg1.png');
        this.load.image('ship', '/assets/images/foozle/fighter.png');
        this.load.image('enemy', '/assets/images/foozle/scout.png');
        this.load.image('bullet', '/assets/images/foozle/bullet.png');
        // We will generate a coin texture since the repo might not have a golden coin
        const g = this.add.graphics();
        g.fillStyle(0xfbbf24, 1);
        g.fillCircle(12, 12, 12);
        g.generateTexture('coin', 24, 24);
        g.destroy();
    }

    create() {
        this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
        this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
        
        // Tiling background
        this.bg = this.add.tileSprite(MAP_WIDTH/2, MAP_HEIGHT/2, MAP_WIDTH, MAP_HEIGHT, 'bg');
        
        // Create Player
        const startX = Phaser.Math.Between(100, MAP_WIDTH - 100);
        const startY = Phaser.Math.Between(100, MAP_HEIGHT - 100);
        this.myState.x = startX;
        this.myState.y = startY;

        this.player = this.physics.add.sprite(startX, startY, 'ship');
        this.player.setCollideWorldBounds(true);
        this.player.setDepth(10);
        
        // Camera Follow
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        
        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = {
            w: this.input.keyboard.addKey('W'),
            a: this.input.keyboard.addKey('A'),
            s: this.input.keyboard.addKey('S'),
            d: this.input.keyboard.addKey('D')
        };
        
        // Shooting
        this.lasers = this.physics.add.group();
        this.input.on('pointerdown', () => this.shootLaser());

        // UI
        this.scoreText = this.add.text(20, 20, `Score: 0`, { fontSize: '24px', fill: '#fff', fontStyle: 'bold' }).setScrollFactor(0).setDepth(100);
        this.hpText = this.add.text(20, 50, `HP: 100`, { fontSize: '24px', fill: '#00ffaa', fontStyle: 'bold' }).setScrollFactor(0).setDepth(100);

        this.deathText = this.add.text(this.cameras.main.width/2, this.cameras.main.height/2, 'SHIP DESTROYED\nClick to Respawn', {
            fontSize: '40px', fill: '#ff003c', align: 'center', backgroundColor: 'rgba(0,0,0,0.8)', padding: { x: 20, y: 20 }
        }).setOrigin(0.5).setScrollFactor(0).setVisible(false).setInteractive().setDepth(100);
        
        this.deathText.on('pointerdown', () => this.respawn());
        
        this.scale.on('resize', (gameSize) => {
            this.deathText.setPosition(gameSize.width/2, gameSize.height/2);
        });

        // Setup Multiplayer
        this.setupRealtime();
    }

    setupRealtime() {
        this.channel = supabase.channel('empire_space', {
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

        this.channel.on('broadcast', { event: 'laser_fired' }, (payload) => {
            const { x, y, rotation } = payload.payload;
            const laser = this.physics.add.sprite(x, y, 'bullet');
            laser.setRotation(rotation);
            laser.setDepth(5);
            this.physics.velocityFromRotation(rotation - Math.PI/2, 600, laser.body.velocity);
            
            // Add to physics group so we can check if it hits US
            this.otherPlayersLasers[payload.payload.laserId] = laser;
            setTimeout(() => {
                if(laser) laser.destroy();
                delete this.otherPlayersLasers[payload.payload.laserId];
            }, 2000); // laser expires
        });

        this.channel.on('broadcast', { event: 'coin_spawn' }, (payload) => {
            this.spawnCoin(payload.payload.coin);
        });

        this.channel.on('broadcast', { event: 'coin_collected' }, (payload) => {
            const id = payload.payload.id;
            if (this.empireCoins[id]) {
                this.empireCoins[id].destroy();
                delete this.empireCoins[id];
            }
        });

        this.channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await this.syncPresence();
                if (Object.keys(this.empireCoins).length === 0) {
                    // Leader spawns initial coins
                    for(let i=0; i<15; i++) {
                        const c = { id: Phaser.Math.RND.uuid(), x: Phaser.Math.Between(100, MAP_WIDTH-100), y: Phaser.Math.Between(100, MAP_HEIGHT-100) };
                        this.spawnCoin(c);
                        this.channel.send({ type: 'broadcast', event: 'coin_spawn', payload: { coin: c } });
                    }
                }
            }
        });
    }

    spawnCoin(data) {
        const sprite = this.add.sprite(data.x, data.y, 'coin');
        sprite.setDepth(8);
        this.tweens.add({
            targets: sprite, scaleX: 1.5, scaleY: 1.5, yoyo: true, repeat: -1, duration: 500
        });
        this.empireCoins[data.id] = sprite;
    }

    shootLaser() {
        if (this.isDead) return;
        
        // Ship points to mouse, laser shoots from nose
        const laser = this.physics.add.sprite(this.player.x, this.player.y, 'bullet');
        laser.setRotation(this.player.rotation);
        laser.setDepth(5);
        this.physics.velocityFromRotation(this.player.rotation - Math.PI/2, 600, laser.body.velocity);
        
        const laserId = Phaser.Math.RND.uuid();
        this.channel.send({
            type: 'broadcast',
            event: 'laser_fired',
            payload: { laserId, x: this.player.x, y: this.player.y, rotation: this.player.rotation }
        });

        setTimeout(() => { if(laser) laser.destroy(); }, 2000);
    }

    takeDamage() {
        if (this.isDead) return;
        this.myState.hp -= 25;
        this.hpText.setText(`HP: ${this.myState.hp}`);
        this.cameras.main.shake(100, 0.02);
        
        if (this.myState.hp <= 0) {
            this.die();
        }
    }

    die() {
        this.isDead = true;
        this.player.setVisible(false);
        this.player.body.stop();
        this.deathText.setVisible(true);

        // Spawn a coin where we died as loot
        const drop = { id: Phaser.Math.RND.uuid(), x: this.player.x, y: this.player.y };
        this.channel.send({ type: 'broadcast', event: 'coin_spawn', payload: { coin: drop } });

        this.myState.score = 0;
        this.scoreText.setText(`Score: 0`);
        this.syncPresence(); // Sync dead state
    }

    respawn() {
        this.isDead = false;
        this.myState.hp = 100;
        this.player.x = Phaser.Math.Between(100, MAP_WIDTH-100);
        this.player.y = Phaser.Math.Between(100, MAP_HEIGHT-100);
        this.player.setVisible(true);
        this.deathText.setVisible(false);
        this.hpText.setText(`HP: 100`);
        this.syncPresence();
    }

    syncPresence() {
        if (!this.channel) return;
        this.channel.track({
            x: this.player.x,
            y: this.player.y,
            rotation: this.player.rotation,
            name: this.playerName,
            isDead: this.isDead
        });
    }

    update(time) {
        if (!this.isDead) {
            // Movement
            const speed = 300;
            let vx = 0;
            let vy = 0;
            
            if (this.wasd.a.isDown || this.cursors.left.isDown) vx = -speed;
            if (this.wasd.d.isDown || this.cursors.right.isDown) vx = speed;
            if (this.wasd.w.isDown || this.cursors.up.isDown) vy = -speed;
            if (this.wasd.s.isDown || this.cursors.down.isDown) vy = speed;
            
            this.player.setVelocity(vx, vy);

            // Rotation (face mouse)
            const pointer = this.input.activePointer;
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            this.player.rotation = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y) + Math.PI/2;

            // Sync
            if (time - this.lastPresenceSync > 50) { // 20 FPS sync
                this.syncPresence();
                this.lastPresenceSync = time;
            }
        }

        // Auto spawn coins
        if (time - this.lastCoinSpawn > 3000 && Object.keys(this.empireCoins).length < MAX_COINS) {
            const c = { id: Phaser.Math.RND.uuid(), x: Phaser.Math.Between(100, MAP_WIDTH-100), y: Phaser.Math.Between(100, MAP_HEIGHT-100) };
            this.spawnCoin(c);
            this.channel.send({ type: 'broadcast', event: 'coin_spawn', payload: { coin: c } });
            this.lastCoinSpawn = time;
        }

        this.checkCollisions();
        this.updateOtherPlayers();
    }

    checkCollisions() {
        if (this.isDead) return;

        // Check if other players lasers hit ME
        for (const [id, laser] of Object.entries(this.otherPlayersLasers)) {
            if (Phaser.Math.Distance.Between(this.player.x, this.player.y, laser.x, laser.y) < 30) {
                // I got hit!
                laser.destroy();
                delete this.otherPlayersLasers[id];
                this.takeDamage();
            }
        }

        // Check if I collected a coin
        for (const [id, coin] of Object.entries(this.empireCoins)) {
            if (Phaser.Math.Distance.Between(this.player.x, this.player.y, coin.x, coin.y) < 40) {
                coin.destroy();
                delete this.empireCoins[id];
                this.myState.score += 50;
                this.scoreText.setText(`Score: ${this.myState.score}`);
                this.channel.send({ type: 'broadcast', event: 'coin_collected', payload: { id } });
                
                if (this.session) {
                    supabase.rpc('grant_points', { amount: 50 }).then(console.log).catch(console.error);
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
                delete this.otherPlayersSprites[id];
            }
        }

        // Add/Update existing
        for (const [id, pData] of Object.entries(this.otherPlayersData)) {
            if (!this.otherPlayersSprites[id]) {
                const s = this.add.sprite(pData.x, pData.y, 'enemy');
                s.setDepth(9);
                const nt = this.add.text(pData.x, pData.y + 40, pData.name, { fontSize: '14px', fill: '#ff003c', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
                s.nameText = nt;
                this.otherPlayersSprites[id] = s;
            }

            const sprite = this.otherPlayersSprites[id];
            
            if (pData.isDead) {
                sprite.setVisible(false);
                sprite.nameText.setVisible(false);
            } else {
                sprite.setVisible(true);
                sprite.nameText.setVisible(true);
                // Lerp position
                sprite.x = Phaser.Math.Linear(sprite.x, pData.x, 0.4);
                sprite.y = Phaser.Math.Linear(sprite.y, pData.y, 0.4);
                // Hard set rotation
                sprite.rotation = pData.rotation;
                sprite.nameText.setPosition(sprite.x, sprite.y + 40);
            }
        }
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
          physics: { default: 'arcade' },
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
        <div style={{ position: 'absolute', top: 20, right: 20, background: '#330000', color: '#ff003c', padding: '10px 20px', borderRadius: '4px', border: '1px solid #ff003c', zIndex: 10 }}>
          <strong>Warning:</strong> Guest Mode. Sign in via Headquarters to save Empire Points.
        </div>
      )}
      <div ref={gameContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Arena;
