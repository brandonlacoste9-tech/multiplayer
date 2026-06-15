import React, { useEffect, useRef, useState } from 'react';
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
  const colors = ['#00f3ff', '#ff003c', '#00ffaa', '#f7931a', '#ff00ff', '#ffff00', '#ffffff'];
  return colors[Math.floor(Math.random() * colors.length)];
};

const Arena = () => {
  const canvasRef = useRef(null);
  const [playerId, setPlayerId] = useState(null);
  const [session, setSession] = useState(null);
  const [isDead, setIsDead] = useState(false);

  // Game State Refs
  const myState = useRef({
    x: Math.random() * MAP_WIDTH,
    y: Math.random() * MAP_HEIGHT,
    radius: START_RADIUS,
    color: getRandomColor(),
    name: 'Guest',
    score: 0
  });
  
  const mouse = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const otherPlayers = useRef({});
  const foods = useRef([]);
  const empireCoins = useRef([]);
  const channelRef = useRef(null);

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      const uuid = session?.user?.id || crypto.randomUUID();
      setPlayerId(uuid);
      if (session?.user?.email) {
        myState.current.name = session.user.email.split('@')[0];
      }
    };
    initAuth();
  }, []);

  const spawnFood = () => ({
    id: crypto.randomUUID(),
    x: Math.random() * MAP_WIDTH,
    y: Math.random() * MAP_HEIGHT,
    color: getRandomColor()
  });

  const respawn = () => {
    myState.current = {
      ...myState.current,
      x: Math.random() * MAP_WIDTH,
      y: Math.random() * MAP_HEIGHT,
      radius: START_RADIUS,
      score: 0
    };
    setIsDead(false);
  };

  useEffect(() => {
    if (!playerId) return;

    const channel = supabase.channel('empire_agar', {
      config: { presence: { key: playerId } }
    });
    channelRef.current = channel;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const updatedPlayers = {};
      for (const [key, presences] of Object.entries(state)) {
        if (key !== playerId && presences.length > 0) {
          updatedPlayers[key] = presences[0];
        }
      }
      otherPlayers.current = updatedPlayers;
    });

    channel.on('broadcast', { event: 'food_eaten' }, (payload) => {
      foods.current = foods.current.filter(f => f.id !== payload.payload.id);
    });

    channel.on('broadcast', { event: 'food_spawn' }, (payload) => {
      foods.current.push(payload.payload.food);
    });

    channel.on('broadcast', { event: 'coin_eaten' }, (payload) => {
      empireCoins.current = empireCoins.current.filter(c => c.id !== payload.payload.id);
    });

    channel.on('broadcast', { event: 'player_eaten' }, (payload) => {
      // If someone broadcasted that THEY ate ME, I need to die.
      if (payload.payload.victimId === playerId) {
        setIsDead(true);
      }
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Init presence
        await channel.track({
          x: myState.current.x,
          y: myState.current.y,
          radius: myState.current.radius,
          color: myState.current.color,
          name: myState.current.name,
          score: myState.current.score
        });

        // Initialize food if we are alone
        if (foods.current.length === 0) {
          const initialFoods = Array.from({ length: 50 }, spawnFood);
          foods.current = initialFoods;
          // Spawn one rare empire coin
          empireCoins.current.push({ id: crypto.randomUUID(), x: Math.random() * MAP_WIDTH, y: Math.random() * MAP_HEIGHT });
        }
      }
    });

    const handleMouseMove = (e) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // set initial size

    let animationFrameId;
    let lastPresenceSync = 0;
    let lastFoodSpawn = 0;

    const gameLoop = (timestamp) => {
      if (isDead) {
        renderDeathScreen();
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
      }

      // --- PHYSICS / MOVEMENT ---
      const canvas = canvasRef.current;
      const hw = canvas.width / 2;
      const hh = canvas.height / 2;

      // Calculate direction vector from center of screen to mouse
      let dx = mouse.current.x - hw;
      let dy = mouse.current.y - hh;
      const distToMouse = Math.hypot(dx, dy);

      // Speed inversely proportional to radius
      const speed = Math.max(1.5, 50 / Math.sqrt(myState.current.radius)); 

      if (distToMouse > 10) {
        // Normalize and scale
        myState.current.x += (dx / distToMouse) * speed;
        myState.current.y += (dy / distToMouse) * speed;
      }

      // Keep in bounds
      myState.current.x = Math.max(myState.current.radius, Math.min(MAP_WIDTH - myState.current.radius, myState.current.x));
      myState.current.y = Math.max(myState.current.radius, Math.min(MAP_HEIGHT - myState.current.radius, myState.current.y));

      // --- FOOD COLLISION ---
      for (let i = foods.current.length - 1; i >= 0; i--) {
        const f = foods.current[i];
        const dist = Math.hypot(myState.current.x - f.x, myState.current.y - f.y);
        if (dist < myState.current.radius) {
          foods.current.splice(i, 1);
          // Increase area: new_radius = sqrt(r^2 + f_r^2)
          myState.current.radius = Math.sqrt(myState.current.radius ** 2 + FOOD_RADIUS ** 2);
          myState.current.score += 1;
          channel.send({ type: 'broadcast', event: 'food_eaten', payload: { id: f.id } });
        }
      }

      // --- EMPIRE COIN COLLISION ---
      for (let i = empireCoins.current.length - 1; i >= 0; i--) {
        const c = empireCoins.current[i];
        const dist = Math.hypot(myState.current.x - c.x, myState.current.y - c.y);
        if (dist < myState.current.radius) {
          empireCoins.current.splice(i, 1);
          myState.current.radius = Math.sqrt(myState.current.radius ** 2 + (EMPIRE_COIN_RADIUS*2) ** 2);
          myState.current.score += 50;
          channel.send({ type: 'broadcast', event: 'coin_eaten', payload: { id: c.id } });
          
          if (session) {
            supabase.rpc('grant_points', { amount: 50 }).then(console.log).catch(console.error);
          }
        }
      }

      // --- PLAYER PVP COLLISION ---
      for (const [otherId, p] of Object.entries(otherPlayers.current)) {
        const dist = Math.hypot(myState.current.x - p.x, myState.current.y - p.y);
        if (dist < myState.current.radius && myState.current.radius > p.radius * 1.15) {
          // I ATE THEM!
          myState.current.radius = Math.sqrt(myState.current.radius ** 2 + p.radius ** 2);
          myState.current.score += p.score || 10;
          channel.send({ type: 'broadcast', event: 'player_eaten', payload: { victimId: otherId } });
          delete otherPlayers.current[otherId]; // Remove locally until presence updates
        }
      }

      // --- AUTO SPAWN FOOD (if leader) ---
      if (timestamp - lastFoodSpawn > 1000 && foods.current.length < MAX_FOOD) {
        const f = spawnFood();
        foods.current.push(f);
        channel.send({ type: 'broadcast', event: 'food_spawn', payload: { food: f } });
        lastFoodSpawn = timestamp;
      }

      // --- NETWORK SYNC ---
      if (timestamp - lastPresenceSync > 100) {
        channel.track({
          x: myState.current.x,
          y: myState.current.y,
          radius: myState.current.radius,
          color: myState.current.color,
          name: myState.current.name,
          score: myState.current.score
        });
        lastPresenceSync = timestamp;
      }

      renderGame();
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    const renderGame = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const hw = canvas.width / 2;
      const hh = canvas.height / 2;

      // Clear
      ctx.fillStyle = '#0f172a'; // dark slate
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Camera translation: Move world so player is at center
      ctx.translate(hw - myState.current.x, hh - myState.current.y);

      // Draw Grid
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      const gridSize = 50;
      for (let x = 0; x <= MAP_WIDTH; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_HEIGHT); ctx.stroke();
      }
      for (let y = 0; y <= MAP_HEIGHT; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_WIDTH, y); ctx.stroke();
      }

      // Draw Map Border
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 5;
      ctx.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

      // Draw Food
      foods.current.forEach(f => {
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, FOOD_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Empire Coins
      empireCoins.current.forEach(c => {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(c.x, c.y, EMPIRE_COIN_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#fbbf24';
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Draw Other Players
      Object.values(otherPlayers.current).forEach(p => {
        drawCell(ctx, p.x, p.y, p.radius, p.color, p.name, p.score);
      });

      // Draw Me
      drawCell(ctx, myState.current.x, myState.current.y, myState.current.radius, myState.current.color, myState.current.name, myState.current.score);

      ctx.restore();

      // UI Overlay (Leaderboard)
      renderLeaderboard(ctx);
    };

    const drawCell = (ctx, x, y, radius, color, name, score) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      
      // Glow
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Text
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const fontSize = Math.max(12, radius / 3);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillText(name || 'Unknown', x, y - fontSize/2);
      
      ctx.font = `${fontSize * 0.8}px sans-serif`;
      ctx.fillText(score || 0, x, y + fontSize/2);
    };

    const renderLeaderboard = (ctx) => {
      const canvas = canvasRef.current;
      const allPlayers = [
        { name: myState.current.name, score: myState.current.score },
        ...Object.values(otherPlayers.current).map(p => ({ name: p.name, score: p.score }))
      ];
      allPlayers.sort((a, b) => b.score - a.score);
      const top5 = allPlayers.slice(0, 5);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(canvas.width - 220, 20, 200, 30 + top5.length * 25);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Leaderboard', canvas.width - 210, 45);

      ctx.font = '14px sans-serif';
      top5.forEach((p, idx) => {
        ctx.fillText(`${idx + 1}. ${p.name}`, canvas.width - 210, 75 + idx * 25);
        ctx.fillText(p.score, canvas.width - 60, 75 + idx * 25);
      });
    };

    const renderDeathScreen = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#ff003c';
      ctx.font = 'bold 60px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('YOU WERE EATEN', canvas.width/2, canvas.height/2 - 50);
      
      ctx.fillStyle = '#fff';
      ctx.font = '20px sans-serif';
      ctx.fillText('Click anywhere to respawn', canvas.width/2, canvas.height/2 + 20);
    };

    animationFrameId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      supabase.removeChannel(channel);
    };
  }, [playerId, session, isDead]);

  return (
    <div 
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', cursor: 'crosshair', position: 'relative' }}
      onClick={() => isDead && respawn()}
    >
      {!session && (
        <div style={{ position: 'absolute', top: 20, left: 20, background: '#330000', color: '#ff003c', padding: '10px 20px', borderRadius: '4px', border: '1px solid #ff003c', zIndex: 10 }}>
          <strong>Warning:</strong> Guest Mode. Sign in via Headquarters to save Empire Points.
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
};

export default Arena;
