import React, { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://eurrfbiavliahmhdxybp.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1cnJmYmlhdmxpYWhtaGR4eWJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDYyMTUsImV4cCI6MjA5Njc4MjIxNX0.hW7E5Z-02WTBiezSjUzjIBjfMc3OgYexFlvzlgJO3p0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SPEED = 5;
const PLAYER_RADIUS = 15;
const COIN_RADIUS = 10;

// Utility to generate a random neon color
const getRandomColor = () => {
  const colors = ['#00f3ff', '#ff003c', '#00ffaa', '#f7931a', '#ff00ff', '#ffff00'];
  return colors[Math.floor(Math.random() * colors.length)];
};

const Arena = () => {
  const canvasRef = useRef(null);
  const [playerId, setPlayerId] = useState(null);
  const [session, setSession] = useState(null);

  // Game State Refs (to avoid dependency hell in requestAnimationFrame)
  const myState = useRef({
    x: Math.random() * (CANVAS_WIDTH - 50) + 25,
    y: Math.random() * (CANVAS_HEIGHT - 50) + 25,
    color: getRandomColor(),
    score: 0
  });
  const otherPlayers = useRef({});
  const coins = useRef([]);
  const keys = useRef({ w: false, a: false, s: false, d: false });

  useEffect(() => {
    // 1. Setup Player ID and Session
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      const uuid = session?.user?.id || crypto.randomUUID();
      setPlayerId(uuid);
    };
    initAuth();
  }, []);

  useEffect(() => {
    if (!playerId) return;

    // 2. Setup Realtime Channel
    const channel = supabase.channel('empire_arena', {
      config: {
        presence: { key: playerId },
        broadcast: { self: true } // allow hearing our own broadcasts if needed
      }
    });

    // 3. Listen for other players moving
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const updatedPlayers = {};
      
      for (const [key, presences] of Object.entries(state)) {
        if (key !== playerId && presences.length > 0) {
          updatedPlayers[key] = presences[0]; // Take latest presence data for that user
        }
      }
      otherPlayers.current = updatedPlayers;
    });

    // 4. Listen for coins being collected/spawned
    channel.on('broadcast', { event: 'coin_spawn' }, (payload) => {
      coins.current.push(payload.payload.coin);
    });

    channel.on('broadcast', { event: 'coin_collect' }, (payload) => {
      // Remove the collected coin locally
      const { coinId } = payload.payload;
      coins.current = coins.current.filter(c => c.id !== coinId);
    });

    // Subscribe to channel
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Broadcast our initial presence
        await channel.track({
          x: myState.current.x,
          y: myState.current.y,
          color: myState.current.color,
          score: myState.current.score
        });

        // If we are the first, maybe spawn a coin
        if (coins.current.length === 0) {
          const initialCoin = { id: crypto.randomUUID(), x: 400, y: 300 };
          coins.current.push(initialCoin);
          channel.send({ type: 'broadcast', event: 'coin_spawn', payload: { coin: initialCoin } });
        }
      }
    });

    // 5. Setup Keyboard Listeners
    const handleKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if (k === 'arrowup') keys.current.w = true;
        if (k === 'arrowdown') keys.current.s = true;
        if (k === 'arrowleft') keys.current.a = true;
        if (k === 'arrowright') keys.current.d = true;
        if (keys.current[k] !== undefined) keys.current[k] = true;
      }
    };
    const handleKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup') keys.current.w = false;
      if (k === 'arrowdown') keys.current.s = false;
      if (k === 'arrowleft') keys.current.a = false;
      if (k === 'arrowright') keys.current.d = false;
      if (keys.current[k] !== undefined) keys.current[k] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // 6. The Game Loop (60 FPS)
    let animationFrameId;
    let lastPresenceSync = 0;

    const gameLoop = (timestamp) => {
      // --- PHYSICS ---
      let moved = false;
      if (keys.current.w && myState.current.y > PLAYER_RADIUS) { myState.current.y -= PLAYER_SPEED; moved = true; }
      if (keys.current.s && myState.current.y < CANVAS_HEIGHT - PLAYER_RADIUS) { myState.current.y += PLAYER_SPEED; moved = true; }
      if (keys.current.a && myState.current.x > PLAYER_RADIUS) { myState.current.x -= PLAYER_SPEED; moved = true; }
      if (keys.current.d && myState.current.x < CANVAS_WIDTH - PLAYER_RADIUS) { myState.current.x += PLAYER_SPEED; moved = true; }

      // --- COLLISION DETECTION (Coins) ---
      for (let i = 0; i < coins.current.length; i++) {
        const c = coins.current[i];
        const dist = Math.hypot(myState.current.x - c.x, myState.current.y - c.y);
        
        if (dist < PLAYER_RADIUS + COIN_RADIUS) {
          // I collected the coin!
          coins.current.splice(i, 1);
          myState.current.score += 1;
          
          // Broadcast that I collected it
          channel.send({ type: 'broadcast', event: 'coin_collect', payload: { coinId: c.id } });
          
          // Spawn a new coin
          const newCoin = { 
            id: crypto.randomUUID(), 
            x: Math.random() * (CANVAS_WIDTH - 40) + 20, 
            y: Math.random() * (CANVAS_HEIGHT - 40) + 20 
          };
          coins.current.push(newCoin);
          channel.send({ type: 'broadcast', event: 'coin_spawn', payload: { coin: newCoin } });

          // If authenticated, grant them real Empire Points via RPC!
          if (session) {
            supabase.rpc('grant_points', { amount: 10 }).then(console.log).catch(console.error);
          }
          break; // only collect one per frame to avoid bugs
        }
      }

      // --- NETWORK SYNC (Throttle to 10 FPS to save bandwidth) ---
      if (moved && timestamp - lastPresenceSync > 100) {
        channel.track({
          x: myState.current.x,
          y: myState.current.y,
          color: myState.current.color,
          score: myState.current.score
        });
        lastPresenceSync = timestamp;
      }

      // --- RENDERING ---
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        
        // Background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Draw Coins
        ctx.fillStyle = '#ffd700'; // Gold
        coins.current.forEach(c => {
          ctx.beginPath();
          ctx.arc(c.x, c.y, COIN_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          // Glow effect
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#ffd700';
          ctx.fill();
          ctx.shadowBlur = 0; // reset
        });

        // Draw Other Players
        Object.values(otherPlayers.current).forEach(p => {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(`Score: ${p.score || 0}`, p.x, p.y - 20);
        });

        // Draw Me
        ctx.fillStyle = myState.current.color;
        ctx.beginPath();
        ctx.arc(myState.current.x, myState.current.y, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 20;
        ctx.shadowColor = myState.current.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`Me (${myState.current.score})`, myState.current.x, myState.current.y - 25);
      }

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      supabase.removeChannel(channel);
    };
  }, [playerId, session]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: '#000', minHeight: '100vh', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1 style={{ color: '#fff', textTransform: 'uppercase', letterSpacing: '2px', textShadow: '0 0 10px #00f3ff' }}>Empire Arena</h1>
      <p style={{ color: '#888' }}>Use W A S D to move. Collect coins to earn real Empire Points.</p>
      
      {!session && (
        <div style={{ background: '#330000', color: '#ff003c', padding: '10px 20px', borderRadius: '4px', marginBottom: '20px', border: '1px solid #ff003c' }}>
          <strong>Warning:</strong> You are playing as a Guest. Sign in via Headquarters to save your points!
        </div>
      )}

      <canvas 
        ref={canvasRef} 
        width={CANVAS_WIDTH} 
        height={CANVAS_HEIGHT} 
        style={{ 
          border: '2px solid #333', 
          borderRadius: '8px',
          boxShadow: '0 0 30px rgba(0, 243, 255, 0.1)'
        }}
      />
    </div>
  );
};

export default Arena;
