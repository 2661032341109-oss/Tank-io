
import { MapConfig, GameMode } from '../../types';
import { WORLD_SIZE, SANDBOX_SIZE, TEAM_COLORS, COLORS } from '../../constants';

// =========================================================================
//  MAP CONFIGURATION REGISTRY
//  This file controls the layout of every game mode.
// =========================================================================

const BASE_PADDING = 600; // Distance from edge for 2-team bases
const CORNER_SIZE = 1000; // Size of corner bases for 4-teams

export const MAP_DEFINITIONS: Record<GameMode, MapConfig> = {
    
    'FFA': {
        id: 'FFA',
        width: WORLD_SIZE,
        height: WORLD_SIZE,
        zones: [],
        walls: [],
        biomeType: 'DEFAULT'
    },

    'TEAMS_2': {
        id: 'TEAMS_2',
        width: WORLD_SIZE,
        height: WORLD_SIZE,
        zones: [
            { x: BASE_PADDING / 2, y: WORLD_SIZE / 2, width: BASE_PADDING, height: WORLD_SIZE, type: 'BASE', teamId: 'BLUE', color: TEAM_COLORS.BLUE },
            { x: WORLD_SIZE - (BASE_PADDING / 2), y: WORLD_SIZE / 2, width: BASE_PADDING, height: WORLD_SIZE, type: 'BASE', teamId: 'RED', color: TEAM_COLORS.RED }
        ],
        walls: [],
        biomeType: 'DEFAULT'
    },

    'TEAMS_4': {
        id: 'TEAMS_4',
        width: WORLD_SIZE,
        height: WORLD_SIZE,
        zones: [
            { x: CORNER_SIZE/2, y: CORNER_SIZE/2, width: CORNER_SIZE, height: CORNER_SIZE, type: 'BASE', teamId: 'BLUE', color: TEAM_COLORS.BLUE },
            { x: CORNER_SIZE/2, y: WORLD_SIZE - CORNER_SIZE/2, width: CORNER_SIZE, height: CORNER_SIZE, type: 'BASE', teamId: 'GREEN', color: TEAM_COLORS.GREEN },
            { x: WORLD_SIZE - CORNER_SIZE/2, y: CORNER_SIZE/2, width: CORNER_SIZE, height: CORNER_SIZE, type: 'BASE', teamId: 'PURPLE', color: TEAM_COLORS.PURPLE },
            { x: WORLD_SIZE - CORNER_SIZE/2, y: WORLD_SIZE - CORNER_SIZE/2, width: CORNER_SIZE, height: CORNER_SIZE, type: 'BASE', teamId: 'RED', color: TEAM_COLORS.RED },
        ],
        walls: [],
        biomeType: 'DEFAULT'
    },

    'MAZE': {
        id: 'MAZE',
        width: WORLD_SIZE,
        height: WORLD_SIZE,
        zones: [],
        walls: [],
        generateMaze: true,
        biomeType: 'DEFAULT'
    },

    // --- SANDBOX MODE (REDESIGNED) ---
    // Increased size to 6000x6000 to be noticeably larger than standard FFA
    'SANDBOX': {
        id: 'SANDBOX',
        width: 6000, 
        height: 6000,
        zones: [
            // Central Safe Testing Zone (Darker Floor)
            { 
                x: 3000, 
                y: 3000, 
                width: 1500, 
                height: 1500, 
                type: 'SAFE', 
                color: '#1a1a24', 
                teamId: undefined 
            }
        ],
        walls: [
            // TESTING WALLS: To test bounce/ricochet and wall avoidance
            // Top Left Corner Box
            { x: 500, y: 500, width: 200, height: 50 },
            { x: 1000, y: 500, width: 50, height: 200 },
            
            // Bottom Left Corner Box
            { x: 500, y: 1500, width: 200, height: 200 },
            
            // Long Wall for Ricochet
            { x: 2500, y: 1000, width: 50, height: 800 }
        ],
        biomeType: 'SANDBOX'
    }
};
