import { Room, Client } from "@colyseus/core";
import { ArenaState, Player, Coin } from "./ArenaState";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Ideally these come from environment variables.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://eurrfbiavliahmhdxybp.supabase.co";
// DO NOT COMMIT A REAL SERVICE ROLE KEY IN PROD
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "YOUR_SERVICE_ROLE_KEY_HERE";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const MAP_WIDTH = 4000;
const MAP_HEIGHT = 4000;
const MAX_COINS = 50;

export class ArenaRoom extends Room<any> {
  maxClients = 50;
  
  // Track inputs for each client
  inputs: Record<string, any[]> = {};

  onCreate(options: any) {
    this.setState(new ArenaState());

    // Setup message listener for inputs
    this.onMessage("input", (client, input) => {
      if (!this.inputs[client.sessionId]) this.inputs[client.sessionId] = [];
      this.inputs[client.sessionId].push(input);
    });

    // Handle laser firing (pass-through broadcast)
    this.onMessage("laser_fired", (client, payload) => {
      // Just broadcast to everyone except the sender so they can render it locally
      this.broadcast("laser_fired", payload, { except: client });
      
      // Note: A truly authoritative server would raycast/check hitboxes here.
      // For tight arcade feel, we trust the client's laser hits for now, OR
      // we add a "laser_hit" message that the server validates.
    });

    this.onMessage("laser_hit", (client, payload) => {
       const targetId = payload.targetId;
       const target = this.state.players.get(targetId);
       if (target && !target.isDead) {
           target.hp -= 25;
           if (target.hp <= 0) {
               target.isDead = true;
               target.sessionMass = 0;
               target.hp = 100; // Reset for next spawn

               // Drop a coin
               const coinId = crypto.randomUUID();
               const coin = new Coin();
               coin.x = target.x;
               coin.y = target.y;
               coin.value = 2; // high value drop
               this.state.coins.set(coinId, coin);

               // Let client know they died
               const targetClient = this.clients.find(c => c.sessionId === targetId);
               if (targetClient) {
                   targetClient.send("you_died");
               }
           }
       }
    });

    // Simulation Loop (20 ticks per second)
    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    const player = new Player();
    player.x = Math.random() * (MAP_WIDTH - 200) + 100;
    player.y = Math.random() * (MAP_HEIGHT - 200) + 100;
    player.name = options.name || "Pilot";
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, code?: number) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
    delete this.inputs[client.sessionId];
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  update(deltaTime: number) {
    // 1. Process player movement
    this.state.players.forEach((player, sessionId) => {
      if (player.isDead) return;

      const inputQueue = this.inputs[sessionId];
      if (inputQueue && inputQueue.length > 0) {
        let lastInput: any = null;
        
        // Process all queued inputs
        while (inputQueue.length > 0) {
            const input = inputQueue.shift();
            lastInput = input;
            
            let speed = 300;
            if (input.shift && player.sessionMass > 0) {
                speed = 600;
                player.isBoosting = true;
                player.sessionMass = Math.max(0, player.sessionMass - 1); // rough drain
            } else {
                player.isBoosting = false;
            }

            let vx = 0;
            let vy = 0;

            if (input.left) vx = -speed;
            if (input.right) vx = speed;
            if (input.up) vy = -speed;
            if (input.down) vy = speed;

            // Apply velocity for this input tick
            // In a perfectly synchronized deterministic engine, we'd use input.dt
            // but for simple arcade physics, we'll just use the server's deltaTime per input.
            // If they send 5 inputs, we move them 5 times. To avoid speed hacking, clamp max inputs processed per tick, or just use latest.
            // Actually, for simplicity and anti-cheat, let's just process the LATEST input for movement, but acknowledge the sequence.
        }
        
        if (lastInput) {
            let speed = 300;
            if (lastInput.shift && player.sessionMass > 0) {
                speed = 600;
                player.isBoosting = true;
            } else {
                player.isBoosting = false;
            }

            let vx = 0;
            let vy = 0;

            if (lastInput.left) vx = -speed;
            if (lastInput.right) vx = speed;
            if (lastInput.up) vy = -speed;
            if (lastInput.down) vy = speed;

            const dtSec = deltaTime / 1000;
            player.x += vx * dtSec;
            player.y += vy * dtSec;
            player.rotation = lastInput.rotation;
            player.lastProcessedSequence = lastInput.seq;
        }

        // Clamp to map bounds
        player.x = Math.max(0, Math.min(MAP_WIDTH, player.x));
        player.y = Math.max(0, Math.min(MAP_HEIGHT, player.y));
        
      } else {
          player.isBoosting = false;
      }
    });

    // 2. Spawn Coins randomly
    if (this.state.coins.size < MAX_COINS && Math.random() < 0.05) {
        const coinId = crypto.randomUUID();
        const coin = new Coin();
        coin.x = Math.random() * (MAP_WIDTH - 200) + 100;
        coin.y = Math.random() * (MAP_HEIGHT - 200) + 100;
        coin.value = 1;
        this.state.coins.set(coinId, coin);
    }

    // 3. Collision Check: Players vs Coins
    this.state.players.forEach((player, sessionId) => {
        if (player.isDead) return;
        
        // Hitbox scales with sessionMass
        const scale = Math.min(2.5, 1 + (player.sessionMass / 600));
        const radius = 40 * scale;

        this.state.coins.forEach((coin, coinId) => {
            const dx = player.x - coin.x;
            const dy = player.y - coin.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < radius) {
                // Collect coin
                this.state.coins.delete(coinId);
                player.sessionMass += 50 * coin.value;
                
                // Trigger Secure RPC call (Fire & Forget)
                // In production, we'd look up the user's Supabase UUID based on sessionId.
                // For now, we mock it.
                // supabase.rpc('grant_points', { amount: 50 * coin.value }).catch(console.error);
            }
        });
    });
  }
}
