
import { Vector2, Entity, StatKey, PlayerState, GameSettings, BossType, GameMode, FactionType, EntityType, AIPersonality, Barrel, WorldSnapshot } from '../types';
import { RenderSystem } from './systems/RenderSystem';
import { AISystem } from './systems/AISystem';
import { WorldSystem } from './systems/WorldSystem';
import { MapSystem } from './systems/MapSystem'; 
import { ParticleSystem } from './systems/ParticleSystem';
import { PhysicsSystem } from './systems/PhysicsSystem'; 
import { COLORS, TEAM_COLORS } from '../constants';

// Managers & Controllers
import { InputManager } from './managers/InputManager';
import { PlayerManager } from './managers/PlayerManager';
import { NotificationManager } from './managers/NotificationManager';
import { LeaderboardManager } from './managers/LeaderboardManager';
import { SpawnManager } from './managers/SpawnManager';
import { CameraManager } from './managers/CameraManager';
import { CommandManager } from './managers/CommandManager';
import { EntityManager } from './managers/EntityManager';
import { DeathManager } from './managers/DeathManager';
import { LoopManager } from './managers/LoopManager';
import { AudioManager } from './managers/AudioManager';
import { ChatManager } from './managers/ChatManager';
import { NetworkManager } from './managers/NetworkManager'; // NEW

import { PlayerController } from './controllers/PlayerController';
import { AIController } from './controllers/AIController';
import { WorldController } from './controllers/WorldController';
import { StatManager } from './managers/StatManager';
import { StatusEffectSystem } from './systems/StatusEffectSystem';
import { MinimapSystem } from './systems/MinimapSystem'; 

export class GameEngine {
  canvas: HTMLCanvasElement;
  settings: GameSettings;
  gameMode: GameMode;
  
  // Systems & Managers
  renderSystem: RenderSystem;
  minimapSystem: MinimapSystem; 
  inputManager: InputManager;
  loopManager: LoopManager;
  statusEffectSystem: StatusEffectSystem;
  
  // State Managers
  playerManager: PlayerManager;
  notificationManager: NotificationManager;
  leaderboardManager: LeaderboardManager;
  spawnManager: SpawnManager;
  cameraManager: CameraManager;
  commandManager: CommandManager;
  entityManager: EntityManager;
  deathManager: DeathManager;
  audioManager: AudioManager;
  statManager: StatManager;
  chatManager: ChatManager;
  networkManager: NetworkManager; // NEW
  
  // Controllers (Logic)
  playerController: PlayerController;
  aiController: AIController;
  worldController: WorldController;
  
  onUpdateStats: (stats: PlayerState) => void;

