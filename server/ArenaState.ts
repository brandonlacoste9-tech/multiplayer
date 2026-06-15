import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("boolean") isBoosting: boolean = false;
  @type("uint16") sessionMass: number = 0;
  @type("number") hp: number = 100;
  @type("string") name: string = "";
  @type("boolean") isDead: boolean = false;
  @type("uint32") lastProcessedSequence: number = 0;
}

export class Coin extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("uint8") value: number = 1; // e.g. Tier 1 coin
}

export class Asteroid extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("uint8") size: number = 1;
}

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Coin }) coins = new MapSchema<Coin>();
  @type({ map: Asteroid }) asteroids = new MapSchema<Asteroid>();
}
