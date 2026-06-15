import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import http from "http";
import { ArenaRoom } from "./ArenaRoom";

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server
  })
});

// Register ArenaRoom
gameServer.define("arena", ArenaRoom);

// Express routes
app.get("/", (req, res) => {
  res.send("Colyseus Empire Server is Online");
});

gameServer.listen(port).then(() => {
    console.log(`🎮 Empire Server is listening on http://localhost:${port}`);
});