  constructor(
      canvas: HTMLCanvasElement, 
      settings: GameSettings, 
      gameMode: GameMode, 
      playerName: string, 
      faction: FactionType,
      initialClass: string,
      onUpdateStats: (stats: PlayerState) => void,
      minimapCanvas: HTMLCanvasElement | null 
    ) {
    this.canvas = canvas;
    this.settings = settings;
    this.gameMode = gameMode;
    this.onUpdateStats = onUpdateStats;
    
    // 1. Base Systems
    this.renderSystem = new RenderSystem(canvas);
    this.minimapSystem = new MinimapSystem(); 
    if (minimapCanvas) this.minimapSystem.setCanvas(minimapCanvas);

    this.inputManager = new InputManager(canvas, settings);
    this.audioManager = new AudioManager(settings.audio);
    this.statusEffectSystem = new StatusEffectSystem();
    
    // 2. State Managers
    this.notificationManager = new NotificationManager();
    this.leaderboardManager = new LeaderboardManager();
    this.spawnManager = new SpawnManager();
    this.cameraManager = new CameraManager();
    this.entityManager = new EntityManager();
    this.statManager = new StatManager();
    
    this.chatManager = new ChatManager(() => {});
    this.networkManager = new NetworkManager(); // NEW

    // Determine Team
    let playerTeam = undefined;
    if (this.gameMode === 'TEAMS_2' || this.gameMode === 'TEAMS_4') playerTeam = 'BLUE';

    // 3. Player & Death
    this.playerManager = new PlayerManager(
        playerName, 
        playerTeam, 
        onUpdateStats, 
        this.audioManager,
        this.statusEffectSystem,
        (pos) => { // On Level Up
            PhysicsSystem.spawnFloatingText(this.entityManager.entities, pos, "LEVEL UP!", "#ffd700", true);
            ParticleSystem.spawnLevelUpEffect(this.entityManager.entities, pos, "#ffd700");
        }
    );
    this.playerManager.setStatManager(this.statManager);
    this.playerManager.setFaction(faction);
    if (initialClass && initialClass !== 'basic') {
        this.playerManager.evolve(initialClass);
    }
    this.playerManager.entity.pos = this.entityManager.getSpawnPos(playerTeam);

    this.deathManager = new DeathManager(
        this.playerManager, 
        this.notificationManager, 
        this.cameraManager, 
        this.audioManager,
        this.settings
    );

    // 4. Controllers
    this.playerController = new PlayerController(this.inputManager, this.playerManager, this.settings, this.canvas, this.audioManager, this.cameraManager); 
    this.aiController = new AIController(this.audioManager, this.statManager, this.statusEffectSystem);
    this.worldController = new WorldController(
        this.entityManager,
        this.playerManager,
        this.deathManager,
        this.inputManager,
        this.canvas,
        this.settings,
        this.audioManager,
        this.statManager,
        this.statusEffectSystem,
        this.spawnManager,
        this.gameMode 
    );

    this.commandManager = new CommandManager(
        this.renderSystem, 
        this.settings, 
        this.spawnBoss.bind(this), 
        this.closeArena.bind(this)
    );

    // 5. Loop Manager
    this.loopManager = new LoopManager(
        (dt) => this.update(dt),
        () => this.render()
    );

    this.bindExtraEvents();
    this.initWorld();
    this.bindNetworkEvents(); // NEW
    
    this.loopManager.start();
  }

