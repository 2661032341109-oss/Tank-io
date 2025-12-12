
import { Entity } from '../../types';

export interface ChatMessage {
    id: string;
    sender: string;
    content: string;
    isSystem?: boolean;
    timestamp: number;
}

export interface KillFeedItem {
    id: string;
    killer: string;
    victim: string;
    icon?: string;
    timestamp: number;
}

export class ChatManager {
    messages: ChatMessage[] = [];
    killFeed: KillFeedItem[] = [];
    
    private phrases = [
        "Team?", "Plz team", "Lag", "gg", "wow", "nice shot", "ez", "help", 
        "Stop running", "1v1 me", "Need healer", "Base?", "Defend nest", 
        "Pushing mid", "Anyone active?", "lol", "rip", "Upgrade stats?",
        "How do I evolve?", "Fallen Booster op", "Nerf penta"
    ];

    private deathPhrases = [
        "Nooo!", "My score :(", "Lag spike", "Hacker", "Unlucky", "revenge time", 
        "really?", "aimbot", "gg wp", "..."
    ];

    private killPhrases = [
        "Gotcha", "Sit down", "ez kill", "Target eliminated", "Next?", "Don't touch me"
    ];

    constructor(private onUpdate: () => void) {
        // Initial welcome message
        this.addMessage("System", "Welcome to Tank.io! Press Enter to chat.", true);
    }

    addMessage(sender: string, content: string, isSystem = false) {
        this.messages.push({
            id: Math.random().toString(36),
            sender,
            content,
            isSystem,
            timestamp: Date.now()
        });
        if (this.messages.length > 20) this.messages.shift();
        this.onUpdate();
    }

    addKill(killer: string, victim: string) {
        this.killFeed.push({
            id: Math.random().toString(36),
            killer,
            victim,
            timestamp: Date.now()
        });
        if (this.killFeed.length > 5) this.killFeed.shift();
        this.onUpdate();
    }

    // Call this periodically to generate fake chatter
    update(dt: number, entities: Entity[]) {
        // Randomly generate general chat
        if (Math.random() < 0.005) { // Roughly every 3-4 seconds check
            const bots = entities.filter(e => e.type === 'ENEMY' && !e.isDead);
            if (bots.length > 0) {
                const randomBot = bots[Math.floor(Math.random() * bots.length)];
                if (randomBot.name) {
                    const phrase = this.phrases[Math.floor(Math.random() * this.phrases.length)];
                    this.addMessage(randomBot.name, phrase);
                }
            }
        }
    }

    handleDeath(victim: Entity, killer: Entity) {
        const victimName = victim.id === 'player' ? (victim.name || "Player") : (victim.name || "Tank");
        const killerName = killer.id === 'player' ? (killer.name || "Player") : (killer.name || "Tank");

        this.addKill(killerName, victimName);

        // 10% Chance for victim to complain
        if (Math.random() < 0.3 && victim.name && victim.type !== 'SHAPE' && victim.type !== 'BOSS') {
            const phrase = this.deathPhrases[Math.floor(Math.random() * this.deathPhrases.length)];
            setTimeout(() => this.addMessage(victimName, phrase), 1000);
        }

        // 5% Chance for killer to taunt
        if (Math.random() < 0.2 && killer.name && killer.type !== 'SHAPE' && killer.type !== 'BOSS') {
            const phrase = this.killPhrases[Math.floor(Math.random() * this.killPhrases.length)];
            setTimeout(() => this.addMessage(killerName, phrase), 1500);
        }
    }
}
