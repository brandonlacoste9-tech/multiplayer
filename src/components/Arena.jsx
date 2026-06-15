import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createClient } from '@supabase/supabase-js';
import * as Colyseus from 'colyseus.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://eurrfbiavliahmhdxybp.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1cnJmYmlhdmxpYWhtaGR4eWJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDYyMTUsImV4cCI6MjA5Njc4MjIxNX0.hW7E5Z-02WTBiezSjUzjIBjfMc3OgYexFlvzlgJO3p0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL || 'ws://localhost:2567';

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
            session_score: 0,
            unsecuredLoot: 0,
            x: 0,
            y: 0,
            rotation: 0
        };
        
        this.otherPlayersSprites = {};
        this.otherPlayersLasers = {};
        this.empireCoins = {};
        
        this.isDead = false;
        
        // Client-Side Prediction State
        this.currentSequenceNumber = 0;
        this.inputHistory = [];
    }

    preload() {
        // Load the scraped assets from the public folder
        this.load.image('bg', '/assets/images/foozle/bg1.png');
        this.load.image('ship', '/assets/images/foozle/fighter.png');
        this.load.image('enemy', '/assets/images/foozle/scout.png');
        this.load.image('bullet', '/assets/images/foozle/bullet.png');
        this.load.image('spark', '/assets/images/foozle/ship_engine_thruster.png');
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

        // Draw Warp Gate
        const gateX = 2000;
        const gateY = 2000;
        const gateRadius = 250;
        
        // Gate Aura
        const gateGraphics = this.add.graphics();
        gateGraphics.lineStyle(4, 0x8b5cf6, 0.5);
        gateGraphics.strokeCircle(gateX, gateY, gateRadius);
        gateGraphics.fillStyle(0x8b5cf6, 0.1);
        gateGraphics.fillCircle(gateX, gateY, gateRadius);

        // Gate Particles
        this.gateEmitter = this.add.particles(gateX, gateY, 'spark', {
            speed: { min: 20, max: 100 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.8, end: 0 },
            blendMode: 'ADD',
            tint: 0x8b5cf6,
            lifespan: 2000,
            frequency: 50
        });
        
        // Create Player
        const startX = Phaser.Math.Between(100, MAP_WIDTH - 100);
        const startY = Phaser.Math.Between(100, MAP_HEIGHT - 100);
        this.myState.x = startX;
        this.myState.y = startY;

        this.player = this.physics.add.sprite(startX, startY, 'ship');
        this.player.setCollideWorldBounds(true);
        this.player.setDepth(10);
        
        // Exhaust Particles
        this.exhaustEmitter = this.add.particles(0, 0, 'spark', {
            speed: { min: 100, max: 200 },
            scale: { start: 0.6, end: 0 },
            alpha: { start: 1, end: 0 },
            blendMode: 'ADD',
            lifespan: 400,
            emitting: false
        });
        this.exhaustEmitter.startFollow(this.player);
        
        // Camera Follow
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        
        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = {
            w: this.input.keyboard.addKey('W'),
            a: this.input.keyboard.addKey('A'),
            s: this.input.keyboard.addKey('S'),
            d: this.input.keyboard.addKey('D'),
            shift: this.input.keyboard.addKey('SHIFT')
        };
        
        // Shooting
        this.lasers = this.physics.add.group();
        this.input.on('pointerdown', () => this.shootLaser());

        // UI
        this.scoreText = this.add.text(20, 20, `Banked: 0`, { fontSize: '24px', fill: '#0ea5e9', fontStyle: 'bold' }).setScrollFactor(0).setDepth(100);
        this.lootText = this.add.text(20, 50, `Unsecured Loot: 0`, { fontSize: '24px', fill: '#f97316', fontStyle: 'bold' }).setScrollFactor(0).setDepth(100);
        this.hpText = this.add.text(20, 80, `HP: 100`, { fontSize: '24px', fill: '#00ffaa', fontStyle: 'bold' }).setScrollFactor(0).setDepth(100);

        // Extraction Progress UI
        this.extractText = this.add.text(this.cameras.main.width/2, 100, 'EXTRACTING...', { fontSize: '32px', fill: '#c084fc', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setVisible(false).setDepth(100);
        this.extractBarBg = this.add.rectangle(this.cameras.main.width/2, 140, 300, 20, 0x000000).setScrollFactor(0).setVisible(false).setDepth(100);
        this.extractBarFill = this.add.rectangle(this.cameras.main.width/2 - 150, 140, 0, 20, 0xc084fc).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false).setDepth(100);

        this.deathText = this.add.text(this.cameras.main.width/2, this.cameras.main.height/2, 'SHIP DESTROYED\nLoot Dropped\nClick to Respawn', {
            fontSize: '40px', fill: '#ff003c', align: 'center', backgroundColor: 'rgba(0,0,0,0.8)', padding: { x: 20, y: 20 }
        }).setOrigin(0.5).setScrollFactor(0).setVisible(false).setInteractive().setDepth(100);
        
        this.deathText.on('pointerdown', () => this.respawn());
        
        this.scale.on('resize', (gameSize) => {
            this.deathText.setPosition(gameSize.width/2, gameSize.height/2);
        });

        // Setup Multiplayer
        this.setupRealtime();
    }

    async setupRealtime() {
        const client = new Colyseus.Client(COLYSEUS_URL);
        try {
            this.room = await client.joinOrCreate("arena", { name: this.playerName });
            console.log("Joined Colyseus Room!", this.room.sessionId);

            this.room.state.players.onAdd((player, sessionId) => {
                if (sessionId === this.room.sessionId) {
                    // It's me! Snap to initial server spawn
                    this.player.x = player.x;
                    this.player.y = player.y;

                    player.onChange(() => {
                        if (player.isDead && !this.isDead) this.die();
                        else if (!player.isDead && this.isDead) this.respawn();

                        this.myState.hp = player.hp;
                        this.hpText.setText(`HP: ${this.myState.hp}`);
                        this.myState.session_score = player.sessionMass;
                        this.myState.unsecuredLoot = player.unsecuredLoot;
                        this.lootText.setText(`Unsecured Loot: ${this.myState.unsecuredLoot}`);
                        this.updateScale();

                        // Update Extraction UI
                        if (player.isExtracting) {
                            this.extractText.setVisible(true);
                            this.extractBarBg.setVisible(true);
                            this.extractBarFill.setVisible(true);
                            const progress = Math.min(1, player.extractionTimer / 3.0);
                            this.extractBarFill.width = 300 * progress;
                            this.player.setTint(0xc084fc); // Purple extracting aura
                        } else {
                            this.extractText.setVisible(false);
                            this.extractBarBg.setVisible(false);
                            this.extractBarFill.setVisible(false);
                            this.player.clearTint();
                        }

                        // CSP Reconciliation
                        this.player.x = player.x;
                        this.player.y = player.y;

                        // Filter processed inputs
                        this.inputHistory = this.inputHistory.filter(i => i.seq > player.lastProcessedSequence);
                        
                        // Re-apply remaining
                        this.inputHistory.forEach(input => {
                            let speed = 300;
                            if (input.shift && this.myState.session_score > 0) speed = 600;
                            let vx = 0;
                            let vy = 0;
                            if (input.left) vx = -speed;
                            if (input.right) vx = speed;
                            if (input.up) vy = -speed;
                            if (input.down) vy = speed;

                            this.player.x += vx * (input.dt / 1000);
                            this.player.y += vy * (input.dt / 1000);
                        });
                    });
                } else {
                    // Enemy
                    const s = this.add.sprite(player.x, player.y, 'enemy');
                    s.setDepth(9);
                    const nt = this.add.text(player.x, player.y + 40, player.name, { fontSize: '14px', fill: '#ff003c', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
                    s.nameText = nt;
                    s.serverX = player.x;
                    s.serverY = player.y;
                    this.otherPlayersSprites[sessionId] = s;

                    player.onChange(() => {
                        if (player.isDead) {
                            s.setVisible(false);
                            s.nameText.setVisible(false);
                        } else {
                            s.setVisible(true);
                            s.nameText.setVisible(true);
                            s.serverX = player.x;
                            s.serverY = player.y;
                            s.rotation = player.rotation;
                            if (player.isExtracting) {
                                s.setTint(0xc084fc);
                            } else {
                                s.clearTint();
                            }
                        }
                    });
                }
            });

            this.room.state.players.onRemove((player, sessionId) => {
                if (this.otherPlayersSprites[sessionId]) {
                    this.otherPlayersSprites[sessionId].destroy();
                    this.otherPlayersSprites[sessionId].nameText.destroy();
                    delete this.otherPlayersSprites[sessionId];
                }
            });

            this.room.state.coins.onAdd((coin, coinId) => {
                const sprite = this.add.sprite(coin.x, coin.y, 'coin');
                sprite.setDepth(8);
                this.tweens.add({ targets: sprite, scaleX: 1.5, scaleY: 1.5, yoyo: true, repeat: -1, duration: 500 });
                this.empireCoins[coinId] = sprite;
            });

            this.room.state.coins.onRemove((coin, coinId) => {
                if (this.empireCoins[coinId]) {
                    this.empireCoins[coinId].destroy();
                    delete this.empireCoins[coinId];
                }
            });

            this.room.onMessage("laser_fired", (payload) => {
                const laser = this.physics.add.sprite(payload.x, payload.y, 'bullet');
                laser.setRotation(payload.rotation);
                laser.setDepth(5);
                this.physics.velocityFromRotation(payload.rotation - Math.PI/2, 600, laser.body.velocity);
                
                this.otherPlayersLasers[payload.laserId] = laser;
                setTimeout(() => {
                    if(laser) laser.destroy();
                    delete this.otherPlayersLasers[payload.laserId];
                }, 2000);
            });

            this.room.onMessage("you_died", () => {
                this.die();
            });

            this.room.onMessage("extracted", () => {
                // Flash the screen green!
                this.cameras.main.flash(500, 14, 165, 233);
            });

        } catch (e) {
            console.error("JOIN ERROR", e);
        }
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
        
        const spawnLasers = (offsetAngles) => {
            offsetAngles.forEach(offset => {
                const laser = this.physics.add.sprite(this.player.x, this.player.y, 'bullet');
                const angle = this.player.rotation + offset;
                laser.setRotation(angle);
                laser.setDepth(5);
                this.physics.velocityFromRotation(angle - Math.PI/2, 600, laser.body.velocity);
                
                const laserId = Phaser.Math.RND.uuid();
                if (this.room) {
                    this.room.send('laser_fired', { laserId, x: this.player.x, y: this.player.y, rotation: angle });
                }

                setTimeout(() => { if(laser) laser.destroy(); }, 2000);
            });
        };

        if (this.myState.session_score > 500) {
            spawnLasers([0, -0.2, 0.2]); // Spread shot
        } else if (this.myState.session_score > 200) {
            spawnLasers([-0.1, 0.1]); // Twin shot
        } else {
            spawnLasers([0]); // Single
        }
    }

    takeDamage() {
        if (this.isDead) return;
        this.myState.hp -= 25;
        this.hpText.setText(`HP: ${this.myState.hp}`);
        this.cameras.main.shake(100, 0.01);
        
        this.player.setTintFill(0xffffff);
        this.time.delayedCall(50, () => {
            if (this.player && this.player.active) {
                this.player.clearTint();
            }
        });
        
        if (this.myState.hp <= 0) {
            this.die();
        }
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.player.setVisible(false);
        this.player.body.stop();
        this.deathText.setVisible(true);
        this.exhaustEmitter.emitting = false;
        this.cameras.main.shake(300, 0.04);

        this.add.particles(this.player.x, this.player.y, 'spark', {
            speed: { min: 50, max: 300 },
            scale: { start: 1, end: 0 },
            blendMode: 'ADD',
            lifespan: 500,
            quantity: 30,
            duration: 50
        });

        this.myState.score = 0;
        this.myState.session_score = 0;
        this.myState.unsecuredLoot = 0;
        this.player.setScale(1); // reset snowball mass
        this.lootText.setText(`Unsecured Loot: 0`);
        
        // Hide extraction UI
        this.extractText.setVisible(false);
        this.extractBarBg.setVisible(false);
        this.extractBarFill.setVisible(false);
        this.player.clearTint();
    }

    respawn() {
        this.isDead = false;
        this.myState.hp = 100;
        this.player.setVisible(true);
        this.deathText.setVisible(false);
        this.hpText.setText(`HP: 100`);
    }

    update(time, delta) {
        if (!this.isDead && this.room) {
            // Rotation (face mouse)
            const pointer = this.input.activePointer;
            const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            this.player.rotation = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y) + Math.PI/2;

            // Gather inputs
            const inputState = {
                left: this.wasd.a.isDown || this.cursors.left.isDown,
                right: this.wasd.d.isDown || this.cursors.right.isDown,
                up: this.wasd.w.isDown || this.cursors.up.isDown,
                down: this.wasd.s.isDown || this.cursors.down.isDown,
                shift: this.wasd.shift.isDown,
                rotation: this.player.rotation,
                seq: ++this.currentSequenceNumber,
                dt: delta
            };

            // Send to server
            this.room.send("input", inputState);

            // Store in history
            this.inputHistory.push(inputState);

            // Predict local movement (CSP)
            let speed = 300;
            if (inputState.shift && this.myState.session_score > 0) {
                speed = 600;
                // We drain locally just for prediction, server has authority
                if (time % 100 < 20) {
                    this.myState.session_score = Math.max(0, this.myState.session_score - 1);
                    this.updateScale();
                }
            }

            let vx = 0;
            let vy = 0;
            if (inputState.left) vx = -speed;
            if (inputState.right) vx = speed;
            if (inputState.up) vy = -speed;
            if (inputState.down) vy = speed;
            
            this.player.setVelocity(vx, vy);

            if (vx !== 0 || vy !== 0) {
                this.exhaustEmitter.emitting = true;
                const shipAngleDeg = Phaser.Math.RadToDeg(this.player.rotation);
                const exhaustAngle = shipAngleDeg + 90;
                this.exhaustEmitter.particleAngle = { min: exhaustAngle - 15, max: exhaustAngle + 15 };
            } else {
                this.exhaustEmitter.emitting = false;
            }
        }

        this.checkCollisions();
        this.updateOtherPlayers();
    }

    updateScale() {
        // Max scale 2.5x at 1000 score
        const newScale = Math.min(2.5, 1 + (this.myState.session_score / 600));
        this.player.setScale(newScale);
    }

    checkCollisions() {
        if (this.isDead) return;

        // Check if other players lasers hit ME
        for (const [id, laser] of Object.entries(this.otherPlayersLasers)) {
            if (Phaser.Math.Distance.Between(this.player.x, this.player.y, laser.x, laser.y) < 30) {
                // I got hit! Let the server validate the hit.
                laser.destroy();
                delete this.otherPlayersLasers[id];
                this.takeDamage();
                
                // Inform server that we took a laser hit from this client
                if (this.room) {
                    this.room.send("laser_hit", { targetId: this.room.sessionId, angle: laser.rotation });
                }
            }
        }
        
        // Coins are collected directly via server authority now. 
        // We do NOT send coin_collected broadcasts locally.
    }

    updateOtherPlayers() {
        for (const [id, sprite] of Object.entries(this.otherPlayersSprites)) {
            // Smoothly Lerp to server's target coordinates
            if (sprite.serverX !== undefined && sprite.serverY !== undefined) {
                sprite.x = Phaser.Math.Linear(sprite.x, sprite.serverX, 0.3);
                sprite.y = Phaser.Math.Linear(sprite.y, sprite.serverY, 0.3);
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
