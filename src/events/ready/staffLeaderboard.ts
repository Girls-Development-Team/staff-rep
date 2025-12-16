import { EmbedBuilder, TextChannel, Client } from 'discord.js';
import { IEvent } from '../../core/IEvent';
import { CustomClient, UserData } from '../../types';
import { staffConfig } from '../../utils/StaffLogic';

const staffLeaderboard: IEvent<'clientReady'> = {
    name: 'clientReady',
    once: true,
    execute: async (_discordClient: Client, client: CustomClient) => {
        
        console.log('🏆 Staff Leaderboard system initialized.');

        const updateLeaderboard = async () => {
            try {
                const guildId = process.env.GUILD_ID;
                if (!guildId) return;

                const guild = await client.guilds.fetch(guildId).catch(() => null);
                if (!guild) return;

                const channel = await guild.channels.fetch(staffConfig.channels.leaderboard).catch(() => null) as TextChannel;
                if (!channel) {
                    console.warn('⚠️ Leaderboard channel not found. Check config ID.');
                    return;
                }

                // 1. Fetch DB Data (for points)
                const allDbUsers = await client.database.getLeaderboard('positiveRep', 500);

                // 2. Fetch ALL Discord Members (to find staff with 0 points)
                const allMembers = await guild.members.fetch();

                // 3. Setup Categories
                const categorized: Record<string, string[]> = {};
                // Sort roles High -> Low
                const sortedRoles = [...staffConfig.roles.staffHierarchy].sort((a: any, b: any) => b.rank - a.rank);
                sortedRoles.forEach((role: any) => categorized[role.name] = []);

                let totalStaffFound = 0;

                // 4. Iterate through Discord Members
                for (const [, member] of allMembers) {
                    // Find the highest staff role this member has
                    const staffRole = sortedRoles.find((role: any) => member.roles.cache.has(role.id));
                    
                    if (staffRole) {
                        // Attempt to find them in the DB
                        // FIXED: Typed 'u' as UserData explicitly
                        const userData = allDbUsers.find((u: UserData) => u.userId === member.id);
                        
                        // Default to 0 if not in DB
                        const pos = userData?.positiveRep || 0;
                        const neg = userData?.negativeRep || 0;
                        const status = userData?.loaStatus?.isActive ? ' [💤 LOA]' : '';

                        const entry = `**${member.user.username}**: \`✅ ${pos} | ❌ ${neg}\`${status}`;
                        categorized[staffRole.name].push(entry);
                        totalStaffFound++;
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Staff Reputation Leaderboard')
                    .setDescription('Updates every 60 seconds.')
                    .setColor('#2b2d31')
                    .setTimestamp();

                // 5. Build Fields
                if (totalStaffFound === 0) {
                    embed.addFields({ name: 'Status', value: 'No staff members found in the server.' });
                } else {
                    let hasRoleData = false;
                    for (const roleName in categorized) {
                        if (categorized[roleName].length > 0) {
                            // Sort alphabetical or by points within the role category
                            categorized[roleName].sort(); 
                            
                            embed.addFields({ name: `--- ${roleName} ---`, value: categorized[roleName].join('\n'), inline: false });
                            hasRoleData = true;
                        }
                    }
                }

                // 6. Find specific Dashboard Message to edit
                const messages = await channel.messages.fetch({ limit: 20 });
                const dashboardMsg = messages.find(m => 
                    m.author.id === client.user?.id && 
                    m.embeds.length > 0 && 
                    m.embeds[0].title === '🛡️ Staff Reputation Leaderboard'
                );

                if (dashboardMsg) {
                    await dashboardMsg.edit({ embeds: [embed] });
                } else {
                    await channel.send({ embeds: [embed] });
                }

            } catch (error) { 
                console.error('Leaderboard Loop Error:', error); 
            }
        };

        // Run immediately on startup
        updateLeaderboard();
        
        // Then loop every 60s
        setInterval(updateLeaderboard, 60 * 1000);
    }
};

export default staffLeaderboard;