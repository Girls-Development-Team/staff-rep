import { Guild, GuildMember, Collection, Role } from 'discord.js';
import { CustomClient } from '../types';
import { staffConfig } from './StaffLogic';

export interface RoleCacheEntry {
    roleId: string;
    roleName: string;
    rank: number;
    role: Role;
    members: Collection<string, GuildMember>;
    lastUpdated: number;
}

export class RoleCache {
    private static instance: RoleCache;
    private cache: Map<string, RoleCacheEntry> = new Map();
    private guild: Guild | null = null;
    private updateInterval: NodeJS.Timeout | null = null;
    private readonly CACHE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private isUpdating: boolean = false;

    private constructor() {}

    public static getInstance(): RoleCache {
        if (!RoleCache.instance) {
            RoleCache.instance = new RoleCache();
        }
        return RoleCache.instance;
    }

    /**
     * Initialize the role cache with a guild
     * @param guild The guild to cache roles from
     * @param autoUpdate Whether to automatically update the cache periodically
     */
    public async initialize(guild: Guild, autoUpdate: boolean = true): Promise<void> {
        this.guild = guild;
        
        console.log('🔄 Initializing Role Cache...');
        await this.updateAllRoles();
        console.log(`✅ Role Cache initialized with ${this.cache.size} staff roles.`);

        if (autoUpdate && !this.updateInterval) {
            this.startAutoUpdate();
        }
    }

