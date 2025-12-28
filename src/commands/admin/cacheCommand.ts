import { CommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { IApplicationCommand } from '../../core/IApplicationCommand';
import { CustomClient } from '../../types';
import { roleCache } from '../../utils/RoleCache';
import { staffConfig } from '../../utils/StaffLogic';

const roleCacheCommand: IApplicationCommand = {
    data: {
        name: 'cache',
        description: 'Manage and view the role cache.',
        options: [
            {
                name: 'stats',
                description: 'View role cache statistics.',
                type: 1 // Subcommand
            },
            {
                name: 'refresh',
                description: 'Manually refresh the role cache.',
                type: 1 // Subcommand
            },
            {
                name: 'list',
                description: 'List all members in a specific staff role.',
                type: 1, // Subcommand
                options: [
                    {
                        name: 'role',
                        description: 'The staff role to list members for.',
                        type: 3, // String
                        required: true,
                        choices: staffConfig.roles.staffHierarchy.map((role: any) => ({
                            name: role.name,
                            value: role.id
                        }))
                    }
                ]
            }
        ]
    },
    permissions: 'admin',
    defaultMemberPermissions: PermissionFlagsBits.Administrator,

    async execute(interaction: CommandInteraction, client: CustomClient) {
        if (!interaction.isChatInputCommand()) return;

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'stats') {
            await interaction.deferReply({ ephemeral: true });

            const stats = roleCache.getStats();
            
            const embed = new EmbedBuilder()
                .setTitle('📊 Role Cache Statistics')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Total Staff Roles', value: `${stats.totalRoles}`, inline: true },
                    { name: 'Total Staff Members', value: `${stats.totalStaffMembers}`, inline: true },
                    { name: 'Cache Age', value: `${Math.floor(stats.oldestCacheAge / 1000 / 60)} minutes`, inline: true }
                )
                .setTimestamp();

            // Add role breakdown
            let roleBreakdown = '';
            for (const role of stats.roleBreakdown) {
                roleBreakdown += `**${role.roleName}** (Rank ${role.rank}): ${role.memberCount} members\n`;
            }
            
            if (roleBreakdown) {
                embed.addFields({ name: 'Role Breakdown', value: roleBreakdown });
            }

            await interaction.editReply({ embeds: [embed] });
        }

        else if (subcommand === 'refresh') {
            await interaction.deferReply({ ephemeral: true });

            await roleCache.refresh();

            const stats = roleCache.getStats();
            await interaction.editReply(
                `✅ **Role Cache Refreshed**\n` +
                `Cached ${stats.totalRoles} roles with ${stats.totalStaffMembers} total staff members.`
            );
        }

        else if (subcommand === 'list') {
            await interaction.deferReply({ ephemeral: true });

            const roleId = interaction.options.getString('role', true);
            const members = roleCache.getMembersByRole(roleId);

            if (!members || members.size === 0) {
                return interaction.editReply('❌ No members found with this role (or cache is empty).');
            }

            const roleConfig = staffConfig.roles.staffHierarchy.find((r: any) => r.id === roleId);
            const roleName = roleConfig?.name || 'Unknown Role';

            const memberList = members.map(m => `• ${m.user.username} (\`${m.id}\`)`).join('\n');
            
            const embed = new EmbedBuilder()
                .setTitle(`👥 Members with ${roleName} Role`)
                .setDescription(memberList.substring(0, 4000)) // Discord embed limit
                .setColor(0x5865F2)
                .setFooter({ text: `Total: ${members.size} members` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    }
};

export default roleCacheCommand;