  destroy() {
    this.loopManager.stop();
    this.inputManager.destroy();
    this.networkManager.disconnect(); // NEW
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  bindNetworkEvents() {
    // --- MOCK Events ---
    this.networkManager.on('player_joined', (data) => {
        const botIndex = this.entityManager.entities.findIndex(e => e.type === EntityType.ENEMY);
        if (botIndex !== -1) {
            this.entityManager.entities.splice(botIndex, 1);
        }

        const newPlayer: Entity = {
            id: data.id,
            name: data.name,
            type: EntityType.PLAYER,
            pos: data.pos,
            vel: { x: 0, y: 0 },
            radius: 20,
            rotation: 0,
            color: this.gameMode.includes('TEAMS') ? TEAM_COLORS[data.teamId as keyof typeof TEAM_COLORS] || COLORS.enemy : COLORS.enemy,
            health: 100,
            maxHealth: 100,
            damage: 20,
            isDead: false,
            teamId: this.gameMode.includes('TEAMS') ? data.teamId : data.id,
            classPath: data.classPath,
            scoreValue: Math.floor(Math.random() * 10000),
            aiState: 'WANDER',
            aiPersonality: AIPersonality.BALANCED,
        };
        this.entityManager.add(newPlayer);
        this.notificationManager.push(`${data.name} has joined the game.`, 'info');
        this.chatManager.addMessage("System", `${data.name} has joined.`, true);
    });

    this.networkManager.on('player_left', () => {
        const remotePlayers = this.entityManager.entities.filter(e => e.type === EntityType.PLAYER && e.id !== 'player');
        if (remotePlayers.length > 0) {
            const playerToRemove = remotePlayers[Math.floor(Math.random() * remotePlayers.length)];
            this.entityManager.entities = this.entityManager.entities.filter(e => e.id !== playerToRemove.id);
            
            this.notificationManager.push(`${playerToRemove.name} has left the game.`, 'warning');
            this.chatManager.addMessage("System", `${playerToRemove.name} has left.`, true);

            AISystem.spawnBots(this.entityManager.entities, 1, this.gameMode, this.entityManager.getSpawnPos.bind(this.entityManager));
        }
    });

    // --- REAL SERVER UPDATE (Interpolation) ---
    this.networkManager.on('world_update', (snapshot: WorldSnapshot) => {
        // This is where we would reconcile server state with client state
        // For now, we stub this out for future implementation
        snapshot.entities.forEach(s => {
            const ent = this.entityManager.entities.find(e => e.id === s.id);
            if (ent) {
                // Smooth interpolation target
                ent.targetPos = { x: s.x, y: s.y };
                ent.lerpFactor = 0.5; // Smooth factor
                ent.rotation = s.r;
            }
        });
    });
  }

  initWorld() {
      MapSystem.generateMap(this.entityManager.entities, this.gameMode);

      if (this.gameMode === 'SANDBOX') {
           // Sandbox spawning managed by update loop
      } else {
           WorldSystem.spawnShapes(this.entityManager.entities, 80, this.gameMode);
           AISystem.spawnBots(this.entityManager.entities, 30, this.gameMode, this.entityManager.getSpawnPos.bind(this.entityManager));
      }
  }

  update(dt: number) {
    const entities = this.entityManager.entities;
    const player = this.playerManager.entity;

    // Hook Chat System
    this.chatManager.update(dt, entities);

    // --- NETWORKING: Send Inputs ---
    if (!player.isDead) {
        const moveVec = this.inputManager.getMovementVector();
        this.networkManager.sendInput({
            x: moveVec.x,
            y: moveVec.y,
            angle: player.rotation,
            fire: this.inputManager.mouseDown || this.settings.gameplay.autoFire
        });
    }

    // --- NETWORKING: Apply Interpolation for Remote Entities ---
    entities.forEach(e => {
        if (e.targetPos) {
            e.pos.x += (e.targetPos.x - e.pos.x) * 0.2;
            e.pos.y += (e.targetPos.y - e.pos.y) * 0.2;
        }
    });

    // Enhanced Death Handler with Chat Integration
    const handleDeath = (v: Entity, k: Entity) => {
        this.deathManager.handleDeath(v, k, this.entityManager.entities);
        
        // Resolve the actual killer (owner of bullet/drone) for accurate chat/kill feed
        let actualKiller = k;
        if (['BULLET', 'DRONE', 'TRAP'].includes(k.type) && k.ownerId) {
            const owner = this.entityManager.entities.find(e => e.id === k.ownerId);
            if (owner) {
                actualKiller = owner;
            } else if (k.ownerId === this.playerManager.entity.id) {
                actualKiller = this.playerManager.entity;
            }
        }
        this.chatManager.handleDeath(v, actualKiller);
    };

    const handleHitscan = (start: Vector2, angle: number, owner: Entity, barrel: Barrel) => 
        PhysicsSystem.processHitscan(start, angle, owner, barrel, entities, player, handleDeath, this.cameraManager, this.statManager, this.statusEffectSystem, this.audioManager);

    if (this.notificationManager.update()) {
        this.playerManager.state.notifications = this.notificationManager.notifications;
    }
    
    this.spawnManager.update(
        dt, 
        entities, 
        player, 
        this.gameMode, 
        this.entityManager.getSpawnPos.bind(this.entityManager),
        this.pushNotification.bind(this)
    );

    this.playerManager.update(dt);
    this.playerController.update(dt, entities, this.pushNotification.bind(this));
    if (!player.isDead) {
        this.playerController.handleFiring(dt, entities, handleHitscan);
    }
    this.aiController.update(dt, entities, player, this.cameraManager, handleDeath);
    
    this.worldController.update(dt, this.playerController.autoSpin, this.cameraManager, handleDeath);
    
    ParticleSystem.update(entities, dt);
    
    if (this.leaderboardManager.shouldUpdate()) {
        this.leaderboardManager.update(entities, player, this.playerManager.state);
        this.playerManager.emitUpdate();
    }
  }

  render() {
    const cameraConfig = this.cameraManager.getCameraTarget(this.playerManager.entity, this.entityManager.entities);
    
    this.renderSystem.draw(
        this.entityManager.entities, 
        this.playerManager.entity, 
        this.playerManager.state, 
        this.playerManager.activeAbilityTimer, 
        cameraConfig, 
        this.gameMode,
        this.settings
    );

    this.minimapSystem.update(
        this.entityManager.entities,
        this.playerManager.entity,
        { 
            pos: cameraConfig.pos, 
            zoom: cameraConfig.zoom,
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height
        },
        this.gameMode,
        this.spawnManager.getNextBossTime() 
    );
  }
  
  private handleKeyDown = (e: KeyboardEvent) => {
      if (this.playerManager.entity.isDead && (e.code === 'Enter')) this.respawn();
      
      const handleDeath = (v: Entity, k: Entity) => {
        this.deathManager.handleDeath(v, k, this.entityManager.entities);
        
        let actualKiller = k;
        if (['BULLET', 'DRONE', 'TRAP'].includes(k.type) && k.ownerId) {
            const owner = this.entityManager.entities.find(e => e.id === k.ownerId);
            if (owner) {
                actualKiller = owner;
            } else if (k.ownerId === this.playerManager.entity.id) {
                actualKiller = this.playerManager.entity;
            }
        }
        this.chatManager.handleDeath(v, actualKiller);
    };
      
      this.playerController.handleKeyDown(e, this.pushNotification.bind(this), handleDeath);

      if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].includes(e.code)) {
          const map: Record<string, StatKey> = {
              'Digit1': 'regen', 'Digit2': 'maxHp', 'Digit3': 'bodyDmg',
              'Digit4': 'bulletSpd', 'Digit5': 'bulletPen', 'Digit6': 'bulletDmg',
              'Digit7': 'reload', 'Digit8': 'moveSpd'
          };
          this.upgradeStat(map[e.code]);
      }
  };

  bindExtraEvents() {
      window.addEventListener('keydown', this.handleKeyDown);
  }

  spawnBoss(forcedType?: BossType) {
      this.spawnManager.spawnBoss(this.entityManager.entities, this.playerManager.entity, this.pushNotification.bind(this), forcedType);
  }

  closeArena() {
      this.spawnManager.closeArena(this.pushNotification.bind(this));
  }

  respawn() {
      if (this.spawnManager.isArenaClosing) {
          alert("Arena Closed. Please refresh to join a new server.");
          window.location.reload();
          return;
      }

      if (!this.playerManager.entity.isDead) return;
      
      const spawnPos = this.entityManager.getSpawnPos(this.playerManager.entity.teamId);
      this.playerManager.reset(spawnPos);
  }

  upgradeStat(key: StatKey) {
      this.playerManager.upgradeStat(key);
  }

  evolve(className: string) {
      this.playerManager.evolve(className);
  }

  pushNotification(message: string, type: 'info' | 'warning' | 'success' | 'boss' = 'info') {
      this.notificationManager.push(message, type);
  }

  executeCommand(cmd: string): string {
      return this.commandManager.execute(cmd);
  }

  // --- SANDBOX CHEATS ---
  cheatLevelUp() { this.playerManager.gainXp(9999999, 1.0); }
  cheatSetLevel(lvl: number) { this.playerManager.setLevel(lvl); }
  cheatMaxStats() {
      this.playerManager.state.availablePoints += 33;
      (Object.keys(this.playerManager.state.stats) as StatKey[]).forEach(k => {
          if(k !== 'critChance' && k !== 'critDamage') this.playerManager.state.stats[k] = 7;
      });
      this.playerManager.emitUpdate();
  }
  cheatToggleGodMode() { 
      this.playerManager.state.godMode = !this.playerManager.state.godMode;
      this.pushNotification(`God Mode ${this.playerManager.state.godMode ? 'ON' : 'OFF'}`);
  }
  cheatSpawnDummy() {
      AISystem.spawnBots(this.entityManager.entities, 1, 'SANDBOX', () => ({x: 1500, y: 1500}));
  }
  cheatSpawnBoss() {
      this.spawnManager.spawnBoss(this.entityManager.entities, this.playerManager.entity, this.pushNotification.bind(this));
  }
  cheatClassSwitch(id: string) {
      this.playerManager.evolve(id);
  }
  cheatSuicide() {
      this.deathManager.handleDeath(this.playerManager.entity, this.playerManager.entity, this.entityManager.entities);
  }
  
  updateSettings(newSettings: GameSettings) {
    this.settings = newSettings;
    this.audioManager.updateSettings(newSettings.audio);
    this.deathManager.updateSettings(newSettings);
    this.worldController.updateSettings(newSettings);
  }
}