    /**
     * Fetches roles from staffConfig, then gets members directly from each role
     * This uses role.members which is populated after guild.members.fetch()
     */
    private async updateAllRoles(): Promise<void> {
        if (!this.guild) {
            console.warn('⚠️ Guild not set. Cannot update role cache.');
            return;
        }

        if (this.isUpdating) {
            console.warn('⚠️ Cache update already in progress, skipping...');
            return;
        }

        this.isUpdating = true;

        try {
            console.log('📋 Loading roles from staffConfig and fetching members...');
            
            // CRITICAL: Fetch all guild members ONCE
            // This populates the member cache so role.members will work
            await this.guild.members.fetch();
            
            // Now process each role from staffConfig
            for (const roleConfig of staffConfig.roles.staffHierarchy) {
                try {
                    // Step 1: Fetch the Role object from Discord
                    const role = await this.guild.roles.fetch(roleConfig.id);
                    
                    if (!role) {
                        console.warn(`⚠️ Role ${roleConfig.name} (${roleConfig.id}) not found in guild.`);
                        continue;
                    }

                    // Step 2: Get members directly from the role object
                    // role.members is a Collection<string, GuildMember> of everyone with this role
                    const roleMembers = role.members;

                    // Step 3: Store in cache
                    const cacheEntry: RoleCacheEntry = {
                        roleId: roleConfig.id,
                        roleName: roleConfig.name,
                        rank: roleConfig.rank,
                        role: role,
                        members: roleMembers,
                        lastUpdated: Date.now()
                    };

                    this.cache.set(roleConfig.id, cacheEntry);
                    
                    console.log(`✅ Cached ${roleMembers.size} members for role: ${roleConfig.name}`);
                } catch (error) {
                    console.error(`❌ Failed to cache role ${roleConfig.name}:`, error);
                }
            }

            const totalStaff = this.getAllStaffMembers().size;
            console.log(`📊 Role Cache complete: ${this.cache.size} roles, ${totalStaff} total staff members`);

        } catch (error) {
            console.error('❌ Failed to update role cache:', error);
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Start automatic cache updates
     */
    private startAutoUpdate(): void {
        this.updateInterval = setInterval(async () => {
            console.log('🔄 Auto-updating Role Cache...');
            await this.updateAllRoles();
        }, this.CACHE_UPDATE_INTERVAL);

        console.log(`⏰ Auto-update enabled (every ${this.CACHE_UPDATE_INTERVAL / 1000 / 60} minutes)`);
    }

    /**
     * Stop automatic cache updates
     */
    public stopAutoUpdate(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            console.log('⏸️ Auto-update disabled.');
        }
    }

    /**
     * Manually refresh the cache
     */
    public async refresh(): Promise<void> {
        console.log('🔄 Manually refreshing Role Cache...');
        await this.updateAllRoles();
    }

    /**
     * Get all members for a specific role
     * @param roleId The role ID to get members for
     * @returns Collection of members with that role, or null if not found
     */
    public getMembersByRole(roleId: string): Collection<string, GuildMember> | null {
        const entry = this.cache.get(roleId);
        return entry ? entry.members : null;
    }

    /**
     * Get all members for a specific role by role name
     * @param roleName The role name to get members for
     * @returns Collection of members with that role, or null if not found
     */
    public getMembersByRoleName(roleName: string): Collection<string, GuildMember> | null {
        const entry = Array.from(this.cache.values()).find(e => e.roleName === roleName);
        return entry ? entry.members : null;
    }

    /**
     * Get all members for a specific role by rank
     * @param rank The rank number to get members for
     * @returns Collection of members with that rank, or null if not found
     */
    public getMembersByRank(rank: number): Collection<string, GuildMember> | null {
        const entry = Array.from(this.cache.values()).find(e => e.rank === rank);
        return entry ? entry.members : null;
    }

    /**
     * Get the Role object for a specific role ID
     * @param roleId The role ID
     * @returns Role object or null
     */
    public getRole(roleId: string): Role | null {
        const entry = this.cache.get(roleId);
        return entry ? entry.role : null;
    }

    /**
     * Get the highest staff role a member has
     * @param userId The user ID to check
     * @returns RoleCacheEntry of their highest role, or null if not staff
     */
    public getHighestStaffRole(userId: string): RoleCacheEntry | null {
        const entries = Array.from(this.cache.values())
            .filter(entry => entry.members.has(userId))
            .sort((a, b) => b.rank - a.rank);

        return entries.length > 0 ? entries[0] : null;
    }

    /**
     * Check if a user has any staff role
     * @param userId The user ID to check
     * @returns true if user has at least one staff role
     */
    public isStaff(userId: string): boolean {
        return Array.from(this.cache.values()).some(entry => entry.members.has(userId));
    }

    /**
     * Get all staff members (across all staff roles)
     * @returns Collection of all unique staff members
     */
    public getAllStaffMembers(): Collection<string, GuildMember> {
        const allStaff = new Collection<string, GuildMember>();
        
        for (const entry of this.cache.values()) {
            for (const [userId, member] of entry.members) {
                if (!allStaff.has(userId)) {
                    allStaff.set(userId, member);
                }
            }
        }

        return allStaff;
    }

    /**
     * Get all role entries sorted by rank
     * @param descending Sort descending (highest rank first) if true
     */
    public getRolesByRank(descending: boolean = true): RoleCacheEntry[] {
        const entries = Array.from(this.cache.values());
        return descending 
            ? entries.sort((a, b) => b.rank - a.rank)
            : entries.sort((a, b) => a.rank - b.rank);
    }

    /**
     * Get cache statistics
     * @returns Object with cache statistics
     */
    public getStats(): {
        totalRoles: number;
        totalStaffMembers: number;
        roleBreakdown: Array<{ roleName: string; rank: number; memberCount: number; roleId: string }>;
        oldestCacheAge: number;
    } {
        const allStaff = this.getAllStaffMembers();
        const roleBreakdown = Array.from(this.cache.values())
            .map(entry => ({
                roleName: entry.roleName,
                rank: entry.rank,
                memberCount: entry.members.size,
                roleId: entry.roleId
            }))
            .sort((a, b) => b.rank - a.rank);

        const cacheEntries = Array.from(this.cache.values());
        const oldestCache = cacheEntries.length > 0 
            ? Math.min(...cacheEntries.map(e => e.lastUpdated))
            : Date.now();
        const oldestCacheAge = Date.now() - oldestCache;

        return {
            totalRoles: this.cache.size,
            totalStaffMembers: allStaff.size,
            roleBreakdown,
            oldestCacheAge
        };
    }

    /**
     * Get a formatted string of cache statistics
     */
    public getStatsString(): string {
        const stats = this.getStats();
        let output = `📊 **Role Cache Statistics**\n`;
        output += `Total Staff Roles: ${stats.totalRoles}\n`;
        output += `Total Staff Members: ${stats.totalStaffMembers}\n`;
        output += `Cache Age: ${Math.floor(stats.oldestCacheAge / 1000 / 60)} minutes\n\n`;
        output += `**Role Breakdown:**\n`;
        
        for (const role of stats.roleBreakdown) {
            output += `  ${role.roleName} (Rank ${role.rank}): ${role.memberCount} members\n`;
        }

        return output;
    }

    /**
     * Clear the entire cache
     */
    public clear(): void {
        this.cache.clear();
        console.log('🗑️ Role Cache cleared.');
    }
}

// Export singleton instance
export const roleCache = RoleCache.getInstance();